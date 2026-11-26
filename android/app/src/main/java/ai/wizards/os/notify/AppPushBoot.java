package ai.wizards.os.notify;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Box-to-phone push (wizard-ux issue 1618): listening again after a reboot or an app update, if it was on. */
public class AppPushBoot extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String a = i == null ? "" : String.valueOf(i.getAction());
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) AppPush.ensure(c);
    }
}
