package ai.wizards.os;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Disk reads a cold start needs before it can do its bookkeeping (the meeting store with its custody index, Android's
 * process-exit records with their ANR traces) run here, off the UI thread, so the shell draws while they load
 * (wizard-ux#1769: a long meeting made them take seconds in onStart). The bookkeeping itself still runs on the main
 * thread afterwards, in the order it was asked for, so it stays in step with the recorder service.
 */
public final class StartupWork {
    private static final String TAG = "WizardStartup";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "WizardStartup");
        t.setDaemon(true);
        return t;
    });
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private StartupWork() {}

    /**
     * Runs {@code then} on the main thread once {@code load} has run on the startup thread. When {@code loaded} is
     * already true and this is the main thread, {@code then} runs at once, as it did before.
     */
    public static void then(boolean loaded, Runnable load, Runnable then) {
        if (loaded && Looper.myLooper() == Looper.getMainLooper()) { then.run(); return; }
        IO.execute(() -> {
            long t0 = android.os.SystemClock.elapsedRealtime();
            try { if (!loaded) load.run(); }
            catch (RuntimeException e) { Log.w(TAG, "startup load failed; the main thread tries again", e); }
            long ms = android.os.SystemClock.elapsedRealtime() - t0;
            if (ms > 200) Log.i(TAG, "startup load took " + ms + " ms off the UI thread");
            MAIN.post(then);
        });
    }
}
