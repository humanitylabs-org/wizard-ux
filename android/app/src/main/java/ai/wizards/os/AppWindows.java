package ai.wizards.os;

import android.content.Context;
import android.content.Intent;

/**
 * Links to a Wizard app open in that app's own Android window (wizard-os issue 650, on for everyone). The windows are
 * the home-screen app windows ({@link AppSessionActivity}, one document task per app), so a link opens the same window
 * the app's home-screen icon opens, pinned or not.
 *
 * The web decides what a link points at (an installed Wizard app and a page inside it, core/android-relay.js); this
 * class only checks what it is handed.
 */
public final class AppWindows {
    /** Where 0.10.50 to 0.10.64 kept their copy of the removed switch wizard/app-windows. */
    private static final String OLD_SWITCH_PREFS = "app-windows";
    public static final String EXTRA_PATH = "ai.wizards.os.extra.APP_PATH";
    public static final String EXTRA_FROM_LINK = "ai.wizards.os.extra.FROM_LINK";
    public static final String EXTRA_NAME = "ai.wizards.os.extra.APP_NAME";
    static final long TAP_MS = AppWindowsPolicy.TAP_MS;

    private AppWindows() { }

    /** The switch is gone (always on): drop the copy an older version stored. */
    static void forgetOldSwitch(Context c) { c.getApplicationContext().deleteSharedPreferences(OLD_SWITCH_PREFS); }

    public static String path(String raw) { return AppWindowsPolicy.path(raw); }
    static boolean admitted(long now, long tapUpAt, long linkIntentAt, long lastOpenAt) {
        return AppWindowsPolicy.admitted(now, tapUpAt, linkIntentAt, lastOpenAt);
    }
    static String name(String raw) { return AppWindowsPolicy.name(raw); }

    /** The same launch the home-screen icon makes (one task per app, reused), plus where to open and that a link asked. */
    static Intent intent(Context c, String appId, String path, String name) {
        Intent launch = new Intent(c, AppSessionActivity.class).setAction(Intent.ACTION_VIEW)
            .setData(HomeScreenShortcuts.taskUri(c, appId))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_FROM_LINK, true);
        if (path != null && !path.isEmpty()) launch.putExtra(EXTRA_PATH, path);
        String n = name(name);
        if (!n.isEmpty()) launch.putExtra(EXTRA_NAME, n);
        return launch;
    }
}
