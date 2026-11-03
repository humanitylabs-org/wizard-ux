package ai.wizards.os.shellport;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/**
 * window.wizardShellPort: the shell's only route to the native features that used to sit on the all-frame
 * WizardOSNative / WizardOSDevice Java objects (issue 387 of wizard-os).
 *
 * AndroidX injects the port only into frames whose origin is the persisted owner origin; app frames on another or an
 * opaque origin never see it. A same-origin child frame does see the object, so the receiver itself refuses anything
 * that is not the main frame, on the exact origin, with the trusted shell document on top, from the reply proxy bound
 * to the current document generation. Refused messages have no effect and get no reply; the refusal is logged
 * (tag WizardShellPort) for the hostile-frame QA. Replies of a document that navigated away are dropped.
 *
 * There is no fallback: a WebView without WEB_MESSAGE_LISTENER gets no port at all, and the shell shows its
 * "update" state instead of reopening an addJavascriptInterface object.
 */
public final class ShellNativePort {
    public static final String TAG = "WizardShellPort";

    /** The reviewed command implementations (MainActivity.Bridge and DeviceBridge), called by exact name. */
    public interface Commands {
        Object call(String target, String method, JSONArray args) throws Exception;
        /** Cached reads for the facade's synchronous getters; {@code full=false} is the recording tick. */
        JSONObject state(boolean full) throws JSONException;
        boolean recording();
    }

    private final WebView web;
    private final String allowedOrigin;
    private final Supplier<String> persistedOrigin;
    private final BooleanSupplier trustedTop;
    private final Commands commands;
    private final ExecutorService bg = Executors.newSingleThreadExecutor(r -> new Thread(r, "WizardShellPort"));
    private final Handler main = new Handler(Looper.getMainLooper());

    // UI-thread state: WebMessageListener callbacks and every reply run on the main looper.
    private long generation;
    private JavaScriptReplyProxy bound;
    private long boundGeneration = -1;
    private boolean detached;
    private boolean foreground = true;
    private int ticks;

    private ShellNativePort(WebView web, String allowedOrigin, Supplier<String> persistedOrigin, BooleanSupplier trustedTop, Commands commands) {
        this.web = web; this.allowedOrigin = allowedOrigin; this.persistedOrigin = persistedOrigin;
        this.trustedTop = trustedTop; this.commands = commands;
    }

