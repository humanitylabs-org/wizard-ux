package ai.wizards.os.apps;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Set;

/** Keep all direct-install behavior in the direct distribution's source set. */
final class AppsDistribution {
    static final String TAG = AppsInstaller.TAG;
    interface Listener { void onStatus(JSONObject s); }
    private static Listener attached;
    private AppsDistribution() {}
    static void attach(Listener l) { attached = l; AppsInstaller.listener = l::onStatus; }
    static void detach(Listener l) { if (attached == l) { attached = null; AppsInstaller.listener = null; } }
    static void postInventorySoon(Context c) { AppsInstaller.postInventorySoon(c); }
    static Set<String> known(Context c) { return AppsInstaller.known(c); }
    static JSONObject status() { return AppsInstaller.status(); }
    static boolean canInstall(Context c) { return c.getPackageManager().canRequestPackageInstalls(); }
    static void schedule(Context c) { AppsUpdateJob.schedule(c); }
    static JSONObject install(AppsBridge bridge, Activity a, JSONObject p) throws AppsBridge.Refusal, JSONException {
        if (!canInstall(a)) {
            bridge.start(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
            return new JSONObject().put("needsPermission", true);
        }
        AppsInstaller.Request r = new AppsInstaller.Request(p.optString("sha256", ""), p.optString("package", ""),
                p.optString("signer", ""), p.optLong("versionCode", 0), false);
        String bad = AppsInstaller.start(a, r);
        if (bad != null) throw new AppsBridge.Refusal(bad);
        return new JSONObject().put("started", true);
    }
}
