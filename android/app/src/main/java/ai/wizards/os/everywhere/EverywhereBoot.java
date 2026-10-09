package ai.wizards.os.everywhere;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Brings the floating button back after a reboot or an app update, if James left it switched on. */
public class EverywhereBoot extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String a = i == null ? "" : String.valueOf(i.getAction());
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            EverywhereService.ensureRunning(c);
            EverywhereOutbox.get(c).pump();
            ai.wizards.os.mizel.MeetingRecorderService.recover(c); // finish uploading any meeting cut off by a reboot
        }
    }
}
