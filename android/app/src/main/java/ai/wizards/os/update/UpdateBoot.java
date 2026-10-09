package ai.wizards.os.update;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a reboot: keep the background update check scheduled. After an update: reopen Wizard OS if James was in it. */
public class UpdateBoot extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String a = i == null ? "" : String.valueOf(i.getAction());
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) Updater.onReplaced(c);
        else if (Intent.ACTION_BOOT_COMPLETED.equals(a)) UpdateJob.schedule(c);
    }
}
