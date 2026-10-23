package ai.wizards.os.apps;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import ai.wizards.os.BuildConfig;
import ai.wizards.os.device.AppState;
import ai.wizards.os.device.DeviceMessageProtocol;

/**
 * window.wizardAppsPort: the Android Apps bridge.
 *
 * Who can reach it: AndroidX addWebMessageListener injects the port only into frames whose origin is the private
 * Wizard origin; on top of that, only the MAIN frame — the Wizard OS shell itself — is answered. Hosted app frames
 * never talk to native directly: the shell relay (web/core/android-relay.js) forwards messages from the Android Apps
 * frame (/android-apps/) only, and only for {@link AppsPolicy#METHODS}. Every method re-validates its arguments here.
 *
 * Protocol (JSON strings): page → {id, method, params}; native → {id, ok, result | error}; pushes → {type:'status'|'resume', ...}.
 */
public final class AppsBridge implements AppsInstaller.Listener {
    public static final String NAME = "wizardAppsPort";
    public static final int VERSION = 1;
    private static final int MAX_FRAMES = 4;

    private final Activity activity;
    private final WebView web;
    private final LinkedHashSet<JavaScriptReplyProxy> frames = new LinkedHashSet<>();
    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private AppsBridge(Activity a, WebView w) { activity = a; web = w; }

