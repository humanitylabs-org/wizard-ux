package ai.wizards.os.assist;

import android.content.Context;

/**
 * Camera and Attach on the side-button corner orb (wizard-os issue 655) are on for everyone; the switch
 * wizard/assist-attach is gone. Android apps 0.10.49 to 0.10.65 kept a copy of it in the "assist" preferences
 * (key "attach", next to AssistNote's own key); this drops that copy.
 */
public final class AssistAttach {
    private static final String OLD_PREFS = "assist", OLD_KEY = "attach";

    private AssistAttach() { }

    public static void forgetOldSwitch(Context c) {
        android.content.SharedPreferences p = c.getApplicationContext().getSharedPreferences(OLD_PREFS, Context.MODE_PRIVATE);
        if (p.contains(OLD_KEY)) p.edit().remove(OLD_KEY).apply();
    }
}
