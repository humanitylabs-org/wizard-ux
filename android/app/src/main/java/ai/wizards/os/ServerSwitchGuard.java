package ai.wizards.os;

import android.content.Context;
import java.io.File;

/** Fail closed rather than re-home a recording/share captured for a different owner. */
final class ServerSwitchGuard {
    private ServerSwitchGuard() {}
    static boolean hasLocalWork(Context c) {
        if (ai.wizards.os.update.UpdateChannel.recording(c)
                || !ai.wizards.os.everywhere.EverywhereOutbox.get(c).unsent().isEmpty()
                || ai.wizards.os.share.ShareQueue.get(c).pending()
                || !ai.wizards.os.recording.RecordingStore.get(c).pending(null).isEmpty()) return true;
        // Completed meetings may still have delayed marker/status work. Preserve their server binding until pruned.
        return hasFiles(new File(c.getFilesDir(), "mizel")) || hasFiles(new File(c.getFilesDir(), "meeting-events"));
    }
    private static boolean hasFiles(File f) {
        if (f.isFile()) return true;
        File[] children = f.listFiles();
        if (children == null) return f.exists();
        for (File child : children) if (hasFiles(child)) return true;
        return false;
    }
}
