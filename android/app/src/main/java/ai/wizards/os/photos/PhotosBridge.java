package ai.wizards.os.photos;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import ai.wizards.os.device.AppState;

/**
 * window.wizardPhotosPort: Settings › Photos backup is drawn by the web shell; this class does the device work.
 * Protocol v1 rules and the status shape live in {@link PhotosBridgePolicy}. Private origin, shell main frame only.
 * Sign-in runs natively (PhotoAuth + a browser tab); keys and OAuth state never cross into JavaScript.
 * The legacy one-word message "open" (web before v1) still opens the native PhotosActivity.
 */
public final class PhotosBridge implements SharedPreferences.OnSharedPreferenceChangeListener {
    public static final String NAME = "wizardPhotosPort";
    /** MainActivity forwards this permission result here. */
    public static final int REQ_PERMISSIONS = 7311;
    private static final String TAG = "WizardPhotos";
    private static final int MAX_FRAMES = 4;

    private final Activity activity;
    private final WebView web;
    private final BackupSettings settings;
    private final LinkedHashSet<JavaScriptReplyProxy> frames = new LinkedHashSet<>();
    private final ExecutorService bg = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean signingIn;
    private boolean pushQueued;

    private PhotosBridge(Activity a, WebView w) { activity = a; web = w; settings = new BackupSettings(a); }

