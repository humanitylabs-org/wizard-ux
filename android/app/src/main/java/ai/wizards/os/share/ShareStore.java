package ai.wizards.os.share;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;

/**
 * Staged shares for the web picker (Wizards without the resumable shares API, text shares, the orb's Screen):
 * files/share/<id>/{meta.json, 0.bin, 1.bin, …}. Deleted once Wizard OS has them (or after a day). No size cap: the
 * only limit is the phone's free space. Resumable shares live in {@link ShareQueue} instead.
 */
public final class ShareStore {
    public static final int MAX_ITEMS = 8;
    private static ShareStore instance;
    private final File root;

    public static synchronized ShareStore get(Context c) {
        if (instance == null) instance = new ShareStore(new File(c.getApplicationContext().getFilesDir(), "share"));
        return instance;
    }

    ShareStore(File root) { this.root = root; }

    String newId() { return "share-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 6); }

    File dir(String id) {
        File d = new File(root, safe(id));
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    void save(String id, byte[] meta) throws IOException {
        File tmp = new File(dir(id), "meta.json.tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(meta); o.getFD().sync(); }
        if (!tmp.renameTo(new File(dir(id), "meta.json"))) throw new IOException("Couldn’t save the share");
    }

    public String meta(String id) {
        File f = new File(new File(root, safe(id)), "meta.json");
        try { return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8); }
        catch (IOException e) { return null; }
    }

    public File item(String id, int n) { return new File(new File(root, safe(id)), Math.max(0, n) + ".bin"); }

    public synchronized void delete(String id) {
        File d = new File(root, safe(id));
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) //noinspection ResultOfMethodCallIgnored
            f.delete();
        //noinspection ResultOfMethodCallIgnored
        d.delete();
    }

    /** Promote staged bytes to the existing resumable queue without copying a large file on Send.
     * Android SELinux denies app-data hard links, even within our own private storage. Publish the fsynced
     * manifest and all bytes together by atomically moving their directory. A crash/retry uses the same id. */
    public synchronized String enqueue(Context context, org.json.JSONObject request) throws IOException, org.json.JSONException {
        String queueId = enqueue(ShareQueue.get(context), request);
        ShareService.send(context, queueId, java.util.Collections.emptyList());
        return queueId;
    }

    synchronized String enqueue(ShareQueue queue, org.json.JSONObject request) throws IOException, org.json.JSONException {
        String id = request.optString("shareId"), agent = request.optString("agent"), thread = request.optString("thread");
        if (!id.matches("share-[A-Za-z0-9._-]{1,100}") || (!agent.isEmpty() && !agent.matches("[a-z0-9][a-z0-9-]{0,40}"))
                || (!thread.isEmpty() && !thread.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,200}"))) throw new IOException("Invalid share destination");
        String queueId = "and-" + id;
        if (queue.load(queueId) != null) return queueId;
        String metadata = meta(id);
        if (metadata == null) throw new IOException("Share expired");
        org.json.JSONArray all = new org.json.JSONObject(metadata).getJSONArray("items"), kept = request.getJSONArray("keptItemIndexes"), files = new org.json.JSONArray();
        if (kept.length() < 1 || kept.length() > all.length()) throw new IOException("Nothing to share");
        java.util.HashSet<Integer> seen = new java.util.HashSet<>();
        for (int i = 0; i < kept.length(); i++) {
            int n = kept.getInt(i);
            if (!seen.add(n)) throw new IOException("Duplicate item");
            org.json.JSONObject found = null;
            for (int j = 0; j < all.length(); j++) if (all.getJSONObject(j).getInt("n") == n) found = all.getJSONObject(j);
            if (found == null || !found.optString("sha256").matches("[a-f0-9]{64}")) throw new IOException("Invalid item");
            File source = item(id, n);
            if (!source.isFile() || source.length() != found.getLong("bytes")) throw new IOException("Missing item");
            files.put(new org.json.JSONObject().put("name", found.getString("name")).put("mime", found.getString("mime"))
                    .put("bytes", source.length()).put("sha256", found.getString("sha256")).put("copied", true).put("storageIndex", n));
        }
        String note = request.optString("note");
        if (note.length() > 250000) throw new IOException("Note too long");
        org.json.JSONObject it = new org.json.JSONObject().put("id", queueId).put("v", 2).put("created", System.currentTimeMillis()).put("state", ShareQueue.READY)
                .put("agent", agent).put("agentLabel", request.optString("agentLabel", "Wizard")).put("thread", thread).put("note", note)
                .put("files", files).put("uploads", new org.json.JSONArray());
        queue.promote(new File(root, id), it);
        return queueId;
    }

    /** Shares older than a day that were never picked up. */
    public synchronized void prune() {
        File[] ds = root.listFiles();
        if (ds == null) return;
        for (File d : ds) if (System.currentTimeMillis() - d.lastModified() > 24 * 3600_000L) delete(d.getName());
    }

    /**
     * Stage text plus an optional screen picture as a share (the floating orb's Screen → Ask Wizard), so it opens in
     * the same share sheet as "Share to Wizard" from any app. Returns the share id.
     */
    public static String stage(Context c, String text, byte[] jpeg) throws IOException {
        ShareStore store = get(c);
        String id = store.newId();
        File dir = store.dir(id);
        org.json.JSONArray items = new org.json.JSONArray();
        try {
            if (jpeg != null && jpeg.length > 0) {
                try (FileOutputStream o = new FileOutputStream(new File(dir, "0.bin"))) { o.write(jpeg); }
                items.put(new org.json.JSONObject().put("n", 0).put("name", "screen.jpg").put("mime", "image/jpeg").put("bytes", jpeg.length));
            }
            org.json.JSONObject meta = new org.json.JSONObject().put("id", id).put("at", System.currentTimeMillis())
                    .put("items", items).put("skipped", 0).put("text", text == null ? "" : text.trim())
                    .put("subject", "").put("from", "Screen");
            store.save(id, meta.toString().getBytes(StandardCharsets.UTF_8));
        } catch (org.json.JSONException e) { store.delete(id); throw new IOException("Couldn’t stage the screen"); }
        return id;
    }

    static String safe(String id) { return String.valueOf(id).replaceAll("[^A-Za-z0-9._-]", "_"); }

    /** A display name that is safe as an upload filename header: no paths, no control chars, bounded length. */
    public static String safeName(String raw, int n) {
        String s = raw == null ? "" : raw;
        int slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
        if (slash >= 0) s = s.substring(slash + 1);
        s = s.replaceAll("[\\p{Cntrl}\"]", "").trim();
        if (s.isEmpty() || s.equals(".") || s.equals("..")) s = "shared-" + (n + 1);
        if (s.length() > 120) {
            int dot = s.lastIndexOf('.');
            String ext = dot > 0 && s.length() - dot <= 10 ? s.substring(dot) : "";
            s = s.substring(0, 120 - ext.length()) + ext;
        }
        return s;
    }
}
