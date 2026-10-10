package ai.wizards.os.apps;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

/** Result of an Android Apps install session (not exported: only our own session's PendingIntent reaches it). */
public class AppsInstallReceiver extends BroadcastReceiver {
    @SuppressLint("UnsafeIntentLaunch") // EXTRA_INTENT comes from the system installer via our own session callback
    @Override
    public void onReceive(Context c, Intent i) {
        if (i == null || !AppsInstaller.ACTION_STATUS.equals(i.getAction())) return;
        int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        String pkg = i.getStringExtra(AppsInstaller.EXTRA_PKG);
        if (pkg == null) return;
        Intent confirm = status == PackageInstaller.STATUS_PENDING_USER_ACTION ? extraIntent(i) : null;
        AppsInstaller.onStatus(c, pkg, status, msg, confirm, i.getBooleanExtra("bg", false), i.getStringExtra("sha"));
    }

    @SuppressWarnings("deprecation")
    private static Intent extraIntent(Intent i) {
        if (Build.VERSION.SDK_INT >= 33) return i.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        return i.getParcelableExtra(Intent.EXTRA_INTENT);
    }
}
