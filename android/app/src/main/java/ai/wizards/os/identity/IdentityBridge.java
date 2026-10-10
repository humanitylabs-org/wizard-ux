package ai.wizards.os.identity;

import android.app.Activity;
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
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

import ai.wizards.os.BuildConfig;
import ai.wizards.os.device.AppState;

/**
 * window.wizardIdentityPort: Wizard ID for the Wizard OS shell (spec: wizard-os/spec/WIZARD_ID.md).
 *
 * Reachable only from the shell itself: AndroidX injects the port only into frames on the private origin, and only
 * the main frame at /wizard-os-home/ is answered. App frames never reach it directly.
 *
 * page → {id, method, params}; native → {id, ok, result | error}; push → {type:'changed'}.
 *   status            → {exists, pubkey?, npub?, name?, backedUp?, origin?, perUseAuth}
 *   setup             → opens create / bring / manage screens; resolves with status (+ signed: [kind-0] after create)
 *   sign {event}      → opens the approval sheet; resolves {event: signed} or fails denied | expired | busy |
 *                       no-identity | invalid: …
 * The private key never crosses this port; there is no method that returns it.
 */
public final class IdentityBridge implements IdentityHub.Changed {
    public static final String NAME = "wizardIdentityPort";
    public static final int VERSION = 1;
    static final String TAG = "WizardID";

    private final Activity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private JavaScriptReplyProxy last;

    private IdentityBridge(Activity a, WebView w) { activity = a; web = w; }

    public static IdentityBridge install(Activity a, WebView web) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return null;
        IdentityBridge b = new IdentityBridge(a, web);
        try {
            Set<String> allow = new HashSet<>(Collections.singleton(AppState.primaryOrigin(a)));
            if (BuildConfig.ORIGIN.equals(AppState.primaryOrigin(a))) allow.add(AppState.LEGACY_ORIGIN);
            WebViewCompat.addWebMessageListener(web, NAME, allow, b::onMessage);
        } catch (RuntimeException e) {
            Log.w(TAG, "addWebMessageListener failed: no Wizard ID bridge", e);
            return null;
        }
        IdentityHub.listen(b);
        return b;
    }

    public void detach() { IdentityHub.unlisten(this); last = null; }

    @Override
    public void changed() {
        main.post(() -> { if (last != null) try { last.postMessage("{\"type\":\"changed\"}"); } catch (RuntimeException ignored) { } });
    }

    private boolean shellOnTop() {
        String u = web.getUrl();
        if (u == null) return false;
        Uri x = Uri.parse(u);
        String path = x.getPath() == null ? "" : x.getPath();
        boolean shellPath = path.equals("/wizard-os-home") || path.startsWith("/wizard-os-home/");
        if (BuildConfig.DEBUG && AppState.isQaPage(activity, x)) return shellPath;
        String host = "https://" + x.getHost();
        return "https".equals(x.getScheme()) && (BuildConfig.ORIGIN.equals(host) || AppState.LEGACY_ORIGIN.equals(host))
                && (x.getPort() == -1 || x.getPort() == 443) && shellPath;
    }

    private void onMessage(WebView view, WebMessageCompat message, Uri source, boolean isMainFrame, JavaScriptReplyProxy reply) {
        if (source == null || !AppState.origin(activity).equals(originOf(source))) return;
        if (!isMainFrame || !shellOnTop()) { Log.w(TAG, "refused: not the shell"); return; }
        last = reply;
        JSONObject m;
        try { m = new JSONObject(message == null || message.getData() == null ? "" : message.getData()); } catch (JSONException e) { return; }
        String id = m.optString("id", "");
        if (id.length() > 64) return;
        String method = m.optString("method", "");
        JSONObject params = m.optJSONObject("params") == null ? new JSONObject() : m.optJSONObject("params");
        switch (method) {
            case "status":
                answer(reply, id, status(new KeyVault(activity)), null);
                return;
            case "setup":
                IdentityHub.open(activity, IdentityHub.MODE_SETUP, null, (r, e) -> main.post(() ->
                        answer(reply, id, r != null ? r : status(new KeyVault(activity)), e)));
                return;
            case "sign": {
                if (!new KeyVault(activity).exists()) { answer(reply, id, null, "no-identity"); return; }
                JSONObject ev = params.optJSONObject("event");
                if (ev == null) { answer(reply, id, null, "invalid: No event to sign."); return; }
                IdentityHub.open(activity, IdentityHub.MODE_SIGN, ev, (r, e) -> main.post(() -> answer(reply, id, r, e)));
                return;
            }
            default:
                answer(reply, id, null, "unknown method");
        }
    }

    static JSONObject status(KeyVault v) {
        try {
            JSONObject o = new JSONObject().put("bridge", VERSION).put("exists", v.exists()).put("perUseAuth", KeyVault.perUseAuth());
            if (v.exists()) o.put("pubkey", v.publicKey()).put("npub", KeyText.npub(v.publicKey())).put("name", v.name())
                    .put("backedUp", v.backedUp()).put("origin", v.origin());
            return o;
        } catch (JSONException e) { return new JSONObject(); }
    }

    private static void answer(JavaScriptReplyProxy reply, String id, JSONObject result, String err) {
        try {
            JSONObject o = new JSONObject().put("id", id).put("ok", err == null);
            if (err != null) o.put("error", err); else o.put("result", result == null ? JSONObject.NULL : result);
            reply.postMessage(o.toString());
        } catch (JSONException | RuntimeException ignored) { }
    }

    static String originOf(Uri u) {
        int port = u.getPort();
        return u.getScheme() + "://" + u.getHost() + (port == -1 ? "" : ":" + port);
    }
}
