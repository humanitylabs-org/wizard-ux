package ai.wizards.os.automation;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * device.automation v1 adapter for the generic device port (wizardDevicePort). The transport (origin, main frame,
 * shell path, envelope) is checked by the port before this runs; this checks parameters and calls the engine.
 * Runs on the main thread. No method here (or anywhere on a bridge) presses a commit button.
 */
public final class AutomationPort {
    private AutomationPort() { }

    public static final class Refusal extends Exception { public Refusal(String m) { super(m); } }

    public static Object call(Context c, String method, JSONObject p) throws Refusal, JSONException {
        AutomationEngine e = AutomationEngine.get(c);
        switch (method) {
            case "status": return e.status(p.optString("package", ""));
            case "record": return started(e.record(p));
            case "replay": return started(e.replay(p));
            case "screen":
                try { return e.screen(p.optString("package", "")); }
                catch (JSONException x) { throw new Refusal("target-not-allowed"); }
            case "cancel": if (e.busy()) e.cancel(); return new JSONObject().put("mode", e.mode().name().toLowerCase(java.util.Locale.ROOT));
            case "outcomes": return new JSONObject().put("outcomes", e.outbox());
            case "ack": return new JSONObject().put("removed", e.ack(p.optJSONArray("ids")));
            case "shortcuts":
                try { return new JSONObject().put("count", e.setShortcuts(p.optJSONObject("table"))); }
                catch (AutomationPolicy.Refusal r) { throw new Refusal(r.code); }
            case "legacyRecipes":
                // Migration only: what the pre-v1 native Food kept on this phone, read-only. Removed with usuals/.
                return new JSONObject().put("recipes", new JSONArray(ai.wizards.os.usuals.UsualsStore.json(c)));
            default: throw new Refusal("unknown method");
        }
    }

    private static JSONObject started(String blocker) throws Refusal, JSONException {
        if (!blocker.isEmpty()) throw new Refusal(blocker);
        return new JSONObject().put("started", true);
    }
}
