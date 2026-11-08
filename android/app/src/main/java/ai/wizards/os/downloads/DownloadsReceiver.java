package ai.wizards.os.downloads;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.concurrent.ThreadPoolExecutor;

/**
 * DownloadManager.ACTION_DOWNLOAD_COMPLETE: records the finish and tells the open shell page (if any).
 * Exported on purpose (the sender is DownloadProvider, not this app or the system UID), so the id is validated against
 * the tracked list first and the work runs on one bounded worker; see {@link DownloadsReceiverPolicy}.
 */
public final class DownloadsReceiver extends BroadcastReceiver {
    private static final ThreadPoolExecutor WORK = DownloadsReceiverPolicy.newExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        final long id = intent.getLongExtra(android.app.DownloadManager.EXTRA_DOWNLOAD_ID, -1);
        final Context app = context.getApplicationContext();
        if (!DownloadsReceiverPolicy.accept(intent.getAction(), id, tracked -> Downloads.isTracked(app, tracked))) return;
        final PendingResult pending = goAsync();
        boolean queued = DownloadsReceiverPolicy.submit(WORK, () -> {
            try { Downloads.onComplete(app, id); }
            finally { pending.finish(); }
        });
        if (!queued) pending.finish();
    }
}
