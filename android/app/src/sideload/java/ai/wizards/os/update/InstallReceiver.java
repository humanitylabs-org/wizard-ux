package ai.wizards.os.update;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

/**
 * Result of Wizard OS's own PackageInstaller session (not exported: only the installer, through the session's
 * PendingIntent, can reach it). STATUS_PENDING_USER_ACTION carries Android's confirm screen in EXTRA_INTENT.
 */
public class InstallReceiver extends BroadcastReceiver {
    @SuppressLint("UnsafeIntentLaunch") // EXTRA_INTENT comes from the system installer via our own session callback
    @Override
    public void onReceive(Context c, Intent i) {
        if (i == null || !Updater.ACTION_STATUS.equals(i.getAction())) return;
        int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        Intent confirm = null;
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) confirm = extraIntent(i);
        Updater.onStatus(c, status, msg, confirm, i.getIntExtra(Updater.EXTRA_VC, 0));
    }

    @SuppressWarnings("deprecation")
    private static Intent extraIntent(Intent i) {
        if (Build.VERSION.SDK_INT >= 33) return i.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        return i.getParcelableExtra(Intent.EXTRA_INTENT);
    }
}
