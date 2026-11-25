package ai.wizards.os.assist;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.SecureRandom;
import java.util.List;

import ai.wizards.os.everywhere.EverywhereOutbox;

/**
 * Pictures and files picked with the corner orb's Camera and Attach (wizard-os issue 655)
 * wait here, one private file each, until the take is sent (the outbox moves them into its own folder) or thrown away.
 * They are streamed to disk as they are read, so eight large files never sit in memory at once. Never audio.
 */
public final class PickedFiles {
    private static final long STALE_MS = 24L * 60 * 60 * 1000;

    private PickedFiles() { }

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "assist-picked");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static File fresh(Context c) {
        byte[] t = new byte[12];
        new SecureRandom().nextBytes(t);
        StringBuilder hex = new StringBuilder();
        for (byte b : t) hex.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
        return new File(dir(c), hex + ".bin");
    }

    /** Copies the stream into a new private file, fsynced. Null when it is bigger than one file may be (nothing kept). */
    static File copy(Context c, InputStream in) throws IOException {
        File out = fresh(c);
        boolean ok = false;
        try (FileOutputStream o = new FileOutputStream(out)) {
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            for (int n; (n = in.read(buf)) > 0; ) {
                total += n;
                if (total > AttachPolicy.MAX_BYTES) return null;
                o.write(buf, 0, n);
            }
            o.getFD().sync();
            ok = true;
            return out;
        } finally {
            if (!ok) drop(out);
        }
    }

    /** Throws away the copies of a take that was cancelled or never carried them. */
    public static void drop(List<EverywhereOutbox.Attachment> picked) {
        if (picked == null) return;
        for (EverywhereOutbox.Attachment a : picked) if (a != null) drop(a.file);
    }

    public static void drop(File pickedCopy) {
        if (pickedCopy == null) return;
        //noinspection ResultOfMethodCallIgnored
        pickedCopy.delete();
    }

    /** Copies a process death left behind (a take that never finished); older than a day. */
    static void prune(Context c) {
        File[] fs = dir(c).listFiles();
        if (fs == null) return;
        long now = System.currentTimeMillis();
        for (File f : fs) if (now - f.lastModified() > STALE_MS) drop(f);
    }
}
