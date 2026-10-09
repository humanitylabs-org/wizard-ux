package ai.wizards.os;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;

/**
 * The side-button switch inside Wizard OS.
 *
 * Android lets an app ask for most roles with one system dialog, but not the assistant role: the user has to tick
 * Wizard OS on the assistant page, and the hold-the-side-button gesture is a separate system setting. So the
 * switch does the most Android allows: one tap asks for the microphone, then lands exactly on the system page
 * where the remaining tick lives, and Wizard OS reads the result back and updates the switch when the user
 * returns. The step logic is pure Java so it is unit-testable off-device.
 */
public final class SideButton {
    static final String PREFS = "side_button";
    static final String KEY_USED = "used";

    /** The next thing the user has to do, in order. */
    static final String STEP_MIC = "mic";
    static final String STEP_ASSISTANT = "assistant";
    static final String STEP_PRESS = "press";   // set up; waiting for the first real hold of the side button
    static final String STEP_READY = "ready";

    private SideButton() {}

    static String step(boolean mic, boolean assistant, boolean used) {
        if (!mic) return STEP_MIC;
        if (!assistant) return STEP_ASSISTANT;
        return used ? STEP_READY : STEP_PRESS;
    }

    static String json(boolean mic, boolean assistant, boolean used, boolean samsung) {
        return "{\"mic\":" + mic + ",\"assistant\":" + assistant + ",\"used\":" + used
                + ",\"samsung\":" + samsung + ",\"step\":\"" + step(mic, assistant, used) + "\"}";
    }

    /* ---------------- device state ---------------- */

    static boolean mic(Context c) {
        return c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean assistant(Context c) {
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager rm = c.getSystemService(RoleManager.class);
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) return rm.isRoleHeld(RoleManager.ROLE_ASSISTANT);
        }
        String a = Settings.Secure.getString(c.getContentResolver(), "assistant");
        return a != null && a.startsWith(c.getPackageName() + "/");
    }

    static boolean used(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_USED, false);
    }

    /** Called by the assistant surfaces: the side button really reached Wizard OS at least once. */
    public static void markUsed(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_USED, true).apply();
    }

    static boolean samsung() {
        return "samsung".equalsIgnoreCase(Build.MANUFACTURER);
    }

    static String status(Context c) {
        return json(mic(c), assistant(c), used(c), samsung());
    }

    /* ---------------- the one system page the user still has to tick ---------------- */

    /**
     * Opens the page where Wizard OS is picked as the assistant. Samsung's One UI keeps the side-key choice on
     * its own Side button page (Settings > Advanced features > Side button), so on Samsung that page comes
     * first; elsewhere it is the digital-assistant picker, then the default-apps list as a fallback.
     */
    static boolean openAssistantPage(Activity a) {
        Intent[] tries = {
                new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS),
                new Intent("android.intent.action.MANAGE_DEFAULT_APP").putExtra("android.intent.extra.ROLE_NAME", "android.app.role.ASSISTANT"),
                new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS),
        };
        for (Intent i : tries) {
            try {
                a.startActivity(i);
                return true;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // next
            }
        }
        return false;
    }

    /** Samsung only: the Side button page, where "Press and hold" is set to the digital assistant. */
    static boolean openSideKeyPage(Activity a) {
        Intent[] tries = {
                new Intent().setClassName("com.android.settings", "com.android.settings.Settings$FunctionKeySettingsActivity"),
                new Intent().setClassName("com.android.settings", "com.samsung.android.settings.usefulfeature.functionkey.FunctionKeySettingsActivity"),
                new Intent("com.samsung.settings.FUNCTION_KEY_SETTING"),
        };
        for (Intent i : tries) {
            try {
                a.startActivity(i);
                return true;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // next
            }
        }
        return false;
    }
}
