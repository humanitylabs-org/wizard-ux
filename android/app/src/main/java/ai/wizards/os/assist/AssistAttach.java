package ai.wizards.os.assist;

import android.content.Context;
import android.util.Log;

/**
 * The switch for Camera and Attach on the side-button corner orb (wizard-os issue 655, switch wizard/assist-attach,
 * off by default). The switch lives in the shell (look.json); the WizardOS app's main page copies it here through
 * WizardOSNative.assistAttachSwitch, because the corner orb has its own page and never sees the shell's switches.
 */
public final class AssistAttach {
    private static final String PREFS = "assist", KEY = "attach";

    private AssistAttach() { }

    public static boolean on(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false);
    }

    public static void setOn(Context c, boolean on) {
        if (on(c) == on) return;
        c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply();
        Log.i(AssistLockActivity.TAG, "camera and attach switch " + (on ? "on" : "off"));
    }
}
