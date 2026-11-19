package ai.wizards.os;

import android.content.Context;

/**
 * Location for the apps that ask for it (wizard-ux issue 1629, switch wizard/app-location, off by default). The shell
 * decides which app frame may ask at all: only an app whose wizard.md declares {@code permissions: [geolocation]}
 * (today Maps) gets {@code geolocation} in its frame's {@code allow}, every other frame gets {@code geolocation 'none'},
 * so the WebView never asks on their behalf. When Maps asks, the Android app answers only for this Wizard's own
 * address and only while the switch is on, and only after the owner accepted Android's own location prompt. Nothing is
 * remembered by the WebView (retain = false): turning the switch off or the permission off in Android settings blocks
 * it again at the next ask.
 *
 * The switch lives in the shell (look.json); the main page copies it here (WizardOSNative.appLocationSwitch), because
 * a home-screen app window's page never sees the shell's switches.
 */
public final class AppLocation {
    private static final String PREFS = "app-location", KEY = "on";

    private AppLocation() { }

    public static boolean on(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false);
    }

    public static void setOn(Context c, boolean on) {
        if (on(c) == on) return;
        c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply();
        android.util.Log.i("WizardOSLocation", "app-location switch " + (on ? "on" : "off"));
    }

    /** May this ask go on to the owner at all: switch on, and the asking page is this Wizard's own address. */
    public static boolean mayAsk(boolean on, String wizardOrigin, String askingOrigin) {
        return on && askingOrigin != null && !askingOrigin.isEmpty() && ServerOrigin.matches(wizardOrigin, askingOrigin);
    }
}
