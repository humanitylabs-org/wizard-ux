package ai.wizards.os.update;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import ai.wizards.os.device.DeviceBridge;

/** Direct distribution retains the existing updater without changing its implementation. */
public final class UpdateChannel {
    private UpdateChannel() {}
    public static void attach(Activity a, DeviceBridge b) { Updater.attach(a, b); }
    public static void detach(Activity a) { Updater.detach(a); }
    public static void onIntent(Activity a, Intent i) { Updater.onIntent(a, i); }
    public static void onResume(Activity a) { Updater.onResume(a); }
    public static void onStop(Activity a) { Updater.onStop(a); }
    public static void check(Context c) { Updater.check(c); }
    public static void install(Activity a) { Updater.install(a); }
    public static String state() { return Updater.state(); }
    public static boolean recording(Context c) { return Updater.recording(c); }
}
