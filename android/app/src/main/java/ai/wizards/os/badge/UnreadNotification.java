package ai.wizards.os.badge;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import ai.wizards.os.AppSessionActivity;
import ai.wizards.os.HomeScreenPolicy;
import ai.wizards.os.HomeScreenShortcuts;

/**
 * (2) Secondary: one silent low-importance "Unread" notification carrying the count and the Messenger shortcut id,
 * so launchers that dot pinned shortcuts by shortcutId (Pixel/AOSP) and the Wizard app icon's own dot show it.
 * Cancelled at zero. Holds only a number: no sender or message text.
 */
final class UnreadNotification implements BadgeSync.Mechanism {
    static final String CH = "unread";
    static final int ID = 7490;
    private final Context c;
    UnreadNotification(Context c) { this.c = c; }
    @Override public String id() { return "notify"; }
    @Override public boolean rateLimited() { return false; }

    @Override public boolean apply(int count) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        if (count <= 0) { nm.cancel(ID); return true; }
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationChannel ch = nm.getNotificationChannel(CH);
        if (ch == null) {
            ch = new NotificationChannel(CH, "Unread", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Silent unread count for the Messenger icon");
            ch.setShowBadge(true);
            ch.setSound(null, null);
            ch.enableVibration(false);
            nm.createNotificationChannel(ch);
        }
        String shortcutId = HomeScreenPolicy.identity(HomeScreenShortcuts.origin(c), UnreadBadges.APP_ID);
        Intent open = new Intent(c, AppSessionActivity.class).setAction(Intent.ACTION_VIEW)
                .setData(HomeScreenShortcuts.taskUri(c, UnreadBadges.APP_ID))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(c, CH)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("Messenger")
                .setContentText(count == 1 ? "1 unread" : count + " unread")
                .setNumber(count)
                .setShortcutId(shortcutId)
                .setBadgeIconType(Notification.BADGE_ICON_SMALL)
                .setCategory(Notification.CATEGORY_STATUS)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(pi);
        nm.notify(ID, b.build());
        Log.i(UnreadBadges.TAG, "notification count=" + count);
        return true;
    }
}