    /** Installs the port on {@code web}; null when this WebView can't (the web page then has no Photos settings). */
    public static PhotosBridge install(Activity a, WebView web) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return null;
        PhotosBridge b = new PhotosBridge(a, web);
        try {
            Set<String> allow = new HashSet<>(java.util.Collections.singleton(AppState.primaryOrigin(a)));
            WebViewCompat.addWebMessageListener(web, NAME, allow, b::onMessage);
        } catch (RuntimeException e) { Log.w(TAG, "no photos bridge", e); return null; }
        b.settings.prefs.registerOnSharedPreferenceChangeListener(b);
        return b;
    }

    public void detach() {
        settings.prefs.unregisterOnSharedPreferenceChangeListener(this);
        frames.clear();
        bg.shutdown();
    }

    /** Back from Android's permission page, the sign-in tab or app settings: tell the page what changed. */
    public void onResume() {
        signingIn = false;
        // Sign-in started from the web switch just turned backup on: ask for photo access once, right away.
        if (settings.prefs.getBoolean(PhotosActivity.ASK_ACCESS, false)) {
            settings.prefs.edit().remove(PhotosActivity.ASK_ACCESS).commit();
            if (settings.enabled() && missingAccess()) requestPermissions();
        }
        pushSoon();
    }

    public void onPermissions() {
        BackupScheduler.schedule(activity);
        if (settings.enabled()) BackupScheduler.enqueue(activity);
        pushSoon();
    }

    @Override public void onSharedPreferenceChanged(SharedPreferences p, String key) { pushSoon(); }

    /** Progress writes many preferences at once; coalesce into one status push. */
    private void pushSoon() {
        if (frames.isEmpty() || pushQueued) return;
        pushQueued = true;
        main.postDelayed(() -> {
            pushQueued = false;
            if (frames.isEmpty() || bg.isShutdown()) return;
            bg.execute(() -> {
                try {
                    String json = new JSONObject().put("v", PhotosBridgePolicy.VERSION).put("type", "status").put("status", status()).toString();
                    main.post(() -> { for (JavaScriptReplyProxy p : new ArrayList<>(frames)) post(p, json); });
                } catch (JSONException ignored) { }
            });
        }, 250);
    }

    private boolean shellOnTop() {
        String u = web.getUrl();
        return u != null && PhotosBridgePolicy.shellPath(Uri.parse(u).getPath());
    }

    private static String originOf(Uri u) {
        int port = u.getPort();
        return u.getScheme() + "://" + u.getHost() + (port == -1 ? "" : ":" + port);
    }

    private void onMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply) {
        if (view != web || sourceOrigin == null || !isMainFrame || !AppState.primaryOrigin(activity).equals(originOf(sourceOrigin)) || !shellOnTop()) return;
        String data = message == null ? null : message.getData();
        if (PhotosBridgePolicy.LEGACY_OPEN.equals(data)) { activity.startActivity(new Intent(activity, PhotosActivity.class)); return; }
        JSONObject m = PhotosBridgePolicy.request(data);
        if (m == null) return;
        frames.remove(reply); frames.add(reply);
        while (frames.size() > MAX_FRAMES) frames.remove(frames.iterator().next());
        final String id = m.optString("id"), method = m.optString("method");
        final JSONObject params = m.optJSONObject("params");
        if (bg.isShutdown()) return;
        bg.execute(() -> {
            Object result = null; String error = null;
            try { result = call(method, params); }
            catch (IllegalArgumentException e) { error = e.getMessage(); }
            catch (Exception e) { Log.w(TAG, method + ": " + e); error = "Something went wrong · try again"; }
            final Object r = result; final String er = error;
            main.post(() -> answer(reply, id, r, er));
        });
    }

    private void answer(JavaScriptReplyProxy reply, String id, Object result, String error) {
        try {
            JSONObject o = new JSONObject().put("v", PhotosBridgePolicy.VERSION).put("id", id).put("ok", error == null);
            if (error != null) o.put("error", error); else o.put("result", result == null ? JSONObject.NULL : result);
            post(reply, o.toString());
        } catch (JSONException ignored) { }
    }

    private void post(JavaScriptReplyProxy p, String json) {
        try { p.postMessage(json); } catch (RuntimeException e) { frames.remove(p); }
    }

    /** Runs on the background thread. Every mutation answers with the fresh status. */
    private Object call(String method, JSONObject p) throws Exception {
        switch (method) {
            case "status": return status();
            case "setEnabled": {
                boolean on = p.optBoolean("on", false);
                if (on && !settings.connected()) {
                    // Not signed in: the switch itself starts Wizard Sign-in and backup turns on when it returns.
                    String server = server(p);
                    settings.prefs.edit().putBoolean("enable_after_signin", true).commit();
                    signIn(server);
                    return status();
                }
                settings.change(); settings.prefs.edit().putBoolean("enabled", on).remove("enable_after_signin").commit();
                reschedule();
                if (on && missingAccess()) main.post(this::requestPermissions);
                return status();
            }
            case "setOption": {
                String key = PhotosBridgePolicy.option(p.optString("key", ""));
                if (key == null) throw new IllegalArgumentException("Unknown setting");
                settings.change(); settings.prefs.edit().putBoolean(key, p.optBoolean("on", true)).commit();
                reschedule();
                return status();
            }
            case "connect": {
                settings.prefs.edit().remove("enable_after_signin").commit();
                signIn(server(p));
                return status();
            }
            case "runNow":
                if (!settings.enabled()) throw new IllegalArgumentException("Turn on backup first");
                BackupScheduler.schedule(activity); BackupScheduler.enqueue(activity);
                return status();
            case "permissions":
                main.post(this::requestPermissions);
                return status();
            case "albums": {
                PhotoLibrary library = new PhotoLibrary(activity);
                if (!library.readable()) throw new IllegalArgumentException("Allow photo access to choose albums");
                JSONArray out = new JSONArray();
                Set<String> chosen = settings.albums();
                for (Map.Entry<String, String> e : library.albums().entrySet())
                    out.put(new JSONObject().put("id", e.getKey()).put("name", e.getValue())
                            .put("selected", settings.selected(e.getKey(), e.getValue()) || chosen.contains(e.getKey())));
                return new JSONObject().put("albums", out).put("limited", library.limited());
            }
            case "setAlbums": {
                Set<String> ids = PhotosBridgePolicy.albums(p.optJSONArray("ids"));
                settings.change(); settings.prefs.edit().putStringSet("albums", new HashSet<>(ids)).commit();
                reschedule();
                return status();
            }
            case "disconnect":
                settings.disconnect();
                return status();
            default: throw new IllegalArgumentException("Unknown method");
        }
    }

    private void reschedule() {
        BackupScheduler.cancel(activity); BackupScheduler.schedule(activity);
        if (settings.enabled()) BackupScheduler.enqueue(activity);
    }

    /** The page may name a server only while none is known; the known one (build-time or signed-in) wins. */
    private String server(JSONObject p) {
        String known = settings.server(), typed = p.optString("server", "").trim();
        String input = !known.isEmpty() ? known : typed;
        if (input.isEmpty()) throw new IllegalArgumentException("Enter your photo server address");
        try { return BackupPolicy.server(input, false); }
        catch (RuntimeException e) { throw new IllegalArgumentException("Enter an HTTPS server origin"); }
    }

    private void signIn(String server) throws Exception {
        if (signingIn) return;
        signingIn = true;
        try {
            settings.status("Connecting…");
            String url = new PhotoAuth(activity).start(server);
            // The OAuth callback deep link lands on PhotosActivity; this flag sends it straight back to the web page.
            settings.prefs.edit().putBoolean(PhotosActivity.FROM_WEB, true).commit();
            settings.status("Confirm with your fingerprint in Wizard Sign-in");
            main.post(() -> {
                try { new CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(url)); }
                catch (RuntimeException e) { signingIn = false; settings.status("Sign-in unavailable · no browser on this phone"); }
            });
        } catch (Exception e) {
            signingIn = false;
            settings.status("Sign-in unavailable · check the server and Wizard Sign-in configuration");
            throw new IllegalArgumentException("Sign-in unavailable · check the server and Wizard Sign-in configuration");
        }
    }

    private boolean missingAccess() {
        PhotoLibrary library = new PhotoLibrary(activity);
        return !library.readable() || (Build.VERSION.SDK_INT >= 29 && !library.has(Manifest.permission.ACCESS_MEDIA_LOCATION));
    }

    private void requestPermissions() {
        List<String> p = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) { p.add(Manifest.permission.READ_MEDIA_IMAGES); p.add(Manifest.permission.READ_MEDIA_VIDEO); p.add(Manifest.permission.POST_NOTIFICATIONS); }
        else p.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        if (Build.VERSION.SDK_INT >= 34) p.add(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
        if (Build.VERSION.SDK_INT >= 29) p.add(Manifest.permission.ACCESS_MEDIA_LOCATION);
        activity.requestPermissions(p.toArray(new String[0]), REQ_PERMISSIONS);
    }

    private JSONObject status() throws JSONException {
        PhotoLibrary library = new PhotoLibrary(activity);
        PhotosBridgePolicy.Snapshot s = new PhotosBridgePolicy.Snapshot();
        s.connected = settings.connected();
        s.enabled = settings.enabled();
        s.wifi = settings.wifi();
        s.charge = settings.prefs.getBoolean("charge", true);
        s.server = settings.server();
        s.done = settings.prefs.getInt("done", 0);
        s.total = settings.prefs.getInt("total", 0);
        s.lastSync = settings.prefs.getLong("last_sync", 0);
        s.message = settings.prefs.getString("status", "");
        s.readable = library.readable();
        s.location = Build.VERSION.SDK_INT < 29 || library.has(Manifest.permission.ACCESS_MEDIA_LOCATION);
        s.limited = library.limited();
        s.signingIn = signingIn;
        return PhotosBridgePolicy.status(s);
    }
}
