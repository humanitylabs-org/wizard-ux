package ai.wizards.shell.recorder;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

/**
 * Recording custody on disk, trimmed from android/app's RecordingStore + CaptureJournal: files/takes/<id>.aac
 * (AAC ADTS, playable up to the last frame after an app kill) and <id>.json (its state, written atomically).
 *
 * The one custody rule: a take's audio is deleted only when the Wizard acknowledges it has its own copy
 * ({@link #ack}), when nothing was recorded (under {@link #NOTHING_BYTES}), or when the owner cancelled a short
 * take ({@link #KEEP_CANCELLED_MS}). Everything else stays pending and is offered again after any restart.
 * States: recording → stopped | interrupted (process died) | cancelled (a long take kept after Cancel).
 * Pure Java (no Android types), unit-tested on the JVM.
 */
public final class TakeStore {
    public static final String MIME = "audio/aac";
    /** About 0.25 s of 64 kbit/s AAC (android/app CaptureJournal.NOTHING_BYTES): below it nothing was said. */
    public static final long NOTHING_BYTES = 2048;
    /** A Cancel after this much talking keeps the take (the web's WosCancelled.KEEP_FROM_MS, 20 s). */
    public static final long KEEP_CANCELLED_MS = 20_000;
    /** Raw bytes per read (≈512 KB base64), the same chunk android/app's bridge uses. */
    public static final int CHUNK = 384 * 1024;

    private final File dir;

