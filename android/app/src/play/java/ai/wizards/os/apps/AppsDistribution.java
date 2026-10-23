package ai.wizards.os.apps;

import android.app.Activity;
import android.content.Context;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Collections;
import java.util.Set;

/** Android Apps in Play is a store handoff, never an APK installer. */
final class AppsDistribution {
    static final String TAG = "WizardApps";
    interface Listener { void onStatus(JSONObject s); }
    private AppsDistribution() {}
    static void attach(Listener l) {}
    static void detach(Listener l) {}
    static void postInventorySoon(Context c) {}
    static Set<String> known(Context c) { return Collections.emptySet(); }
    static JSONObject status() { return new JSONObject(); }
    static boolean canInstall(Context c) { return false; }
    static void schedule(Context c) {}
    static JSONObject install(AppsBridge bridge, Activity a, JSONObject p) throws AppsBridge.Refusal, JSONException {
        String pkg = p.optString("package", "");
        if (!AppsPolicy.pkg(pkg)) throw new AppsBridge.Refusal("No such app");
        bridge.openPlay(pkg);
        return new JSONObject().put("started", false).put("openedPlay", true);
    }
}
