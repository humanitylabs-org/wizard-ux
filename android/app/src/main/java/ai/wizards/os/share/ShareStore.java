package ai.wizards.os.share;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;

/** Staged shares: files/share/<id>/{meta.json, 0.bin, 1.bin, …}. Deleted once Wizard OS has them (or after a day). */
public final class ShareStore {
    public static final int MAX_ITEMS = 8;
    public static final long MAX_BYTES = 64L * 1024 * 1024;
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

    public void delete(String id) {
        File d = new File(root, safe(id));
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) //noinspection ResultOfMethodCallIgnored
            f.delete();
        //noinspection ResultOfMethodCallIgnored
        d.delete();
    }

    /** Shares older than a day that were never picked up. */
    public void prune() {
        File[] ds = root.listFiles();
        if (ds == null) return;
        for (File d : ds) if (System.currentTimeMillis() - d.lastModified() > 24 * 3600_000L) delete(d.getName());
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