    /** Null when this WebView cannot offer a main-frame-checked port: fail closed, never an all-frame object. */
    public static ShellNativePort install(WebView web, String allowedOrigin, Supplier<String> persistedOrigin,
                                          BooleanSupplier trustedTop, Commands commands) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.w(TAG, "WebView lacks WEB_MESSAGE_LISTENER: no shell port (no addJavascriptInterface fallback)");
            return null;
        }
        if (allowedOrigin == null || allowedOrigin.isEmpty()) return null;
        ShellNativePort p = new ShellNativePort(web, allowedOrigin, persistedOrigin, trustedTop, commands);
        try {
            WebViewCompat.addWebMessageListener(web, ShellPortPolicy.NAME, Collections.singleton(allowedOrigin), p::onMessage);
        } catch (RuntimeException e) {
            Log.w(TAG, "addWebMessageListener failed: no shell port", e);
            return null;
        }
        Log.i(TAG, "installed for " + allowedOrigin);
        return p;
    }

    /**
     * A main-frame navigation committed: the old document's binding, pushes and pending replies are void.
     *
     * WebView can deliver the NEW document's first message (its hello) before this callback, so the binding just
     * voided may belong to the new document. The former bound proxy therefore gets a data-free "rebind": a gone
     * document never sees it, and a current one says hello again (core/native-shell-port.js) and is re-admitted
     * through the same checks. Nothing pending is redelivered.
     */
    public void onPageStarted() {
        JavaScriptReplyProxy was = bound;
        generation++; bound = null; boundGeneration = -1;
        if (was != null && !detached) {
            try { was.postMessage("{\"v\":1,\"type\":\"rebind\"}"); } catch (RuntimeException ignored) { }
        }
    }

    public void setForeground(boolean on) { foreground = on; if (on) pushState(); }

    public void detach() {
        detached = true; bound = null; main.removeCallbacks(tick);
        try { WebViewCompat.removeWebMessageListener(web, ShellPortPolicy.NAME); } catch (RuntimeException ignored) { }
        bg.shutdown();
    }

    /** True once the current document's facade said hello: native pushes go over the port, not evaluateJavascript. */
    public boolean bound() { return !detached && bound != null && boundGeneration == generation; }

    void onMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply) {
        String src = sourceOrigin == null || sourceOrigin.getScheme() == null || sourceOrigin.getHost() == null ? null
                : sourceOrigin.getScheme() + "://" + sourceOrigin.getHost() + (sourceOrigin.getPort() == -1 ? "" : ":" + sourceOrigin.getPort());
        ShellPortPolicy.Refusal refusal = ShellPortPolicy.admit(detached || view != web, isMainFrame, src, allowedOrigin,
                persistedOrigin.get(), isMainFrame && trustedTop.getAsBoolean());
        ShellPortPolicy.Call call = null;
        if (refusal == ShellPortPolicy.Refusal.NONE) {
            try { call = ShellPortPolicy.parse(text(message)); }
            catch (ShellPortPolicy.Rejected r) { refusal = r.refusal; }
        }
        if (call != null && !call.hello && (reply != bound || boundGeneration != generation)) refusal = ShellPortPolicy.Refusal.STALE_DOCUMENT;
        if (refusal != ShellPortPolicy.Refusal.NONE) {
            Log.w(TAG, "refused " + refusal + " frame=" + (isMainFrame ? "main" : "child") + " origin=" + src
                    + (call != null ? " method=" + ShellPortPolicy.logName(call.method) : ""));
            return;
        }
        final long gen = generation;
        final ShellPortPolicy.Call c = call;
        if (c.hello) {
            bound = reply; boundGeneration = gen;
            bg.execute(() -> {
                JSONObject result;
                try { result = new JSONObject().put("capabilities", ShellPortPolicy.capabilities()).put("state", commands.state(true)); }
                catch (JSONException e) { result = null; }
                final JSONObject r = result;
                main.post(() -> answer(reply, gen, c.id, r, r == null ? "Something went wrong" : null, null));
            });
            Log.i(TAG, "hello: main document bound (generation " + gen + ")");
            startTicking();
            return;
        }
        bg.execute(() -> {
            Object result = null; String error = null; JSONObject state = null;
            try { result = commands.call(c.target, c.method, c.args); }
            catch (Exception e) { Log.w(TAG, c.method + ": " + e); error = "Something went wrong"; }
            try { state = commands.state(true); } catch (JSONException ignored) { }
            final Object r = result; final String er = error; final JSONObject st = state;
            main.post(() -> { answer(reply, gen, c.id, r, er, st); startTicking(); });
        });
    }

    private void answer(JavaScriptReplyProxy reply, long gen, String id, Object result, String error, JSONObject state) {
        // Bound to the document that asked: a reply after a navigation (or a re-bind) is dropped, never redelivered.
        if (detached || gen != generation || reply != bound || boundGeneration != gen) {
            Log.i(TAG, "dropped reply for a replaced document");
            return;
        }
        try {
            JSONObject o = new JSONObject().put("v", ShellPortPolicy.VERSION).put("id", id).put("ok", error == null);
            if (error == null) o.put("result", result == null ? JSONObject.NULL : result); else o.put("error", error);
            if (state != null) o.put("state", state);
            reply.postMessage(o.toString());
        } catch (JSONException | RuntimeException e) { Log.w(TAG, "reply failed: " + e); }
    }

    /** Fresh cached reads to the bound document (after native-side changes: resume, insets, outbox, recorder). */
    public void pushState() { push(null, null); }

    /**
     * Runs one of {@link ShellPortPolicy#HOOKS} in the bound main document AFTER its cache holds fresh state. Returns
     * false when no document is bound (an older web shell): the caller keeps its evaluateJavascript path.
     */
    public boolean hook(String name, String argJson) {
        if (!ShellPortPolicy.HOOKS.contains(name) || !bound()) return false;
        push(name, argJson);
        return true;
    }

    private void push(String hook, String arg) {
        if (!bound()) return;
        final long gen = generation; final JavaScriptReplyProxy to = bound;
        bg.execute(() -> {
            JSONObject state = null;
            try { state = commands.state(true); } catch (JSONException ignored) { }
            final JSONObject st = state;
            main.post(() -> send(to, gen, hook == null ? "state" : "hook", st, hook, arg));
        });
    }

    private void send(JavaScriptReplyProxy to, long gen, String type, JSONObject state, String hook, String arg) {
        if (detached || gen != generation || to != bound) return;
        try {
            JSONObject o = new JSONObject().put("v", ShellPortPolicy.VERSION).put("type", type);
            if (state != null) o.put("state", state);
            if (hook != null) { o.put("hook", hook); o.put("arg", arg == null ? JSONObject.NULL : arg); }
            to.postMessage(o.toString());
        } catch (JSONException | RuntimeException e) { Log.w(TAG, "push failed: " + e); }
    }

    /* While a take records, the orb's level meter and timer read recLevel/recActive every ~100 ms. */
    private void startTicking() { main.removeCallbacks(tick); if (!detached) main.postDelayed(tick, 120); }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (detached || !bound() || !foreground) return;
            if (!commands.recording()) { if (ticks > 0) { ticks = 0; pushState(); } return; } // one final push after a take
            ticks++;
            final long gen = generation; final JavaScriptReplyProxy to = bound;
            bg.execute(() -> {
                JSONObject st = null;
                try { st = commands.state(false); } catch (JSONException ignored) { }
                final JSONObject s = st;
                main.post(() -> send(to, gen, "state", s, null, null));
            });
            main.postDelayed(this, 120);
        }
    };

    /** String payload or null: WebMessageCompat.getData() throws for ArrayBuffer messages (WebView 116+). */
    static String text(WebMessageCompat message) {
        return message == null || message.getType() != WebMessageCompat.TYPE_STRING ? null : message.getData();
    }
}
