package ai.wizards.os;

import android.annotation.TargetApi;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.graphics.Rect;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.ScrollCaptureCallback;
import android.view.ScrollCaptureSession;
import android.webkit.WebView;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.Consumer;

/** Android 12+ system screenshot integration. Pixels never leave the OS-owned session surface. */
@TargetApi(31)
final class ChatScrollCapture implements ScrollCaptureCallback {
    private final WebView web;
    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final String script;
    private String id;
    private double scale, initial;
    private Rect bounds;
    private Pending pending;
    private boolean restoring;
    private final java.util.ArrayList<Runnable> restored = new java.util.ArrayList<>();
    private final Runnable deadline = () -> abort();

    ChatScrollCapture(Activity activity, WebView web) {
        this.activity = activity; this.web = web;
        String source;
        try (java.io.InputStream in = activity.getAssets().open("scroll-capture.js")) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            source = out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) { source = ""; }
        script = source;
        web.setScrollCaptureHint(android.view.View.SCROLL_CAPTURE_HINT_INCLUDE);
        web.setScrollCaptureCallback(this);
    }

    private boolean eligible() {
        Uri u = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        return !script.isEmpty() && web.isAttachedToWindow() && web.isShown() &&
            (activity.getWindow().getAttributes().flags & android.view.WindowManager.LayoutParams.FLAG_SECURE) == 0 &&
            (Origin.isPrivate(u) || ai.wizards.os.device.AppState.isQaPage(activity, u));
    }

    private final class Pending {
        final CancellationSignal signal;
        final Runnable failure;
        final Runnable timeout = () -> fail();
        boolean done;
        Pending(CancellationSignal signal, Runnable failure) {
            this.signal = signal; this.failure = failure;
            if (pending != null) pending.fail();
            pending = this;
            main.postDelayed(timeout, 1800);
            signal.setOnCancelListener(() -> main.post(this::fail));
        }
        boolean live() { return !done && !signal.isCanceled() && pending == this; }
        void finish(Runnable success) {
            if (!live()) return;
            done = true; main.removeCallbacks(timeout); pending = null;
            signal.setOnCancelListener(null); success.run();
        }
        void fail() {
            if (done) return;
            done = true; main.removeCallbacks(timeout);
            if (pending == this) pending = null;
            signal.setOnCancelListener(null);
            restore(failure);
        }
    }

    private void js(String expression, Consumer<JSONObject> reply) {
        web.evaluateJavascript(expression, raw -> {
            JSONObject result = null;
            try { result = new JSONObject(raw); } catch (Exception ignored) { }
            reply.accept(result);
        });
    }
    private String call(String method, String args) {
        return "window.__wosScrollCapture&&window.__wosScrollCapture." + method + "(" + args + ")";
    }
    private Rect rect(JSONObject b) {
        return new Rect((int)Math.ceil(b.optDouble("x")*scale), (int)Math.ceil(b.optDouble("y")*scale),
            (int)Math.floor((b.optDouble("x")+b.optDouble("w"))*scale),
            (int)Math.floor((b.optDouble("y")+b.optDouble("h"))*scale));
    }
    @Override public void onScrollCaptureSearch(CancellationSignal signal, Consumer<Rect> ready) {
        if (!eligible() || id != null || restoring) { ready.accept(new Rect()); return; }
        Pending p = new Pending(signal, () -> ready.accept(new Rect()));
        js(script + ";" + call("search", ""), b -> {
            if (!p.live()) return;
            if (b == null || b.optDouble("vw") <= 0) { p.fail(); return; }
            // innerWidth is integer-rounded on fractional-density phones. Using
            // width/innerWidth accumulates missing bands between capture tiles.
            scale = b.optDouble("dpr", 0);
            if (scale <= 0 || Math.abs(web.getWidth() / scale - b.optDouble("vw")) > 2) { p.fail(); return; }
            bounds = rect(b);
            Rect visible = new Rect(); web.getLocalVisibleRect(visible);
            if (!visible.contains(bounds)) { p.fail(); return; }
            p.finish(() -> ready.accept(new Rect(bounds)));
        });
    }
    @Override public void onScrollCaptureStart(ScrollCaptureSession session, CancellationSignal signal, Runnable ready) {
        if (!eligible() || bounds == null || restoring) { ready.run(); return; }
        Pending p = new Pending(signal, ready);
        id = UUID.randomUUID().toString(); final String token = id;
        js(call("start", JSONObject.quote(token)), b -> {
            if (!p.live() || !token.equals(id)) return;
            if (b == null || !rect(b).equals(session.getScrollBounds())) { p.fail(); return; }
            initial = b.optDouble("top");
            main.postDelayed(deadline, 30000);
            p.finish(ready);
        });
    }
    @Override public void onScrollCaptureImageRequest(ScrollCaptureSession session, CancellationSignal signal,
                                                      Rect request, Consumer<Rect> complete) {
        if (!eligible() || id == null || pending != null) { complete.accept(new Rect()); return; }
        Pending p = new Pending(signal, () -> complete.accept(new Rect()));
        final String token = id;
        final Rect area = new Rect(request);
        js(call("move", JSONObject.quote(token) + "," + (initial + area.top/scale)), b -> {
            if (!p.live() || !token.equals(id)) return;
            if (b == null) { p.fail(); return; }
            int delta = (int)Math.round((b.optDouble("top") - initial)*scale);
            Rect available = new Rect(0, delta, bounds.width(), delta + bounds.height());
            if (!available.intersect(area)) { p.finish(() -> complete.accept(new Rect())); return; }
            // Synchronize WebView's compositor, then wait two draws before reading the window buffer.
            web.postVisualStateCallback(System.nanoTime(), new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    web.postOnAnimation(() -> web.postOnAnimation(() -> {
                        if (!p.live() || !token.equals(id)) return;
                        js(call("check", JSONObject.quote(token)), now -> {
                            if (!p.live() || !token.equals(id)) return;
                            if (now == null || now.optDouble("top") != b.optDouble("top")) { p.fail(); return; }
                            copy(session, p, available, delta, token, b.optDouble("top"), complete);
                        });
                    }));
                }
            });
        });
    }
    private void copy(ScrollCaptureSession session, Pending p, Rect available, int delta, String token,
                      double top, Consumer<Rect> complete) {
        if (!eligible()) { p.fail(); return; }
        int[] location = new int[2]; web.getLocationInWindow(location);
        Rect source = new Rect(available);
        source.offset(bounds.left + location[0], bounds.top + location[1] - delta);
        Bitmap bitmap = Bitmap.createBitmap(source.width(), source.height(), Bitmap.Config.ARGB_8888);
        try {
            PixelCopy.request(activity.getWindow(), source, bitmap, result -> {
                if (!p.live() || !token.equals(id) || result != PixelCopy.SUCCESS) {
                    bitmap.recycle(); p.fail(); return;
                }
                // PixelCopy is asynchronous. A route or DOM change during acquisition must
                // never submit pixels from a different thread to the old OS capture session.
                js(call("check", JSONObject.quote(token)), now -> {
                    try {
                        if (!p.live() || !token.equals(id)) return;
                        if (!eligible() || now == null || now.optDouble("top") != top) { p.fail(); return; }
                        Canvas canvas = session.getSurface().lockHardwareCanvas();
                        try {
                            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
                            canvas.drawBitmap(bitmap, 0, 0, null);
                        } finally { session.getSurface().unlockCanvasAndPost(canvas); }
                        p.finish(() -> complete.accept(new Rect(available)));
                    } catch (RuntimeException e) { p.fail(); }
                    finally { bitmap.recycle(); }
                });
            }, main);
        } catch (RuntimeException e) { bitmap.recycle(); p.fail(); }
    }
    private void restore(Runnable ready) {
        if (ready != null) restored.add(ready);
        if (restoring) return;
        String old = id; id = null; main.removeCallbacks(deadline);
        if (old == null) { finishRestore(); return; }
        restoring = true;
        // Token-scoped cleanup cannot affect a newer capture, document or thread.
        final boolean[] sent = {false};
        Runnable once = () -> { if (!sent[0]) { sent[0] = true; finishRestore(); } };
        main.postDelayed(once, 500);
        web.evaluateJavascript(call("end", JSONObject.quote(old)), ignored -> once.run());
    }
    private void finishRestore() {
        restoring = false;
        java.util.ArrayList<Runnable> callbacks = new java.util.ArrayList<>(restored);
        restored.clear();
        for (Runnable callback : callbacks) callback.run();
    }
    void abort() { if (pending != null) pending.fail(); restore(null); }
    @Override public void onScrollCaptureEnd(Runnable ready) {
        if (pending != null) pending.fail();
        restore(ready);
    }
}
