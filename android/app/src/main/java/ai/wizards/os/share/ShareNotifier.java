package ai.wizards.os.share;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

import java.util.Locale;

import ai.wizards.os.MainActivity;
import ai.wizards.os.device.DeviceBridge;

/**
 * Share notifications. Privacy rule (briefs/share-files.md #6): they only ever say "N files → &lt;agent label&gt;",
 * never a file name or the note. Tapping one opens the thread the share went to (once the Wizard named it).
 */
public final class ShareNotifier {
    static final String CH_PROGRESS = "shares", CH_ALERT = "share-alerts";
    public static final int FG_ID = 0x53F0;

    private ShareNotifier() {}

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CH_ALERT) != null) return;
        NotificationChannel p = new NotificationChannel(CH_PROGRESS, "Sending files", NotificationManager.IMPORTANCE_LOW);
        p.setDescription("Progress while shared files upload to your Wizard");
        p.setShowBadge(false);
        NotificationChannel a = new NotificationChannel(CH_ALERT, "Shared files", NotificationManager.IMPORTANCE_DEFAULT);
        a.setDescription("Shared files that were sent, or that need you");
        nm.createNotificationChannel(p);
        nm.createNotificationChannel(a);
    }

    /** "1 file → Wizard", "3 files → Private". */
    public static String title(JSONObject it) {
        int n = ShareQueue.fileCount(it);
        String label = it.optString("agentLabel").trim();
        return n + (n == 1 ? " file" : " files") + " → " + (label.isEmpty() ? "Wizard" : label);
    }

    static String size(long b) {
        if (b >= 1L << 30) return String.format(Locale.US, "%.1f GB", b / (double) (1L << 30));
        if (b >= 1L << 20) return String.format(Locale.US, "%.0f MB", b / (double) (1L << 20));
        if (b >= 1024) return (b / 1024) + " KB";
        return b + " B";
    }

    static int pct(long sent, long total) { return total <= 0 ? 0 : (int) Math.min(100, sent * 100 / total); }

    private static PendingIntent open(Context c, JSONObject it, int req) {
        String thread = it == null ? "" : it.optString("thread_id");
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!thread.isEmpty()) i.setAction(MainActivity.ACTION_THREAD).putExtra(MainActivity.EXTRA_THREAD, thread);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static int idOf(JSONObject it) { return 0x5300 + (it.optString("id").hashCode() & 0xff); }

    /** The ongoing notification (the foreground service's own while it runs). */
    static Notification progress(Context c, JSONObject it, String phase, long sent, long total) {
        channels(c);
        Notification.Builder b = new Notification.Builder(c, CH_PROGRESS)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
                .setCategory(Notification.CATEGORY_PROGRESS);
        if (it == null) {
            b.setContentTitle("Sending files to Wizard").setContentText("Getting ready…").setProgress(0, 0, true);
        } else {
            int p = pct(sent, total);
            b.setContentTitle(title(it)).setContentIntent(open(c, it, idOf(it)));
            if ("copying".equals(phase)) b.setContentText("Preparing · " + p + "%").setProgress(100, p, false);
            else if ("waiting".equals(phase)) b.setContentText(total > 0 ? "Waiting for network · " + p + "%" : "Waiting for network").setProgress(100, p, false);
            else if ("retry".equals(phase)) b.setContentText("Waiting for your Wizard · " + p + "%").setProgress(100, p, false);
            else if ("finishing".equals(phase)) b.setContentText("Finishing…").setProgress(0, 0, true);
            else b.setContentText(p + "% · " + size(sent) + " of " + size(total)).setProgress(100, p, false);
        }
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    static void showProgress(Context c, Notification n) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) try { nm.notify(FG_ID, n); } catch (RuntimeException ignored) { }
    }

    static void clearProgress(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(FG_ID);
    }

    static void done(Context c, JSONObject it) {
        channels(c);
        post(c, idOf(it), new Notification.Builder(c, CH_PROGRESS).setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .setContentTitle(title(it)).setContentText("Sent · tap to open the chat")
                .setAutoCancel(true).setContentIntent(open(c, it, idOf(it))).build());
    }

    static void failed(Context c, JSONObject it, String reason) {
        channels(c);
        post(c, idOf(it), new Notification.Builder(c, CH_ALERT).setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(title(it) + " · not sent").setContentText(reason)
                .setStyle(new Notification.BigTextStyle().bigText(reason))
                .setAutoCancel(true).setContentIntent(open(c, null, idOf(it))).build());
    }

    /** No resumable API on this Wizard: the share waits in the app's own picker. */
    static void handoff(Context c, JSONObject it, String legacyId) {
        channels(c);
        Intent i = new Intent(c, MainActivity.class).setAction(DeviceBridge.ACTION_SHARE).putExtra(DeviceBridge.EXTRA_SHARE, legacyId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, idOf(it), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        post(c, idOf(it), new Notification.Builder(c, CH_ALERT).setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle(title(it)).setContentText("Tap to finish sharing in Wizard")
                .setAutoCancel(true).setContentIntent(pi).build());
    }

    private static void post(Context c, int id, Notification n) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) try { nm.notify(id, n); } catch (RuntimeException ignored) { }
    }
}
