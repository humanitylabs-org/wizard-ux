package ai.wizards.os.share;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * The durable outbox for "Share to Wizard" (resumable route): files/share-out/&lt;id&gt;/{item.json, 0.bin, 1.bin, …}.
 * One directory per share; the private copies sit next to the item and are deleted once the Wizard has delivered
 * it. Everything the uploader needs to carry on after process death or a reboot is in item.json: the
 * client_share_id (= id), the server's share/upload ids and the last acknowledged byte offset of every file.
 *
 * Item states: copying → ready → uploading → delivered | failed | handoff (no resumable API: hand to the web picker).
 * Kept apart from {@link ShareStore} (the web picker's staging area), whose day-old prune must never touch a
 * share still on its way.
 */
public final class ShareQueue {
    public static final String COPYING = "copying", READY = "ready", UPLOADING = "uploading",
            DELIVERED = "delivered", FAILED = "failed", HANDOFF = "handoff";
    private static ShareQueue instance;
    private final File root;

    public static synchronized ShareQueue get(Context c) {
        if (instance == null) instance = new ShareQueue(new File(c.getApplicationContext().getFilesDir(), "share-out"));
        return instance;
    }

    ShareQueue(File root) { this.root = root; }

    public static String newId() { return "and-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12); }

    public File dir(String id) {
        File d = new File(root, ShareStore.safe(id));
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    public synchronized File file(String id, int n) {
        // A promoted staging directory keeps its original filenames. The upload list contains only the kept
        // items, possibly reordered, so its logical index need not equal the physical file's index.
        int index = Math.max(0, n);
        JSONObject item = load(id);
        JSONArray files = item == null ? null : item.optJSONArray("files");
        JSONObject entry = files == null ? null : files.optJSONObject(index);
        if (entry != null) index = Math.max(0, entry.optInt("storageIndex", index));
        return new File(dir(id), index + ".bin");
    }

    /** All-or-nothing ownership handoff on the same private filesystem; never copies or links file bytes.
     * Before the move, failures/crashes leave the complete staging directory available for retry/cancel.
     * After it, the existing uploader sees the complete ready manifest and can resume without the sender.
     * Excluded bytes move too, but are absent from the upload list and leave with dropCopies/delete. */
    synchronized void promote(File staged, JSONObject item) throws IOException {
        String id = item.optString("id");
        if (id.isEmpty() || !id.equals(ShareStore.safe(id))) throw new IOException("Invalid share id");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Couldn’t create the share queue");
        File target = new File(root, id);
        if (target.exists()) throw new IOException("Conflicting share directory");
        saveIn(staged, item);
        // Fail closed if atomic directory rename is unavailable; no destructive copy/delete fallback.
        Files.move(staged.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE);
    }

    public synchronized void save(JSONObject item) throws IOException {
        String id = item.optString("id");
        if (id.isEmpty()) throw new IOException("item without id");
        saveIn(dir(id), item);
    }

    private static void saveIn(File d, JSONObject item) throws IOException {
        File tmp = new File(d, "item.json.tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) {
            o.write(item.toString().getBytes(StandardCharsets.UTF_8));
            o.getFD().sync();
        }
        if (!tmp.renameTo(new File(d, "item.json"))) throw new IOException("Couldn’t save the share");
    }

    public synchronized JSONObject load(String id) {
        File f = new File(new File(root, ShareStore.safe(id)), "item.json");
        try { return new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)); }
        catch (IOException | JSONException e) { return null; }
    }

    /** Ids, oldest first (ids start with their creation time). */
    public synchronized List<String> ids() {
        String[] names = root.list();
        if (names == null) return new ArrayList<>();
        Arrays.sort(names);
        List<String> out = new ArrayList<>();
        for (String n : names) if (new File(new File(root, n), "item.json").isFile()) out.add(n);
        return out;
    }

    public static boolean terminal(JSONObject it) {
        String s = it == null ? "" : it.optString("state");
        return DELIVERED.equals(s) || FAILED.equals(s) || HANDOFF.equals(s);
    }

    /** The oldest share still on its way, or null. */
    public synchronized JSONObject next() {
        for (String id : ids()) { JSONObject it = load(id); if (it != null && !terminal(it)) return it; }
        return null;
    }

    public synchronized boolean pending() { return next() != null; }

    /** Drop the private copies (the Wizard has the bytes, or the share failed for good). item.json stays a while. */
    public synchronized void dropCopies(String id) {
        File[] fs = new File(root, ShareStore.safe(id)).listFiles();
        if (fs != null) for (File f : fs) if (f.getName().endsWith(".bin")) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    public synchronized void delete(String id) {
        File d = new File(root, ShareStore.safe(id));
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) //noinspection ResultOfMethodCallIgnored
            f.delete();
        //noinspection ResultOfMethodCallIgnored
        d.delete();
    }

    /** Finished items older than a week go (their copies went when they finished). */
    public synchronized void prune(long now) {
        for (String id : ids()) {
            JSONObject it = load(id);
            if (it != null && terminal(it) && now - it.optLong("finished", it.optLong("created")) > 7 * 86400_000L) delete(id);
        }
    }

    /** Bytes still to copy for every unfinished share (known sizes only). */
    public synchronized long bytesToCopy() {
        long n = 0;
        for (String id : ids()) {
            JSONObject it = load(id);
            if (it == null || !COPYING.equals(it.optString("state"))) continue;
            JSONArray fs = it.optJSONArray("files");
            for (int i = 0; fs != null && i < fs.length(); i++) {
                JSONObject f = fs.optJSONObject(i);
                if (f != null && !f.optBoolean("copied") && f.optLong("bytes", -1) > 0) n += Math.max(0, f.optLong("bytes") - file(id, i).length());
            }
        }
        return n;
    }

    public static int fileCount(JSONObject it) { JSONArray a = it.optJSONArray("files"); return a == null ? 0 : a.length(); }

    public static long totalBytes(JSONObject it) {
        JSONArray a = it.optJSONArray("files"); long n = 0;
        for (int i = 0; a != null && i < a.length(); i++) n += Math.max(0, a.optJSONObject(i).optLong("bytes", 0));
        return n;
    }

    /** Bytes the Wizard has acknowledged so far. */
    public static long sentBytes(JSONObject it) {
        JSONArray u = it.optJSONArray("uploads"); long n = 0;
        for (int i = 0; u != null && i < u.length(); i++) n += Math.max(0, u.optJSONObject(i).optLong("offset", 0));
        return n;
    }
}
