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

    /**
     * Gate from what we can see. {@code opMode}: the ACCESS_RESTRICTED_SETTINGS app-op (ERRORED = locked and never
     * tapped, IGNORED = Settings has said "Restricted setting" so App info's ⋮ now offers the unlock, ALLOWED =
     * unlocked), or -1 when unreadable / DEFAULT. Then fall back to the install source: Android 13+ locks apps that
     * did not come from a store, and {@code tried} (James already went to the Accessibility page once and came back
     * with it still off) means the unlock is what is in the way.
     */
    public static int gateFrom(int sdk, int opMode, boolean sideloaded, int stage) {
        if (sdk < 33) return GATE_NONE;
        if (opMode == AppOpsManager.MODE_ALLOWED) return GATE_NONE;
        if (opMode == AppOpsManager.MODE_ERRORED) return GATE_UNTRIED;
        if (opMode == AppOpsManager.MODE_IGNORED) return GATE_OFFERED;
        if (!sideloaded) return GATE_NONE;
        // Apps can't read their own flag, so follow James through it: Accessibility once → unlock → Accessibility.
        return stage >= STAGE_UNLOCK_VISITED ? GATE_NONE : stage >= STAGE_A11Y_VISITED ? GATE_OFFERED : GATE_UNTRIED;
    }

    public static Step step(Context c) { return decide(WizardKeyboardService.enabled(c), gate(c)); }

    public static int gate(Context c) {
        int op = opMode(c);
        int g = gateFrom(Build.VERSION.SDK_INT, op, sideloaded(c), stage(c));
        Log.i("WizardOS", "accessibility gate=" + g + " op=" + op + " sideloaded=" + sideloaded(c) + " stage=" + stage(c));
        return g;
    }

    /** ACCESS_RESTRICTED_SETTINGS for our uid, or -1 (unreadable or DEFAULT). */
    static int opMode(Context c) {
        if (Build.VERSION.SDK_INT < 33) return -1;
        try {
            AppOpsManager ops = c.getSystemService(AppOpsManager.class);
            int m = ops.unsafeCheckOpNoThrow("android:access_restricted_settings", Process.myUid(), c.getPackageName());
            return m == AppOpsManager.MODE_DEFAULT ? -1 : m;
        } catch (Exception e) {
            return -1; // usual: Android hides this op from the app itself
        }
    }

    /** Installed from a downloaded/local file rather than a store (what Android 13+ restricts). */
    static boolean sideloaded(Context c) {
        if (Build.VERSION.SDK_INT < 33) return false;
        try {
            android.content.pm.InstallSourceInfo s = c.getPackageManager().getInstallSourceInfo(c.getPackageName());
            int src = s.getPackageSource();
            if (src == android.content.pm.PackageInstaller.PACKAGE_SOURCE_STORE) return false;
            if (src == android.content.pm.PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE
                    || src == android.content.pm.PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE) return true;
            String inst = s.getInstallingPackageName();
            return inst == null || !(inst.equals("com.android.vending") || inst.equals("com.sec.android.app.samsungapps"));
        } catch (Exception e) {
            return true;
        }
    }

    /** How far James got through the restricted-settings walk (never goes backwards). */
    public static final int STAGE_NONE = 0, STAGE_A11Y_VISITED = 1, STAGE_UNLOCK_VISITED = 2;
    private static final String PREFS = "wos.a11y", STAGE = "stage";
    public static int stage(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(STAGE, STAGE_NONE); }
    public static void reached(Context c, int s) {
        if (s > stage(c)) c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(STAGE, s).apply();
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
