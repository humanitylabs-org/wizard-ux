package ai.wizards.os.recording;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Cancelled recordings worth keeping (James, 11 Oct 2026): an X tapped by accident must not throw away a long
 * message. Any take cancelled after {@link CancelPolicy#KEEP_FROM_MS} or more is moved here instead of deleted —
 * from the floating orb, the in-app orb and the side button alike. Settings → Cancelled recordings lists them:
 * Transcribe &amp; copy puts the words on the clipboard, Delete removes them. A short cancel is still just gone.
 *
 * Files: files/cancelled/&lt;id&gt;.&lt;ext&gt; + &lt;id&gt;.json ({id, at, ms, source, mime, bytes}). Only this phone has them;
 * kept until explicit Delete. Age/count alone is not permission to destroy an owner's recording.
 */
public final class CancelledTakes {
    static final String TAG = "WizardOSCancelled";
    private CancelledTakes() { }

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "cancelled");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    /** Compatibility entry point; CaptureJournal owns the explicit short-cancel decision and bytes. */
    public static boolean keep(Context c, File audio, long ms, String source, String mime) {
        return audio != null && audio.isFile() && ai.wizards.os.audio.CaptureJournal.get(c).cancel(audio, source, ms);
    }

    /** Unheard is never a receipt, regardless of duration or size. */
    public static boolean keepUnheard(Context c, File audio, String source, String mime) {
        return keepUnheard(c.getFilesDir(), audio, source);
    }

    public static boolean keepUnheard(File filesDir, File audio, String source) {
        return ai.wizards.os.audio.CaptureJournal.at(filesDir).releaseFile(audio, source, null);
    }

    /** Journal-owned keeps have no age/count expiry: only explicit Delete may remove the last copy. */
    public static File keepCustody(File filesDir, JSONObject entry, File audio) throws IOException {
        String id = "journal-" + java.util.Base64.getUrlEncoder().withoutPadding()
                .encodeToString(entry.optString("id").getBytes(StandardCharsets.UTF_8));
        File d = new File(filesDir, "cancelled");
        if (!d.isDirectory() && !d.mkdirs()) throw new IOException("Cannot create cancelled recordings");
        String name = audio.getName();
        String ext = name.endsWith(".wav.tmp") ? ".wav" : name.substring(name.lastIndexOf('.'));
        File out = new File(d, id + ext);
        // Copy, never rename: a failed journal/metadata write must leave the original discoverable.
        if (!audio.equals(out)) {
            try (InputStream in = new FileInputStream(audio); FileOutputStream w = new FileOutputStream(out)) {
                byte[] buf = new byte[65536]; for (int n; (n = in.read(buf)) != -1;) w.write(buf, 0, n);
                w.getFD().sync();
            }
        }
        try {
            JSONObject meta = new JSONObject().put("id", id).put("captureId", entry.optString("id"))
                    .put("at", System.currentTimeMillis()).put("ms", entry.optLong("discardMs"))
                    .put("source", entry.optString("source")).put("file", out.getName()).put("bytes", out.length())
                    .put("mime", ".wav".equals(ext) ? "audio/wav" : ".aac".equals(ext) ? "audio/aac" : "audio/mp4")
                    .put("custody", true);
            File tmp = new File(d, id + ".json.tmp");
            try (FileOutputStream w = new FileOutputStream(tmp)) {
                w.write(meta.toString().getBytes(StandardCharsets.UTF_8)); w.getFD().sync();
            }
            if (!tmp.renameTo(new File(d, id + ".json"))) throw new IOException("Cannot commit kept recording");
        } catch (JSONException ex) { throw new IOException(ex); }
        return out;
    }

    /** Newest first. */
    public static List<JSONObject> list(Context c) {
        List<JSONObject> out = new ArrayList<>();
        File[] fs = dir(c).listFiles((d, n) -> n.endsWith(".json"));
        if (fs == null) return out;
        for (File f : fs) {
            try {
                JSONObject o = new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
                File a = new File(f.getParentFile(), o.optString("file"));
                if (!a.isFile()) { //noinspection ResultOfMethodCallIgnored
                    f.delete(); continue; }
                out.add(o);
            } catch (IOException | JSONException e) { //noinspection ResultOfMethodCallIgnored
                f.delete(); }
        }
        out.sort((x, y) -> Long.compare(y.optLong("at"), x.optLong("at")));
        return out;
    }

    public static String listJson(Context c) {
        prune(c);
        JSONArray a = new JSONArray();
        for (JSONObject o : list(c)) a.put(o);
        return a.toString();
    }

    public static File audio(Context c, String id) {
        for (JSONObject o : list(c)) if (o.optString("id").equals(id)) return new File(dir(c), o.optString("file"));
        return new File(dir(c), "missing");
    }

    public static void delete(Context c, String id) {
        File d = dir(c);
        String safe = String.valueOf(id).replaceAll("[^A-Za-z0-9._-]", "_");
        File[] fs = d.listFiles((x, n) -> n.startsWith(safe + "."));
        if (fs != null) for (File f : fs) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    static void prune(Context c) {
        // No automatic expiry: neither a week nor a full list proves the server has the recording.
        // Explicit Settings → Delete remains the owner's decision (including pre-journal keeps).
    }

    /** For logs and QA. */
    static String describe(Context c) { return Arrays.toString(list(c).toArray()); }
}
