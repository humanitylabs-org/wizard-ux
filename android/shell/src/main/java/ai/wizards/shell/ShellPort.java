package ai.wizards.shell;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;

import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

import ai.wizards.shell.device.DevicePort;

/**
 * Hosts window.wizardDevicePort (v1) in the shell's WebView. Injected only for the selected Wizard's exact origin;
 * a message is answered only when it comes from the main frame and the top-level page is that origin's
 * /wizard-os-home shell. Credentials never cross it. With no registered adapters it only answers discovery.
 */
final class ShellPort {
    private static final String TAG = "ShellPort";
    private final WebView web;
    private final Supplier<String> origin;
    private final DevicePort.Registry registry;
    private final ExecutorService work = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());

    private ShellPort(WebView web, Supplier<String> origin, DevicePort.Registry registry) {
        this.web = web; this.origin = origin; this.registry = registry;
    }

    /** Null when this WebView can't host the port (old WebView): the Wizard then sees no capabilities. */
    static ShellPort install(WebView web, String exactOrigin, Supplier<String> origin, DevicePort.Registry registry) {
        if (exactOrigin == null || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return null;
        ShellPort p = new ShellPort(web, origin, registry);
        try {
            WebViewCompat.addWebMessageListener(web, DevicePort.NAME, Collections.singleton(exactOrigin), p::onMessage);
        } catch (RuntimeException e) {
            Log.w(TAG, "no device port", e);
            return null;
        }
        return p;
    }

    void close() { work.shutdownNow(); }

    /** Top-level page is the selected Wizard's shell. Main thread. */
    private boolean shellOnTop(String want) {
        String u = web.getUrl();
        return u != null && ShellOrigin.same(want, u) && DevicePort.shellPath(Uri.parse(u).getPath());
    }

    private void onMessage(WebView view, WebMessageCompat message, Uri source, boolean isMainFrame, JavaScriptReplyProxy reply) {
        String want = origin.get();
        if (want == null || source == null || !ShellOrigin.same(want, source.toString()) || !isMainFrame || !shellOnTop(want)) return;
        final DevicePort.Request r;
        try { r = DevicePort.parse(text(message)); }
        catch (JSONException e) { post(reply, "", null, "invalid request"); return; }
        if (DevicePort.DISCOVERY.equals(r.method)) {
            try { post(reply, r.id, registry.capabilities(), null); } catch (JSONException e) { post(reply, r.id, null, "Something went wrong"); }
            return;
        }
        DevicePort.Target t = registry.target(r.method);
        if (t == null) { post(reply, r.id, null, "unknown method"); return; }
        try {
            work.execute(() -> t.adapter.call(t.method, r.params, new DevicePort.Reply() {
                @Override public void ok(Object result) { post(reply, r.id, result, null); }
                @Override public void error(String m) { post(reply, r.id, null, m == null ? "Something went wrong" : m); }
            }));
        } catch (RuntimeException e) { post(reply, r.id, null, "busy"); }
    }

    /** String payload or null. WebMessageCompat.getData() throws for ArrayBuffer messages (WebView 116+). */
    static String text(WebMessageCompat m) {
        return m == null || m.getType() != WebMessageCompat.TYPE_STRING ? null : m.getData();
    }

    private void post(JavaScriptReplyProxy reply, String id, Object result, String error) {
        main.post(() -> {
            try { reply.postMessage(DevicePort.answer(id, result, error).toString()); }
            catch (JSONException | RuntimeException ignored) { /* page gone */ }
        });
    }
}
