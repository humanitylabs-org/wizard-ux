package ai.wizards.os.downloads;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.LongPredicate;

/**
 * Pure rules for {@link DownloadsReceiver}. The receiver must stay exported (DownloadProvider, another app's UID, sends
 * DOWNLOAD_COMPLETE), so any app can send the same action. What is controlled here is the cost of a forged broadcast:
 * the id is checked against what WizardOS tracks BEFORE any work or thread exists, and accepted work runs on one
 * small bounded worker instead of a thread per id.
 */
public final class DownloadsReceiverPolicy {
    private DownloadsReceiverPolicy() { }

    public static final String ACTION = "android.intent.action.DOWNLOAD_COMPLETE";
    /** Queued completions beyond the one running. A burst larger than this is refused; the list refresh still catches up. */
    public static final int MAX_QUEUE = 16;

    /** True only for the exact action, a non-negative id, and an id WizardOS started. The lookup is never reached otherwise. */
    public static boolean accept(String action, long id, LongPredicate tracked) {
        if (!ACTION.equals(action) || id < 0 || tracked == null) return false;
        return tracked.test(id);
    }

    /** One worker, small bounded queue, no thread until the first accepted completion, idle thread released. */
    public static ThreadPoolExecutor newExecutor() {
        ThreadPoolExecutor ex = new ThreadPoolExecutor(1, 1, 10, TimeUnit.SECONDS, new ArrayBlockingQueue<>(MAX_QUEUE),
                r -> { Thread t = new Thread(r, "wizard-downloads-complete"); t.setDaemon(true); return t; },
                new ThreadPoolExecutor.AbortPolicy());
        ex.allowCoreThreadTimeOut(true);
        return ex;
    }

    /** False when the work was refused (queue full or executor shut down); the caller must still finish the broadcast. */
    public static boolean submit(ThreadPoolExecutor ex, Runnable work) {
        try { ex.execute(work); return true; }
        catch (RejectedExecutionException e) { return false; }
    }
}
