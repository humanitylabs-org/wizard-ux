package ai.wizards.os.badge;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * One UI-style icon count (wizard-ux issue 1669, switch wizard/phone-badge-look, off by default). While on, the
 * Messenger icon, widget and Unread notification show the exact count (up to 999, then "999+"), and the bubble is a
 * ringless orange-red circle or pill about a quarter of the tile wide at the visible tile's top-right corner. Off keeps
 * the red ringed "9+" bubble in the safe zone exactly as before.
 *
 * The switch lives in the shell (look.json); the main page copies it here (WizardOSNative.badgeLookSwitch), because
 * the poll, the job and the widget run without any page.
 */
public final class BadgeLook {
    private static final String PREFS = "badge-look", KEY = "on";
    private BadgeLook() {}

    /** What one drawing needs to know: the new look or the old one, and which placement for the new one. */
    public static final class Style {
        public final boolean oneUi, samsung;
        public Style(boolean oneUi, boolean samsung) { this.oneUi = oneUi; this.samsung = samsung; }
        public static final Style CLASSIC = new Style(false, false);
    }

    public static boolean on(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false);
    }

    /** True on Samsung phones, whose One UI Home masks icons with its squircle. */
    public static boolean samsung() { return "samsung".equalsIgnoreCase(Build.MANUFACTURER); }

    public static Style style(Context c) { return on(c) ? new Style(true, samsung()) : Style.CLASSIC; }

    /** Label for {@code count} in the current look (empty = no bubble). */
    public static String label(Context c, int count) { return BadgeText.label(count, on(c)); }

    /** Saves the switch; a change redraws every badge with the newest count (same count, new look). */
    public static void setOn(Context c, boolean on) {
        Context app = c.getApplicationContext();
        if (on(app) == on) return;
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply();
        Log.i(UnreadBadges.TAG, "badge-look switch " + (on ? "on" : "off"));
        UnreadBadges.restyle(app);
    }
}
