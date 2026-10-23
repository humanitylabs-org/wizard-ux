package ai.wizards.os.share;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Play replaces the share-recovery part of UpdateBoot, never its APK-update behavior. */
public final class ShareRecoveryBoot extends BroadcastReceiver {
    static boolean shouldRecover(String action) {
        return Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
    }
    @Override public void onReceive(Context c, Intent i) {
        if (i != null && shouldRecover(i.getAction())) ShareJob.scheduleIfPending(c);
    }
}
