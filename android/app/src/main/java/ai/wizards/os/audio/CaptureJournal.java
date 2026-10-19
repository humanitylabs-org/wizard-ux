package ai.wizards.os.audio;

import android.content.Context;
import ai.wizards.os.recording.CancelPolicy;
import ai.wizards.os.recording.CancelledTakes;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;

/** Native custody, not another upload queue. Nothing is deleted until the server has it or you discarded it. */
public final class CaptureJournal {
    public enum Reason { SERVER_RECEIPT, USER_DISCARD, MEETING_PRUNE_AFTER_READY, SUPERSEDED_COPY }
    private static final Map<String, CaptureJournal> INSTANCES = new LinkedHashMap<>();
    private final File root, index;
    private final Map<String, JSONObject> entries = new LinkedHashMap<>();
    private boolean cacheAdopted;

    public static CaptureJournal get(Context c) {
        CaptureJournal j = at(c.getApplicationContext().getFilesDir());
        // Legacy floating takes used cache storage. Adopt in place; never move/delete them on boot.
        synchronized (j) {
            if (!j.cacheAdopted) {
                for (File f : children(c.getCacheDir())) if (f.getName().startsWith("everywhere-") && isAudio(f) && j.idFor(f) == null) j.adopt(f, "everywhere");
                j.cacheAdopted = true;
            }
        }
        return j;
    }
    public static synchronized CaptureJournal at(File filesDir) {
        String key = filesDir.getAbsolutePath();
        CaptureJournal j = INSTANCES.get(key);
        if (j == null) { j = new CaptureJournal(filesDir); INSTANCES.put(key, j); }
        return j;
    }

    /** Reopening only reads/adopts: interrupted recordings are never deleted at startup. */
    public CaptureJournal(File filesDir) {
        root = filesDir;
        index = new File(root, "capture-journal.json");
        if (index.isFile()) {
            JSONArray saved = array(index);
            for (int i = 0; i < saved.length(); i++) {
                JSONObject e = saved.optJSONObject(i);
                if (e == null || e.optString("id").isEmpty()) throw new IllegalStateException("Invalid capture journal");
                entries.put(e.optString("id"), e);
            }
        }
        adoptLegacy();
    }

