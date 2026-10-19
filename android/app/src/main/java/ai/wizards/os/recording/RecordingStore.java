package ai.wizards.os.recording;

import ai.wizards.os.audio.CaptureJournal;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Orb recordings on disk: files/recordings/<id>.aac (AAC ADTS, so a take cut short by an app kill still
 * plays up to the last frame) plus <id>.json with its state. CaptureJournal owns the bytes: recDone
 * retires this adapter's metadata, but without a server receipt the native original is kept.
 *
 * States: recording → stopped (by the notification's Send, or the service died: "interrupted") → claimed
 * (the web shell took it with recStop) → kept by CaptureJournal (recDone). Anything not claimed in this process is
 * recoverable on the next start.
 */
public final class RecordingStore {
    public static final String MIME = "audio/aac";
    private static RecordingStore instance;
    private final File dir;
    private final CaptureJournal custody;
    /** Takes the web shell claimed in THIS process; a claim left by a dead process is recoverable again. */
    private final Set<String> claimedHere = new HashSet<>();

    public static synchronized RecordingStore get(Context c) {
        if (instance == null) instance = new RecordingStore(new File(c.getApplicationContext().getFilesDir(), "recordings"));
        return instance;
    }

    RecordingStore(File dir) {
        this.dir = dir;
        custody = CaptureJournal.at(dir.getParentFile());
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    public synchronized String create(String kind) {
        String id = "rec-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 8);
        JSONObject o = new JSONObject();
        try {
            o.put("id", id).put("kind", kind == null ? "auto" : kind).put("state", "recording")
                    .put("startedAt", System.currentTimeMillis());
        } catch (JSONException ignored) { }
        write(id, o);
        return id;
    }

    public File audio(String id) { return new File(dir, safe(id) + ".aac"); }
    private File meta(String id) { return new File(dir, safe(id) + ".json"); }

    public synchronized JSONObject read(String id) {
        try { return new JSONObject(new String(Files.readAllBytes(meta(id).toPath()), StandardCharsets.UTF_8)); }
        catch (IOException | JSONException e) { return null; }
    }

    public synchronized void set(String id, String key, Object value) {
        JSONObject o = read(id);
        if (o == null) return;
        try { o.put(key, value); } catch (JSONException ignored) { }
        write(id, o);
    }

    public synchronized void claim(String id) {
        custody.adopt(audio(id), "app");
        custody.hand(id, "web-outbox");
        claimedHere.add(id);
        set(id, "state", "claimed");
    }

    public synchronized void delete(String id) {
        // recDone: the web outbox saved it (it keeps the bytes until Wizard's receipt). A take never handed to the
        // web outbox is released only if nothing was recorded; otherwise it is kept in Cancelled recordings.
        File a = audio(id);
        if (a.isFile()) {
            String cid = custody.adopt(a, "app");
            JSONObject e = custody.entry(cid);
            CaptureJournal.Reason why = e != null && "handed".equals(e.optString("state")) && "web-outbox".equals(e.optString("owner"))
                    ? CaptureJournal.Reason.WEB_OUTBOX_CUSTODY : a.length() < CaptureJournal.NOTHING_BYTES ? CaptureJournal.Reason.NOTHING_RECORDED : null;
            if (!custody.release(cid, why)) return;
        }
        claimedHere.remove(id);
        //noinspection ResultOfMethodCallIgnored
        meta(id).delete();
    }

    /** Takes that need a home: stopped by the notification, interrupted by a kill, or claimed by a dead process. */
    public synchronized List<JSONObject> pending(String activeId) {
        List<JSONObject> out = new ArrayList<>();
        File[] fs = dir.listFiles((d, n) -> n.endsWith(".json"));
        if (fs == null) return out;
        for (File f : fs) {
            String id = f.getName().substring(0, f.getName().length() - 5);
            if (id.equals(activeId) || claimedHere.contains(id)) continue;
            JSONObject o = read(id);
            File a = audio(id);
            if (o == null) continue;
            if (!a.isFile() || a.length() < 600) { // nothing usable was captured
                if (System.currentTimeMillis() - o.optLong("startedAt") > 60_000) delete(id); // NOTHING_RECORDED
                continue;
            }
            try {
                String st = o.optString("state");
                if ("recording".equals(st)) o.put("state", "interrupted");
                o.put("bytes", a.length());
                if (o.optLong("ms") <= 0) {
                    long end = o.optLong("stoppedAt", a.lastModified());
                    o.put("ms", Math.max(0, end - o.optLong("startedAt", end)));
                }
            } catch (JSONException ignored) { }
            out.add(o);
        }
        return out;
    }

    public static String json(List<JSONObject> list) {
        JSONArray a = new JSONArray();
        for (JSONObject o : list) a.put(o);
        return a.toString();
    }

    private void write(String id, JSONObject o) {
        File tmp = new File(dir, safe(id) + ".json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(o.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) { return; }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(meta(id));
    }

    static String safe(String id) { return String.valueOf(id).replaceAll("[^A-Za-z0-9._-]", "_"); }
}