    public TakeStore(File dir) {
        this.dir = dir;
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    /** Valid ids are the store's own: "take-<millis>-<8 hex>". Anything else is refused before touching a path. */
    public static boolean validId(String id) {
        return id != null && id.matches("take-\\d{1,15}-[0-9a-f]{8}");
    }

    /**
     * {@code origin} is the Wizard that started the take: only that Wizard can list, read or acknowledge it, so
     * changing Wizard never hands one Wizard's recordings to another. {@code ref} is the page's own id for the take.
     */
    public synchronized String create(String kind, String ref, String origin, long now) throws IOException {
        return create(null, kind, ref, origin, now);
    }

    /** {@code proposed}: the page may name the take (so its synchronous orb code knows the id at once). */
    public synchronized String create(String proposed, String kind, String ref, String origin, long now) throws IOException {
        if (origin == null || origin.isEmpty()) throw new IOException("No Wizard");
        String id = proposed == null || proposed.isEmpty() ? "take-" + now + "-" + UUID.randomUUID().toString().substring(0, 8) : proposed;
        if (!validId(id) || meta(id).exists() || audio(id).exists()) throw new IOException("Bad take id");
        JSONObject o = new JSONObject();
        try {
            o.put("id", id).put("kind", cleanKind(kind)).put("ref", cleanRef(ref)).put("origin", origin)
                    .put("state", "recording").put("startedAt", now);
        } catch (JSONException e) { throw new IOException(e); }
        // Custody precedes hardware start: metadata first, then an empty audio file the recorder appends to.
        write(id, o);
        if (!audio(id).createNewFile()) throw new IOException("Take already exists");
        return id;
    }

    static String cleanKind(String kind) {
        return kind != null && kind.matches("[a-z][a-z-]{0,23}") ? kind : "voice";
    }

    static String cleanRef(String ref) {
        return ref != null && ref.matches("[A-Za-z0-9._:-]{1,80}") ? ref : "";
    }

    /** The take, if it exists and belongs to {@code origin}. */
    public synchronized JSONObject owned(String id, String origin) {
        JSONObject o = read(id);
        return o != null && origin != null && origin.equals(o.optString("origin")) ? o : null;
    }

    public File audio(String id) { return new File(dir, id + ".aac"); }
    private File meta(String id) { return new File(dir, id + ".json"); }

    public synchronized JSONObject read(String id) {
        if (!validId(id)) return null;
        try { return new JSONObject(new String(Files.readAllBytes(meta(id).toPath()), StandardCharsets.UTF_8)); }
        catch (IOException | JSONException e) { return null; }
    }

    /** Ends a take: records state and duration. A take with no speech is released at once. */
    public synchronized JSONObject finish(String id, String state, long ms, long now) {
        JSONObject o = read(id);
        if (o == null) return null;
        try { o.put("state", state).put("ms", Math.max(0, ms)).put("stoppedAt", now); } catch (JSONException ignored) { }
        write(id, o);
        File a = audio(id);
        if (a.length() < NOTHING_BYTES) { release(id); return describe(id, o, true); }
        if ("cancelled".equals(state) && ms < KEEP_CANCELLED_MS) { release(id); return describe(id, o, true); }
        return describe(id, o, false);
    }

    private JSONObject describe(String id, JSONObject o, boolean released) {
        try {
            JSONObject d = new JSONObject(o.toString());
            d.remove("origin");
            d.put("bytes", released ? 0 : audio(id).length()).put("mime", MIME).put("released", released);
            return d;
        } catch (JSONException e) { return o; }
    }

    /** Takes waiting for the Wizard: anything not acknowledged, except the live one. Interrupted ones say so. */
    public synchronized List<JSONObject> pending(String activeId, String origin, long now) {
        List<JSONObject> out = new ArrayList<>();
        File[] fs = dir.listFiles((d, n) -> n.endsWith(".json"));
        if (fs == null) return out;
        for (File f : fs) {
            String id = f.getName().substring(0, f.getName().length() - 5);
            if (!validId(id) || id.equals(activeId)) continue;
            JSONObject o = read(id);
            if (o == null) continue;
            if (origin == null || !origin.equals(o.optString("origin"))) continue; // another Wizard's take stays put
            File a = audio(id);
            if (!a.isFile() || a.length() < NOTHING_BYTES) {
                // A failed start or header-only file: nothing to lose. Leave a just-created one alone.
                if (now - o.optLong("startedAt", now) > 60_000) release(id);
                continue;
            }
            try {
                if ("recording".equals(o.optString("state"))) {
                    o.put("state", "interrupted");
                    long end = Math.max(o.optLong("startedAt", now), a.lastModified());
                    o.put("ms", Math.max(0, end - o.optLong("startedAt", end)));
                    write(id, o);
                }
                out.add(describe(id, o, false));
            } catch (JSONException ignored) { }
        }
        out.sort((x, y) -> Long.compare(x.optLong("startedAt"), y.optLong("startedAt")));
        return out;
    }

    public static JSONArray json(List<JSONObject> list) {
        JSONArray a = new JSONArray();
        for (JSONObject o : list) a.put(o);
        return a;
    }

    /** {b64, next (-1 at the end), size}, or null for an unknown take or bad offset. */
    public synchronized JSONObject chunk(String id, String origin, long offset) {
        if (offset < 0 || owned(id, origin) == null) return null;
        File f = audio(id);
        if (!f.isFile()) return null;
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            long size = r.length();
            if (offset > size) return null;
            int n = (int) Math.min(CHUNK, size - offset);
            byte[] b = new byte[n];
            r.seek(offset);
            r.readFully(b);
            long next = offset + n >= size ? -1 : offset + n;
            return new JSONObject().put("b64", Base64.getEncoder().encodeToString(b)).put("next", next).put("size", size);
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    /** The Wizard has its own durable copy: release native custody. Refuses the live take. */
    public synchronized boolean ack(String id, String origin, String activeId) {
        if (id == null || id.equals(activeId) || owned(id, origin) == null) return false;
        release(id);
        return true;
    }

    private void release(String id) {
        //noinspection ResultOfMethodCallIgnored
        audio(id).delete();
        //noinspection ResultOfMethodCallIgnored
        meta(id).delete();
    }

    private void write(String id, JSONObject o) {
        File tmp = new File(dir, id + ".json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(o.toString().getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) { return; }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(meta(id));
    }
}
