package ai.wizards.os;

import android.content.Context;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;

/**
 * Notices a blocked UI thread while WizardOS is in front (wizard-ux#1762: "WizardOS isn't responding" with no stack in
 * the diagnostics). A background thread asks the main thread to answer once a second; when it hasn't answered for
 * {@link #STALL_MS} (before Android's 5 s ANR) the main thread's stack is saved to {@link HangLog}, once per stall, and
 * the stall's real length is written when it ends. Uptime clock, so a sleeping phone never counts as a hang.
 * Also records a WebView page process that stopped responding (kind "webview"), so page JS and native can be told apart.
 */
public final class HangWatch {
    static final String TAG = "WizardHang";
    static final long STALL_MS = 4000, TICK_MS = 1000;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static HangLog log;
    private static HandlerThread thread;
    private static Handler bg;
    private static Context app;
    private static volatile long beatAt;
    private static volatile boolean waiting;
    private static HangLog.Hang open, webview;
    private static int users;

    private HangWatch() {}

    public static synchronized HangLog log(Context c) {
        if (log == null) log = new HangLog(new File(new File(c.getApplicationContext().getFilesDir(), "diagnostics"), "hangs.json"));
        return log;
    }

    private static final Runnable beat = () -> {
        long now = SystemClock.uptimeMillis();
        HangLog.Hang h;
        synchronized (HangWatch.class) { h = open; open = null; waiting = false; beatAt = now; }
        if (h == null) return;
        final long ms = now - h.at0;
        Log.w(TAG, "UI thread answered again after " + ms + " ms");
        Handler b = bg; // the file write and the report never run on the UI thread
        Runnable done = () -> { log.lasted(h, ms); ScrollCaptureDiagnostics.hang(app); };
        if (b == null || !b.post(done)) new Thread(done, "WizardHangReport").start();
    };

    private static final Runnable check = new Runnable() {
        @Override public void run() {
            long now = SystemClock.uptimeMillis();
            synchronized (HangWatch.class) {
                if (bg == null) return;
                if (!waiting) { waiting = true; beatAt = now; MAIN.post(beat); }
                else if (open == null && now - beatAt >= STALL_MS) {
                    HangLog.Hang h = new HangLog.Hang();
                    h.at = System.currentTimeMillis() - (now - beatAt); h.at0 = beatAt; h.ms = now - beatAt; h.kind = "main";
                    h.frames.addAll(HangLog.frames(Looper.getMainLooper().getThread().getStackTrace()));
                    open = h;
                    log.add(h);
                    Log.w(TAG, "UI thread blocked " + h.ms + " ms at " + (h.frames.isEmpty() ? "?" : h.frames.get(0)));
                }
                bg.postDelayed(this, TICK_MS);
            }
        }
    };

    /** An Activity came to the front. Counted, so a second Activity (app session) can't stop the first one's watch. */
    public static synchronized void start(Context c) {
        app = c.getApplicationContext();
        log(app);
        users++;
        if (bg != null) return;
        thread = new HandlerThread("WizardHangWatch");
        thread.start();
        bg = new Handler(thread.getLooper());
        waiting = false; open = null;
        bg.post(check);
    }

    public static synchronized void stop() {
        if (users > 0) users--;
        if (users > 0 || bg == null) return;
        bg.removeCallbacksAndMessages(null);
        MAIN.removeCallbacks(beat);
        thread.quitSafely();
        bg = null; thread = null; waiting = false; open = null;
    }

    /** WebView told us its page process stopped answering input (WebViewRenderProcessClient). */
    public static void webviewUnresponsive(Context c) {
        HangLog l = log(c);
        synchronized (HangWatch.class) {
            if (webview != null) return;
            HangLog.Hang h = new HangLog.Hang();
            h.at = System.currentTimeMillis(); h.at0 = SystemClock.uptimeMillis(); h.kind = "webview";
            webview = h;
            l.add(h);
        }
        Log.w(TAG, "WebView page process stopped responding");
    }

    public static void webviewResponsive(Context c) {
        HangLog.Hang h;
        synchronized (HangWatch.class) { h = webview; webview = null; }
        if (h == null) return;
        long ms = SystemClock.uptimeMillis() - h.at0;
        log(c).lasted(h, ms);
        Log.w(TAG, "WebView page process answered again after " + ms + " ms");
        ScrollCaptureDiagnostics.hang(c);
    }
}
