package ai.wizards.os.notify;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Clear chat notifications (wizard-ux issue 1276, switch wizard/clear-chat-notifications, off by default).
 *
 * Messenger sends a bridged chat's read receipt, but LINE (and the other chat apps) keep their own notification in the
 * tray, and no app may remove another app's notification. A notification listener may: once the owner gives Wizard
 * Android's "Notification access", this service dismisses the chat app's notification for a chat the owner just read
 * in Messenger ({@link BridgedNotifyPolicy} decides which). It keeps nothing, sends nothing anywhere and acts only on a
 * read the shell hands it.
 *
 * The component ships disabled in the manifest, so Wizard does not even appear in Android's Notification access list
 * until the switch is on; {@link #setOn} enables or disables it as the switch flips.
 */
public final class BridgedNotificationListener extends NotificationListenerService {
    private static volatile BridgedNotificationListener live;

    @Override public void onListenerConnected() { live = this; }
    @Override public void onListenerDisconnected() { if (live == this) live = null; }
    @Override public void onDestroy() { if (live == this) live = null; super.onDestroy(); }

    public static ComponentName component(Context c) { return new ComponentName(c, BridgedNotificationListener.class); }

    /** Switch on: the listener component exists (and Android lists Wizard under Notification access); off: it does not. */
    public static void setOn(Context c, boolean on) {
        PackageManager pm = c.getPackageManager();
        int want = on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        try {
            if (pm.getComponentEnabledSetting(component(c)) != want) pm.setComponentEnabledSetting(component(c), want, PackageManager.DONT_KILL_APP);
            if (on && access(c)) requestRebind(component(c));
        } catch (RuntimeException ignored) {}
    }

    public static boolean enabled(Context c) {
        try { return c.getPackageManager().getComponentEnabledSetting(component(c)) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED; }
        catch (RuntimeException e) { return false; }
    }

    /** The owner gave Wizard Android's Notification access. */
    public static boolean access(Context c) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            return nm != null && nm.isNotificationListenerAccessGranted(component(c));
        } catch (RuntimeException e) { return false; }
    }

    /** Android's Notification access page: Wizard's own row on Android 11+, else the list (see {@link #openAccess}). */
    public static Intent accessSettings(Context c, boolean detail) {
        Intent i = detail && Build.VERSION.SDK_INT >= 30
                ? new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                        .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component(c).flattenToString())
                : new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    /** Opens Notification access for Wizard; falls back to the plain list where a phone has no per-app page. */
    public static boolean openAccess(Context c) {
        try { c.startActivity(accessSettings(c, true)); return true; }
        catch (android.content.ActivityNotFoundException | SecurityException e) {
            try { c.startActivity(accessSettings(c, false)); return true; }
            catch (android.content.ActivityNotFoundException | SecurityException e2) { return false; }
        }
    }

    /** {"enabled", "access", "connected"} for the shell. */
    public static String state(Context c) {
        try {
            return new org.json.JSONObject().put("enabled", enabled(c)).put("access", access(c)).put("connected", live != null).toString();
        } catch (org.json.JSONException e) { return "{}"; }
    }

    /**
     * Dismisses the chat app's notifications for one read (the shell's {network, names[]} JSON). Returns how many were
     * dismissed; 0 when the listener is not connected (no access, switch off) or nothing matched.
     */
    public static int chatRead(String json) {
        BridgedNotificationListener l = live;
        BridgedNotifyPolicy.Read r = BridgedNotifyPolicy.parse(json);
        if (l == null || r == null) return 0;
        try { return l.clear(r); } catch (RuntimeException e) { return 0; }
    }

    private int clear(BridgedNotifyPolicy.Read r) {
        StatusBarNotification[] all = getActiveNotifications();
        if (all == null) return 0;
        Set<String> pkgs = BridgedNotifyPolicy.packagesFor(r.network);
        List<String> gone = new ArrayList<>();
        Set<String> groups = new HashSet<>();
        for (StatusBarNotification sbn : all) {
            if (sbn == null || !pkgs.contains(sbn.getPackageName())) continue;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) continue;
            boolean ongoing = sbn.isOngoing() || (n.flags & Notification.FLAG_FOREGROUND_SERVICE) != 0;
            if (!BridgedNotifyPolicy.messageLike(n.category, ongoing)) continue;
            Bundle x = n.extras;
            CharSequence title = x == null ? null : x.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence conv = x == null ? null : x.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE);
            CharSequence sub = x == null ? null : x.getCharSequence(Notification.EXTRA_SUB_TEXT);
            if (!BridgedNotifyPolicy.matches(r, sbn.getPackageName(), title, conv, sub)) continue;
            gone.add(sbn.getKey());
            if (sbn.getGroupKey() != null) groups.add(sbn.getGroupKey());
        }
        if (gone.isEmpty()) return 0;
        // A group's summary ("3 new messages") goes too once none of its own messages are left.
        Set<String> left = new HashSet<>();
        for (StatusBarNotification sbn : all) {
            if (sbn == null || gone.contains(sbn.getKey())) continue;
            Notification n = sbn.getNotification();
            if (n != null && (n.flags & Notification.FLAG_GROUP_SUMMARY) == 0 && sbn.getGroupKey() != null) left.add(sbn.getGroupKey());
        }
        List<String> keys = new ArrayList<>(gone);
        for (StatusBarNotification sbn : all) {
            if (sbn == null || !pkgs.contains(sbn.getPackageName())) continue;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) == 0) continue;
            String g = sbn.getGroupKey();
            if (g != null && groups.contains(g) && !left.contains(g)) keys.add(sbn.getKey());
        }
        cancelNotifications(keys.toArray(new String[0]));
        return gone.size();
    }
}
