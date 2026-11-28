package ai.wizards.os.badge;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * One UI-style icon count (wizard-ux issue 1669, on for everyone): the Messenger icon, widget and Unread notification
 * show the exact count (up to 999, then "999+"), and the bubble is a ringless orange-red circle or pill at the visible
 * tile's top-right corner (Samsung) or the safe-zone square's corner (every other launcher).
 */
public final class BadgeLook {
    /** Where 0.10.70 to 0.10.82 kept their copy of the removed switch wizard/phone-badge-look ("on"). */
    private static final String PREFS = "badge-look", OLD_SWITCH = "on", DRAWN = "drawn";
    /** Bumped when the look changes, so badges drawn in an older look are redrawn once. */
    static final int LOOK = 1;
    private BadgeLook() {}

    /** True on Samsung phones, whose One UI Home masks icons with its squircle. */
    public static boolean samsung() { return "samsung".equalsIgnoreCase(Build.MANUFACTURER); }

    /** The switch is gone (always on): drop the copy an older version stored, and redraw once any badge an older
     *  version drew in the classic look (same count, new look). */
    public static void upgrade(Context c) {
        Context app = c.getApplicationContext();
        SharedPreferences p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (p.getInt(DRAWN, 0) == LOOK && !p.contains(OLD_SWITCH)) return;
        p.edit().remove(OLD_SWITCH).putInt(DRAWN, LOOK).apply();
        Log.i(UnreadBadges.TAG, "badge look " + LOOK + ": redraw");
        UnreadBadges.restyle(app);
    }
}
