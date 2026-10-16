package ai.wizards.os.device;

import android.content.Context;

import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Shared native identity from the same settings.agent.name bootstrap contract as the shell/share sheet. */
public final class WizardIdentity {
    public static final String FALLBACK = "Wizard";
    private static final String PREFS = "wizard-identity";
    private static final AtomicBoolean refreshing = new AtomicBoolean();

    private WizardIdentity() {}

    public static String normalize(String name) {
        if (name == null) return FALLBACK;
        String clean = name.replaceAll("[\\p{Cntrl}\\s]+", " ").trim();
        return clean.isEmpty() ? FALLBACK : clean;
    }

    public static String fromBootstrap(JSONObject bootstrap) {
        JSONObject settings = bootstrap == null ? null : bootstrap.optJSONObject("settings");
        JSONObject agent = settings == null ? null : settings.optJSONObject("agent");
        Object name = agent == null ? null : agent.opt("name");
        return normalize(name instanceof String ? (String) name : null);
    }

    /** No network or Activity retention on notification/capture paths; survives process restart. */
    public static String name(Context context) {
        if (context == null) return FALLBACK;
        return normalize(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(AppState.primaryOrigin(context), FALLBACK));
    }

    /** ShareActivity already fetches bootstrap; reuse that result rather than fetch it again. */
    public static void acceptBootstrap(Context context, String origin, JSONObject bootstrap) {
        if (!AppState.origin(context).equals(origin)) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(AppState.primaryOrigin(context), fromBootstrap(bootstrap)).apply();
    }

    /** Refresh off-thread on shell resume / native-only startup; offline keeps the last known name. */
    public static void refresh(Context context) {
        if (context == null || !refreshing.compareAndSet(false, true)) return;
        Context app = context.getApplicationContext();
        String origin = AppState.origin(app);
        new Thread(() -> {
            try {
                JSONObject bootstrap = Http.json("GET", origin + "/wizard/v1/bootstrap", origin, null, null);
                acceptBootstrap(app, origin, bootstrap);
            } catch (IOException ignored) {
                // Offline: retained identity (or the generic fallback) remains usable.
            } finally { refreshing.set(false); }
        }, "wizard-identity").start();
    }

    public static String voicePrompt(String name) {
        return "Voice request spoken to " + normalize(name) + " through Wizard OS on an Android phone.";
    }

    public static String replyTitle(String name) { return normalize(name) + " replied"; }
    public static String approvalText(String name) { return normalize(name) + " needs your approval to continue"; }
    public static String channelDescription(String name) {
        return "When " + normalize(name) + " answers a chat you sent from Wizard OS";
    }
    public static String everywhereTitle(String name, String excerpt) { return normalize(name) + " · " + excerpt; }
}