    public static String chunkId(String meetingId, int seq) { return meetingId + "/" + String.format(java.util.Locale.US, "%06d", seq); }
    public static boolean isAudio(File f) { return f.getName().matches(".*\\.(aac|m4a|wav)(\\.tmp)?"); }
    private static String source(String s) { return "side".equals(s) || "app".equals(s) || "meeting".equals(s) ? s : "everywhere"; }
    private static boolean terminal(String s) { return "delivered".equals(s) || "kept".equals(s) || "discarded".equals(s); }
    private static JSONObject copy(JSONObject e) {
        try { return new JSONObject(e.toString()); } catch (Exception ex) { throw new IllegalStateException(ex); }
    }
    private static JSONObject put(JSONObject e, String k, Object v) {
        try { e.put(k, v); return e; } catch (Exception ex) { throw new IllegalStateException(ex); }
    }
    private static JSONArray array(File f) {
        try { return new JSONArray(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)); }
        catch (Exception ex) { throw new IllegalStateException("Cannot read custody index " + f.getName(), ex); }
    }
    private static JSONObject object(File f) {
        try { return new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)); }
        catch (Exception ex) { return new JSONObject(); } // Missing legacy metadata never justifies deleting bytes.
    }
    private static File[] children(File dir) { File[] fs = dir.listFiles(); return fs == null ? new File[0] : fs; }

    /** Commit before any destructive action; failure leaves both the previous index and original audio intact. */
    private void commit(JSONObject e) {
        put(e, "updatedAt", System.currentTimeMillis());
        JSONArray all = new JSONArray();
        for (JSONObject old : entries.values()) if (!old.optString("id").equals(e.optString("id"))) all.put(old);
        all.put(e);
        File tmp = new File(root, "capture-journal.json.tmp");
        try {
            if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create journal directory");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(all.toString().getBytes(StandardCharsets.UTF_8)); out.getFD().sync();
            }
            if (!tmp.renameTo(index)) throw new IOException("Cannot commit capture journal");
        } catch (IOException ex) { throw new UncheckedIOException(ex); }
        entries.put(e.optString("id"), e);
    }

    public synchronized void register(String id, String source, String kind, File path, long startedAt) {
        if (id == null || id.isEmpty() || path == null) throw new IllegalArgumentException("Capture identity required");
        JSONObject old = entries.get(id);
        if (old != null) {
            if (!old.optString("path").equals(path.getAbsolutePath())) throw new IllegalStateException("Capture id already owns another path");
            return;
        }
        if (idFor(path) != null) throw new IllegalStateException("Capture path already has an identity");
        JSONObject e = new JSONObject();
        put(e, "id", id); put(e, "source", source(source)); put(e, "kind", kind);
        put(e, "path", path.getAbsolutePath()); put(e, "bytes", path.length()); put(e, "startedAt", startedAt);
        put(e, "state", "recording"); put(e, "owner", "recorder"); put(e, "receipts", new JSONArray()); commit(e);
    }

    public synchronized JSONObject entry(String id) { JSONObject e = entries.get(id); return e == null ? null : copy(e); }
    public synchronized String idFor(File path) {
        for (JSONObject e : entries.values()) if (path.getAbsolutePath().equals(e.optString("path"))) return e.optString("id");
        return null;
    }
    /** Fallback for pre-journal, failed-start and QA files; retains the filename identity. */
    public synchronized String adopt(File path, String src) {
        String id = idFor(path);
        if (id != null) return id;
        id = path.getName().replaceFirst("\\.(aac|m4a|wav)(\\.tmp)?$", "");
        if (entries.containsKey(id)) id = source(src) + "-" + path.getName() + "-" + java.util.UUID.randomUUID();
        register(id, src, "meeting".equals(src) ? "meeting_chunk" : "note", path, path.lastModified());
        transition(id, "stopped", null);
        return id;
    }

    public synchronized void transition(String id, String state, JSONObject receipt) {
        JSONObject old = entries.get(id);
        if (old == null) throw new IllegalArgumentException("Unknown capture " + id);
        String from = old.optString("state");
        if (from.equals(state)) return;
        boolean valid = "recording".equals(from) && "stopped".equals(state)
                || "stopped".equals(from) && "handed".equals(state)
                || "handed".equals(from) && "delivered".equals(state);
        if (!valid) throw new IllegalStateException(from + " -> " + state);
        if ("delivered".equals(state) && (receipt == null || receipt.optString("server").isEmpty()))
            throw new IllegalArgumentException("A server receipt is required");
        if ("handed".equals(state) && (receipt == null || !receipt.optString("owner").matches("everywhere-outbox|web-outbox|mizel-uploader")))
            throw new IllegalArgumentException("Delivery adapter required");
        JSONObject e = copy(old);
        put(e, "state", state); put(e, "bytes", new File(e.optString("path")).length());
        if (receipt != null) {
            e.optJSONArray("receipts").put(copy(receipt));
            if ("handed".equals(state)) put(e, "owner", receipt.optString("owner"));
        }
        commit(e);
    }

    public synchronized void stopped(String id) {
        JSONObject e = entries.get(id);
        if (e != null && "recording".equals(e.optString("state"))) transition(id, "stopped", null);
    }
    public synchronized void hand(String id, String owner) {
        stopped(id);
        JSONObject e = entries.get(id);
        if (e != null && "stopped".equals(e.optString("state"))) transition(id, "handed", put(new JSONObject(), "owner", owner));
    }
    public synchronized void received(String id, String serverReceipt) {
        if (serverReceipt == null || serverReceipt.isEmpty()) throw new IllegalArgumentException("Empty receipt");
        transition(id, "delivered", put(new JSONObject(), "server", serverReceipt));
    }
    public synchronized void ready(String id, long at, long keepMs) {
        JSONObject old = entries.get(id);
        if (old == null || !"delivered".equals(old.optString("state"))) return;
        JSONObject e = copy(old); put(e, "readyAt", at); put(e, "keepMs", Math.max(0, keepMs)); commit(e);
    }
    /** Called only by an explicit Cancel control; absence of this durable decision fails closed to kept. */
    public synchronized void userDiscard(String id, long ms) {
        JSONObject e = copy(entries.get(id)); put(e, "discardMs", Math.max(0, ms)); commit(e);
    }

    public synchronized boolean release(String id, Reason reason) { return release(id, reason, null); }

    /** A copy is evidence only after byte-for-byte verification, never just because a destination exists. */
    public synchronized boolean release(String id, Reason reason, File replacement) {
        JSONObject old = entries.get(id);
        if (old == null) return false;
        File audio = new File(old.optString("path"));
        if ("kept".equals(old.optString("state")) || "discarded".equals(old.optString("state"))) return true;
        if (reason == Reason.SUPERSEDED_COPY) {
            if (replacement == null || audio.equals(replacement) || !sameBytes(audio, replacement)) return keep(old);
            JSONObject e = copy(old);
            put(e, "path", replacement.getAbsolutePath()); put(e, "bytes", replacement.length());
            e.optJSONArray("receipts").put(put(new JSONObject(), "copy", replacement.getAbsolutePath()));
            commit(e);
            return !audio.exists() || audio.delete();
        }
        boolean delivered = "delivered".equals(old.optString("state"));
        boolean discard = reason == Reason.USER_DISCARD && old.has("discardMs")
                && !CancelPolicy.keep(old.optLong("discardMs"), audio.length());
        boolean prune = reason == Reason.MEETING_PRUNE_AFTER_READY && delivered
                && "meeting_chunk".equals(old.optString("kind")) && old.optLong("readyAt") > 0
                && System.currentTimeMillis() - old.optLong("readyAt") >= old.optLong("keepMs", Long.MAX_VALUE);
        if (!(reason == Reason.SERVER_RECEIPT && delivered) && !discard && !prune) return keep(old);
        JSONObject e = copy(old);
        put(e, "state", discard ? "discarded" : "delivered"); put(e, "bytes", audio.length());
        put(e, "releaseReason", reason.name()); commit(e);
        return !audio.exists() || audio.delete();
    }

    private boolean keep(JSONObject old) {
        File audio = new File(old.optString("path"));
        if (!audio.isFile()) return false;
        try {
            File kept = CancelledTakes.keepCustody(root, old, audio);
            if (!sameBytes(audio, kept)) return false;
            JSONObject e = copy(old); put(e, "path", kept.getAbsolutePath()); put(e, "bytes", kept.length());
            put(e, "state", "kept"); put(e, "owner", "cancelled-takes"); commit(e);
            // Cleanup of the verified duplicate is still performed only by release.
            return release(audio, kept);
        } catch (IOException ex) { return false; } // Original remains recoverable on storage failure.
    }

    private boolean release(File audio, File kept) {
        // Both copies already have durable metadata. Keep the original too if verification fails.
        if (audio.equals(kept)) return true;
        return sameBytes(audio, kept) && (!audio.exists() || audio.delete());
    }

    public synchronized boolean releaseFile(File file, String src, Reason reason) {
        return file != null && file.isFile() && release(adopt(file, src), reason);
    }

    /** A chunk's existing atomic rename preserves its identity; boot also reconciles this crash window. */
    public synchronized void moved(String id, File to) {
        JSONObject old = entries.get(id);
        if (old == null || !to.isFile()) throw new IllegalStateException("Missing moved capture");
        File from = new File(old.optString("path"));
        if (from.exists() && !from.equals(to)) throw new IllegalStateException("Original still exists");
        JSONObject e = copy(old); put(e, "path", to.getAbsolutePath()); put(e, "bytes", to.length()); commit(e);
    }
    public synchronized boolean cancel(File file, String src, long ms) {
        String id = adopt(file, src); stopped(id); userDiscard(id, ms); release(id, Reason.USER_DISCARD);
        return "kept".equals(entries.get(id).optString("state"));
    }

    /** Copy then journal then release: a crash at any boundary leaves at least one discoverable original. */
    public synchronized void transfer(String id, File to) throws IOException {
        File from = new File(entries.get(id).optString("path"));
        if (from.equals(to)) return;
        if (!to.exists()) {
            try (FileInputStream in = new FileInputStream(from); FileOutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[65536]; for (int n; (n = in.read(buf)) != -1;) out.write(buf, 0, n);
                out.getFD().sync();
            }
        }
        if (!sameBytes(from, to)) throw new IOException("Capture copy differs; original retained");
        if (!release(id, Reason.SUPERSEDED_COPY, to)) throw new IOException("Capture copy cleanup failed");
    }
    private static boolean sameBytes(File a, File b) {
        if (!a.isFile() || !b.isFile() || a.length() != b.length()) return false;
        try (FileInputStream x = new FileInputStream(a); FileInputStream y = new FileInputStream(b)) {
            byte[] p = new byte[65536], q = new byte[65536];
            for (int n; (n = x.read(p)) != -1;) {
                int offset = 0;
                while (offset < n) { int m = y.read(q, offset, n - offset); if (m < 0) return false; offset += m; }
                for (int i = 0; i < n; i++) if (p[i] != q[i]) return false;
            }
            return y.read() == -1;
        } catch (IOException ex) { return false; }
    }

    public synchronized String status() {
        JSONArray out = new JSONArray();
        for (JSONObject e : entries.values()) {
            if (terminal(e.optString("state"))) continue;
            JSONObject row = new JSONObject();
            for (String k : new String[]{"id", "source", "kind", "state", "startedAt", "owner"}) put(row, k, e.opt(k));
            put(row, "bytes", new File(e.optString("path")).length()); out.put(row);
        }
        return out.toString();
    }

    private void adoptLegacy() {
        // Adapter IDs are authoritative; adopt them before scanning for unindexed crash leftovers.
        File outbox = new File(root, "everywhere/outbox.json");
        if (outbox.isFile()) {
            JSONArray items = array(outbox);
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null || it.optString("audioPath").isEmpty()) continue;
                legacy(it.optString("id"), it.optString("source"), "note", new File(it.optString("audioPath")), it.optLong("createdAt"), "everywhere-outbox");
            }
        }
        for (File f : children(new File(root, "recordings"))) if (isAudio(f)) {
            String id = f.getName().replaceFirst("\\.aac$", "");
            JSONObject meta = object(new File(f.getParentFile(), id + ".json"));
            legacy(id, "app", "note", f, meta.optLong("startedAt", f.lastModified()), "");
        }
        for (File meeting : children(new File(root, "mizel"))) for (File f : children(new File(meeting, "me"))) if (isAudio(f)) {
            String seq = f.getName().replaceFirst("\\.wav(\\.tmp)?$", "");
            String id = meeting.getName() + "/" + seq;
            if (f.getName().endsWith(".tmp") && new File(f.getParentFile(), seq + ".wav").exists()) id += ".tmp";
            legacy(id, "meeting", "meeting_chunk", f, f.lastModified(), "mizel-uploader");
        }
        for (String folder : new String[]{"side-takes", "everywhere/audio", "everywhere-takes"})
            for (File f : children(new File(root, folder))) if (isAudio(f) && idFor(f) == null) adopt(f, folder.startsWith("side") ? "side" : "everywhere");
        for (File f : children(new File(root, "cancelled"))) if (f.getName().endsWith(".json")) {
            JSONObject meta = object(f); File audio = new File(f.getParentFile(), meta.optString("file"));
            if (!audio.isFile() || idFor(audio) != null) continue;
            String id = meta.optString("captureId", meta.optString("id"));
            if (id.isEmpty() || entries.containsKey(id)) continue;
            register(id, meta.optString("source"), "note", audio, meta.optLong("at"));
            JSONObject e = copy(entries.get(id)); put(e, "state", "kept"); put(e, "owner", "cancelled-takes"); commit(e);
        }
    }
    private void legacy(String id, String src, String kind, File f, long startedAt, String owner) {
        if (id.isEmpty() || !f.isFile()) return;
        JSONObject old = entries.get(id);
        if (old != null) {
            if ("meeting_chunk".equals(kind) && !terminal(old.optString("state"))
                    && !new File(old.optString("path")).exists()) moved(id, f);
            return;
        }
        if (idFor(f) != null) return;
        register(id, src, kind, f, startedAt); stopped(id);
        if (!owner.isEmpty()) hand(id, owner);
    }
}
