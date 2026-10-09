package ai.wizards.os.everywhere;

import android.app.AppOpsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import android.provider.Settings;
import android.util.Log;

/**
 * Getting "Accessibility → Wizard OS" switched on: it powers voice typing into any app and the orb's Screen button.
 *
 * Android 13+ greys that switch out for apps installed outside an app store ("Restricted setting"). The only way
 * through is App info → ⋮ → Allow restricted settings, and Android shows that menu item only after the user has
 * tapped the greyed switch once. {@link #step} turns that into a plain next step the app can show in one dialog.
 */
public final class AccessibilitySetup {
    private AccessibilitySetup() { }

    /** What the dialog asks for next. */
    public enum Step {
        DONE,
        /** Accessibility → Wizard OS → On. */
        TURN_ON,
        /** Restricted and never tried: Android only offers "Allow restricted settings" after one tap on the greyed row. */
        TAP_ONCE,
        /** Restricted, tried once: App info → ⋮ → Allow restricted settings. */
        ALLOW_RESTRICTED
    }

    /** Android's restricted-settings gate for this app. */
    public static final int GATE_NONE = 0, GATE_UNTRIED = 1, GATE_OFFERED = 2;

    /** Pure decision, unit-tested. */
    public static Step decide(boolean serviceOn, int gate) {
        if (serviceOn) return Step.DONE;
        if (gate == GATE_UNTRIED) return Step.TAP_ONCE;
        if (gate == GATE_OFFERED) return Step.ALLOW_RESTRICTED;
        return Step.TURN_ON;
    }

    public static Step step(Context c) { return decide(WizardKeyboardService.enabled(c), gate(c)); }

    /**
     * Android 13+ holds the Accessibility switch of a sideloaded app behind "Restricted setting", tracked by the
     * hidden ACCESS_RESTRICTED_SETTINGS app-op: ERRORED until the user taps the greyed row once, IGNORED once
     * Settings has shown "Restricted setting" (App info's ⋮ menu then offers the unlock), ALLOWED after it.
     * Any doubt reads as no gate, so the worst case is the plain "turn it on" step.
     */
    public static int gate(Context c) {
        if (Build.VERSION.SDK_INT < 33) return GATE_NONE;
        try {
            AppOpsManager ops = c.getSystemService(AppOpsManager.class);
            int mode = ops.unsafeCheckOpNoThrow("android:access_restricted_settings", Process.myUid(), c.getPackageName());
            return mode == AppOpsManager.MODE_ERRORED ? GATE_UNTRIED : mode == AppOpsManager.MODE_IGNORED ? GATE_OFFERED : GATE_NONE;
        } catch (Exception e) {
            Log.w("WizardOS", "restricted-settings check: " + e.getMessage());
            return GATE_NONE;
        }
    }

    /** Android's Accessibility page, opened on our row where the OEM honours the highlight extra. */
    public static Intent accessibilityPage(Context c) {
        Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String cn = new ComponentName(c, WizardKeyboardService.class).flattenToString();
        Bundle b = new Bundle();
        b.putString(":settings:fragment_args_key", cn);
        i.putExtra(":settings:fragment_args_key", cn).putExtra(":settings:show_fragment_args", b);
        return i;
    }

    /** Wizard OS's App info page, where ⋮ → Allow restricted settings lives. */
    public static Intent appInfoPage(Context c) {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + c.getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }
}