    /** Installs the port on {@code web}; null if this WebView can't (old WebView: the view says "update"). */
    public static AppsBridge install(Activity a, WebView web) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.w(AppsInstaller.TAG, "WebView lacks WEB_MESSAGE_LISTENER: no Android Apps bridge");
            return null;
        }
        AppsBridge b = new AppsBridge(a, web);
        try {
            java.util.Set<String> allow = new java.util.HashSet<>(Collections.singleton(AppState.primaryOrigin(a)));
            WebViewCompat.addWebMessageListener(web, NAME, allow, b::onMessage);
            WebViewCompat.addWebMessageListener(web, DeviceMessageProtocol.NAME, allow, b::onDeviceMessage);
        } catch (RuntimeException e) {
            WebViewCompat.removeWebMessageListener(web, NAME);
            WebViewCompat.removeWebMessageListener(web, DeviceMessageProtocol.NAME);
            Log.w(AppsInstaller.TAG, "addWebMessageListener failed: no Android Apps bridge", e);
            return null;
        }
        AppsInstaller.listener = b;
        return b;
    }

    public void detach() {
        if (AppsInstaller.listener == this) AppsInstaller.listener = null;
        frames.clear();
        bg.shutdown();
    }

    /** Wizard OS came back to the front (after Android's installer, uninstall dialog, app info, Play): refresh. */
    public void onResume() {
        if (frames.isEmpty()) return;
        push("{\"type\":\"resume\"}");
        AppsInstaller.postInventorySoon(activity);
    }

    @Override
    public void onStatus(JSONObject s) {
        try { push(new JSONObject().put("type", "status").put("status", s).toString()); } catch (JSONException ignored) { }
    }

    private void push(String json) {
        List<JavaScriptReplyProxy> to = new ArrayList<>(frames);
        for (JavaScriptReplyProxy p : to) post(p, json);
    }

    private void post(JavaScriptReplyProxy p, String json) {
        try { p.postMessage(json); } catch (RuntimeException e) { frames.remove(p); }
    }

    /** The main frame must be the Wizard OS shell on the trusted origin (QA builds: the loopback fake). */
    boolean shellOnTop() {
        String u = web.getUrl();
        if (u == null) return false;
        Uri x = Uri.parse(u);
        String path = x.getPath() == null ? "" : x.getPath();
        boolean shellPath = path.equals("/wizard-os-home") || path.startsWith("/wizard-os-home/");
        if (BuildConfig.DEBUG && AppState.isQaPage(activity, x)) return shellPath;
        return ai.wizards.os.ServerOrigin.matches(AppState.primaryOrigin(activity), u) && shellPath;
    }

    private void onMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply) {
        String want = AppState.origin(activity);
        if (sourceOrigin == null || !want.equals(originOf(sourceOrigin))) return;
        if (!isMainFrame || !shellOnTop()) { Log.w(AppsInstaller.TAG, "refused: not the shell (" + (isMainFrame ? "main" : "frame") + ")"); return; }
        String data = text(message);
        JSONObject m;
        try { m = new JSONObject(data == null ? "" : data); } catch (JSONException e) { return; }
        final String id = m.optString("id", "");
        final String method = m.optString("method", "");
        final JSONObject params = m.optJSONObject("params") == null ? new JSONObject() : m.optJSONObject("params");
        frames.remove(reply);
        frames.add(reply);
        while (frames.size() > MAX_FRAMES) frames.remove(frames.iterator().next());
        if (!AppsPolicy.method(method)) { answer(reply, id, null, "unknown method"); return; }
        bg.execute(() -> {
            Object result = null; String err = null;
            try { result = call(method, params); }
            catch (Refusal e) { err = e.getMessage(); }
            catch (JSONException | RuntimeException e) { Log.w(AppsInstaller.TAG, method + ": " + e); err = "Something went wrong"; }
            final Object r = result; final String er = err;
            main.post(() -> answer(reply, id, r, er));
        });
    }

    /** Additive generic request/reply port. Legacy subscriptions remain on wizardAppsPort. */
    private void onDeviceMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply) {
        String want = AppState.origin(activity);
        if (sourceOrigin == null || !want.equals(originOf(sourceOrigin)) || !isMainFrame || !shellOnTop()) return;
        final DeviceMessageProtocol.Request request;
        try {
            String data = text(message);
            request = DeviceMessageProtocol.parse(new JSONObject(data == null ? "" : data));
        } catch (JSONException e) {
            // No valid correlation envelope: do not echo untrusted values or exception details.
            deviceAnswer(reply, "", null, "invalid request");
            return;
        }
        if ("device.capabilities".equals(request.method)) {
            try { deviceAnswer(reply, request.id, DeviceMessageProtocol.capabilities(), null); }
            catch (JSONException e) { deviceAnswer(reply, request.id, null, "Something went wrong"); }
            return;
        }
        final String automation = DeviceMessageProtocol.automationMethod(request.method);
        if (automation != null) {
            // Accessibility automation drives the UI and its overlay: main thread. Same port checks as packages.
            Object result = null; String error = null;
            try { result = ai.wizards.os.automation.AutomationPort.call(activity, automation, request.params); }
            catch (ai.wizards.os.automation.AutomationPort.Refusal e) { error = e.getMessage(); }
            catch (JSONException | RuntimeException e) { Log.w(AppsInstaller.TAG, "automation " + automation + ": " + e); error = "Something went wrong"; }
            deviceAnswer(reply, request.id, result, error);
            return;
        }
        final String method = DeviceMessageProtocol.packageMethod(request.method);
        if (method == null || !AppsPolicy.method(method)) {
            deviceAnswer(reply, request.id, null, "unknown method");
            return;
        }
        bg.execute(() -> {
            Object result = null; String error = null;
            try { result = call(method, request.params); }
            catch (Refusal e) { error = e.getMessage(); }
            catch (JSONException | RuntimeException e) { error = "Something went wrong"; }
            final Object r = result; final String er = error;
            main.post(() -> deviceAnswer(reply, request.id, r, er));
        });
    }

    private void deviceAnswer(JavaScriptReplyProxy reply, String id, Object result, String error) {
        try { post(reply, DeviceMessageProtocol.answer(id, result, error).toString()); }
        catch (JSONException ignored) { }
    }

    /** String payload, or null. WebMessageCompat.getData() THROWS for ArrayBuffer messages (WebView 116+ delivers
     *  them to every listener), which would crash Wizard OS on the main thread. */
    static String text(WebMessageCompat message) {
        return message == null || message.getType() != WebMessageCompat.TYPE_STRING ? null : message.getData();
    }

    static String originOf(Uri u) {
        int port = u.getPort();
        return u.getScheme() + "://" + u.getHost() + (port == -1 ? "" : ":" + port);
    }

    private void answer(JavaScriptReplyProxy reply, String id, Object result, String err) {
        try {
            JSONObject o = new JSONObject().put("id", id).put("ok", err == null);
            if (err != null) o.put("error", err); else o.put("result", result == null ? JSONObject.NULL : result);
            post(reply, o.toString());
        } catch (JSONException ignored) { }
    }

    static final class Refusal extends Exception { Refusal(String m) { super(m); } }

    private static String pkg(JSONObject p) throws Refusal {
        String s = p.optString("package", "");
        if (!AppsPolicy.pkg(s)) throw new Refusal("No such app");
        return s;
    }

    private String installed(JSONObject p) throws Refusal {
        String s = pkg(p);
        if (AppsCatalog.installedVc(activity, s) < 0) throw new Refusal("That app isn’t installed");
        return s;
    }

    private Object call(String method, JSONObject p) throws Refusal, JSONException {
        switch (method) {
            case "status":
                return new JSONObject().put("bridge", VERSION).put("app", activity.getPackageName())
                        .put("version", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
                        .put("sdk", Build.VERSION.SDK_INT).put("canInstall", activity.getPackageManager().canRequestPackageInstalls())
                        .put("installs", AppsInstaller.status());
            case "list":
                AppsUpdateJob.schedule(activity); // the add-on is in use: keep its apps updated from now on
                return new JSONObject().put("apps", AppsCatalog.list(activity)).put("self", activity.getPackageName()).put("sdk", Build.VERSION.SDK_INT);
            case "icon": {
                String s = installed(p);
                return new JSONObject().put("package", s).put("data", AppsCatalog.icon(activity, s, p.optInt("px", 96)));
            }
            case "launch": {
                String s = installed(p);
                Intent i = activity.getPackageManager().getLaunchIntentForPackage(s);
                if (i == null) throw new Refusal("That app has nothing to open");
                start(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return true;
            }
            case "openPlay": {
                String s = pkg(p);
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + s)).setPackage("com.android.vending");
                try { start(i); }
                catch (Refusal e) { start(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + s))); }
                return true;
            }
            case "appInfo": {
                String s = installed(p);
                start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + s)));
                return true;
            }
            case "uninstall": {
                String s = installed(p);
                if (s.equals(activity.getPackageName())) throw new Refusal("Wizard OS can’t remove itself here");
                start(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + s)));
                return true;
            }
            case "install": {
                if (!activity.getPackageManager().canRequestPackageInstalls()) {
                    start(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                    return new JSONObject().put("needsPermission", true);
                }
                AppsInstaller.Request r = new AppsInstaller.Request(p.optString("sha256", ""), p.optString("package", ""),
                        p.optString("signer", ""), p.optLong("versionCode", 0), false);
                String bad = AppsInstaller.start(activity, r);
                if (bad != null) throw new Refusal(bad);
                return new JSONObject().put("started", true);
            }
            default:
                throw new Refusal("unknown method");
        }
    }

    private void start(Intent i) throws Refusal {
        final Refusal[] err = {null};
        final Object lock = new Object();
        final boolean[] done = {false};
        main.post(() -> {
            try { startNow(i); } catch (ActivityNotFoundException | SecurityException e) { err[0] = new Refusal("Android couldn’t open that"); }
            synchronized (lock) { done[0] = true; lock.notifyAll(); }
        });
        synchronized (lock) {
            long until = System.currentTimeMillis() + 3000;
            while (!done[0] && System.currentTimeMillis() < until) {
                try { lock.wait(200); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
        }
        if (err[0] != null) throw err[0];
    }

    private void startNow(Intent i) { activity.startActivity(i); }

    /** For QA/logs. */
    public int frames() { return frames.size(); }
}
