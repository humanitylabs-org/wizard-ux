package ai.wizards.os;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Android's stock WebView scroll capture (ScrollCaptureViewSupport, API 31+) has a race: when
 * SystemUI cancels a slow tile request, a queued request can still run with a null
 * CancellationSignal and throw a NullPointerException on the main thread, killing the app.
 * This keeps the main loop alive for exactly that framework frame; any other crash propagates.
 */
final class ScrollCaptureCrashGuard {
    private static boolean installed;
    private ScrollCaptureCrashGuard() {}

    static boolean isFrameworkRace(Throwable e) {
        if (!(e instanceof NullPointerException)) return false;
        StackTraceElement[] st = e.getStackTrace();
        for (int i = 0; i < Math.min(st.length, 3); i++) {
            if ("com.android.internal.view.ScrollCaptureViewSupport".equals(st[i].getClassName())
                    && st[i].getMethodName().startsWith("onScrollCapture")) return true;
        }
        return false;
    }

    static void install() {
        if (installed || android.os.Build.VERSION.SDK_INT < 31) return;
        installed = true;
        new Handler(Looper.getMainLooper()).post(() -> {
            while (true) {
                try { Looper.loop(); return; }
                catch (RuntimeException e) {
                    if (!isFrameworkRace(e)) throw e;
                    Log.w("WizardScrollCapture", "absorbed framework scroll-capture cancel race", e);
                }
            }
        });
    }
}
