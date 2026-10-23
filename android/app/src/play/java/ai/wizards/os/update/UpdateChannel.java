package ai.wizards.os.update;

import android.app.Activity;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Process;
import ai.wizards.os.device.DeviceBridge;
import ai.wizards.os.BuildConfig;

/** Play alone updates this edition. No feed, download, installer, scheduler or signer pin. */
public final class UpdateChannel {
    private UpdateChannel() {}
    public static void attach(Activity a, DeviceBridge b) {}
    public static void detach(Activity a) {}
    public static void onIntent(Activity a, Intent i) {}
    public static void onResume(Activity a) {}
    public static void onStop(Activity a) {}
    public static void check(Context c) {}
    public static void install(Activity a) {}
    // Existing web settings treat idle as no update banner; do not offer an APK update.
    public static String state() {
        return "{\"state\":\"idle\",\"distribution\":\"play\",\"installed\":\"" + BuildConfig.VERSION_NAME + "\"}";
    }

    /** Server switching must still refuse to strand a recording, independently of updating. */
    public static boolean recording(Context c) {
        String holder = ai.wizards.os.MicOwner.holder();
        boolean alive = false;
        if (ai.wizards.os.MicOwner.ORB.equals(holder)) alive = ai.wizards.os.recording.RecorderService.serviceAlive();
        else if (ai.wizards.os.MicOwner.EVERYWHERE.equals(holder)) alive = ai.wizards.os.everywhere.EverywhereService.serviceAlive();
        else if (ai.wizards.os.MicOwner.MEETING.equals(holder)) alive = ai.wizards.os.mizel.MeetingRecorderService.serviceAlive();
        else if (ai.wizards.os.MicOwner.SIDE.equals(holder)) alive = ai.wizards.os.assist.TakeRecovery.captureAlive();
        boolean take = ai.wizards.os.recording.RecorderService.active() != null
                || ai.wizards.os.everywhere.EverywhereService.appIsRecording()
                || ai.wizards.os.mizel.MeetingRecorderService.live() != null;
        boolean mic = false;
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                AppOpsManager ops = c.getSystemService(AppOpsManager.class);
                mic = ops != null && ops.isOpActive(AppOpsManager.OPSTR_RECORD_AUDIO, Process.myUid(), c.getPackageName());
            } catch (RuntimeException ignored) {}
        }
        UpdatePolicy.Hold hold = UpdatePolicy.hold(take, holder != null, alive,
                ai.wizards.os.audio.BackgroundAudioService.active(), mic);
        return hold == UpdatePolicy.Hold.TAKE || hold == UpdatePolicy.Hold.MIC;
    }
}
