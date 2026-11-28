package ai.wizards.os;

import android.content.Context;

/**
 * Location for the apps that ask for it (wizard-ux issue 1629, on for everyone). The shell decides which app frame may
 * ask at all: only an app whose wizard.md declares {@code permissions: [geolocation]} (today Maps) gets
 * {@code geolocation} in its frame's {@code allow}, every other frame gets {@code geolocation 'none'}, so the WebView
 * never asks on their behalf. When Maps asks, the Android app answers only for this Wizard's own address, and only
 * after the owner accepted Android's own location prompt. Nothing is remembered by the WebView (retain = false):
 * turning the permission off in Android settings blocks it again at the next ask.
 */
public final class AppLocation {
    private AppLocation() { }

    /** Drops the copy of the removed switch wizard/app-location that versions 0.10.69 to 0.10.81 kept. */
    public static void forgetSwitch(Context c) {
        c.getApplicationContext().getSharedPreferences("app-location", Context.MODE_PRIVATE).edit().remove("on").apply();
    }

    /** May this ask go on to the owner at all: the asking page is this Wizard's own address. */
    public static boolean mayAsk(String wizardOrigin, String askingOrigin) {
        return askingOrigin != null && !askingOrigin.isEmpty() && ServerOrigin.matches(wizardOrigin, askingOrigin);
    }
}
