package ai.wizards.os.notify;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import ai.wizards.os.AppSessionActivity;
import ai.wizards.os.HomeScreenPolicy;
import ai.wizards.os.HomeScreenShortcuts;
import ai.wizards.os.device.AppState;
import ai.wizards.os.device.Http;

/**
 * Real Android notifications for Wizard apps routed to Chats on the box: one channel per app (its name, so the owner
 * can tune each app in Android settings), the app's name on every notification, a tap opens that app's own
 * single-app session (the same task a pinned home-screen icon opens), and the app's inbox actions as buttons: an
 * `input` action (Messenger's Reply) becomes an inline reply. Events come from {@link AppNotifyService} (live) or
 * {@link AppNotifyJob} (catch-up backstop); both go through {@link #handle}, one at a time.
 */
public final class AppNotifications {
    static final String TAG = "WizardAppNotify";
    static final int N_ID = 7600;
    static final String GROUP = "wizard-apps";
    public static final String ACTION_ACT = "ai.wizards.os.notify.APP_ACTION";
    public static final String EXTRA_APP = "wos.app", EXTRA_KEY = "wos.key", EXTRA_ACTION = "wos.action", EXTRA_ORIGIN = "wos.origin";
    public static final String REPLY_KEY = "wos.reply";
    private static final Object LOCK = new Object();

    private AppNotifications() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("app-notify", Context.MODE_PRIVATE); }

    // ---- cursor: the last event id the phone handled, per Wizard and router store ----

    static String sid(Context c, String origin) { return prefs(c).getString("sid:" + origin, ""); }

    static long last(Context c, String origin) { return prefs(c).getLong("last:" + origin, -1); }

    static void cursor(Context c, String origin, String sid, long last) {
        prefs(c).edit().putString("sid:" + origin, sid == null ? "" : sid).putLong("last:" + origin, last).apply();
    }

    // ---- app names and paths from the Wizard's registry ----

    static void refreshApps(Context c, String origin) {
        try {
            JSONObject r = Http.json("GET", origin + "/wizard/v1/apps", origin, null, null);
            JSONArray list = r.optJSONArray("apps");
            if (list == null) return;
            JSONObject out = new JSONObject();
            for (int i = 0; i < list.length() && i < 500; i++) {
                JSONObject a = list.optJSONObject(i);
                if (a == null || !AppNotifyPolicy.validApp(a.optString("id"))) continue;
                out.put(a.optString("id"), new JSONObject().put("name", a.optString("name")).put("url", a.optString("url")));
            }
            prefs(c).edit().putString("apps:" + origin, out.toString()).putLong("apps-at:" + origin, System.currentTimeMillis()).apply();
        } catch (Exception e) {
            Log.i(TAG, "app names: " + e.getMessage());
        }
    }

    static boolean appsStale(Context c, String origin) {
        return System.currentTimeMillis() - prefs(c).getLong("apps-at:" + origin, 0) > 6 * 3600_000L;
    }

    private static JSONObject app(Context c, String origin, String id) {
        try {
            JSONObject all = new JSONObject(prefs(c).getString("apps:" + origin, "{}"));
            JSONObject a = all.optJSONObject(id);
            return a == null ? new JSONObject() : a;
        } catch (JSONException e) { return new JSONObject(); }
    }

    public static String appName(Context c, String origin, String id) {
        String n = app(c, origin, id).optString("name", "").trim();
        return n.isEmpty() || n.length() > 80 ? AppNotifyPolicy.fallbackName(id) : n;
    }

    public static String appPath(Context c, String origin, String id) {
        return AppNotifyPolicy.appPath(app(c, origin, id).optString("url", ""), id);
    }

    // ---- events ----

    static boolean canNotify(Context c) {
        return Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    /** One router event. Returns false only for a malformed event (the cursor still moves past it). */
    public static boolean handle(Context c, String origin, String type, JSONObject ev) {
        synchronized (LOCK) {
            switch (type == null ? "" : type) {
                case "notify": return post(c, origin, ev, ev.optBoolean("alert"));
                case "clear": return cancel(c, ev.optString("app"), ev.optString("key"));
                case "count": {
                    String app = ev.optString("app");
                    if (!AppNotifyPolicy.validApp(app)) return false;
                    prefs(c).edit().putInt("count:" + origin + ":" + app, Math.max(0, ev.optInt("count"))).apply();
                    return true;
                }
                case "reset": return reset(c, origin, ev);
                default: return true;   // hello, future kinds: nothing to show
            }
        }
    }

    /** A full snapshot (new store or an old cursor): show what waits, drop what no longer does. */
    static boolean reset(Context c, String origin, JSONObject ev) {
        JSONArray items = ev.optJSONArray("items");
        Set<String> active = new HashSet<>();
        if (items != null) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                // Missed while offline: alert once if the phone never alerted this activity; else just show it.
                if (post(c, origin, it, true)) active.add(AppNotifyPolicy.tag(it.optString("app"), it.optString("key")));
            }
        }
        JSONObject counts = ev.optJSONObject("counts");
        SharedPreferences.Editor e = prefs(c).edit();
        for (String k : prefs(c).getAll().keySet()) if (k.startsWith("count:" + origin + ":")) e.remove(k);
        if (counts != null) for (java.util.Iterator<String> it = counts.keys(); it.hasNext(); ) {
            String app = it.next();
            if (AppNotifyPolicy.validApp(app)) e.putInt("count:" + origin + ":" + app, Math.max(0, counts.optInt(app)));
        }
        e.apply();
        for (String tag : AppNotifyPolicy.stale(shownTags(c), active)) cancelTag(c, tag);
        return true;
    }

    static List<String> shownTags(Context c) {
        List<String> out = new ArrayList<>();
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return out;
        try {
            for (StatusBarNotification s : nm.getActiveNotifications())
                if (s.getId() == N_ID && s.getTag() != null && s.getTag().startsWith(AppNotifyPolicy.TAG_PREFIX)) out.add(s.getTag());
        } catch (RuntimeException ignored) { }
        return out;
    }

    static boolean cancel(Context c, String app, String key) {
        if (!AppNotifyPolicy.validApp(app) || !AppNotifyPolicy.validKey(key)) return false;
        cancelTag(c, AppNotifyPolicy.tag(app, key));
        return true;
    }

    static void cancelTag(Context c, String tag) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(tag, N_ID);
        prefs(c).edit().remove("alerted:" + tag).remove("item:" + tag).apply();
    }

    static void channel(Context c, String app, String name) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannelGroup(GROUP) == null) nm.createNotificationChannelGroup(new NotificationChannelGroup(GROUP, "Wizard apps"));
        NotificationChannel ch = nm.getNotificationChannel(AppNotifyPolicy.channel(app));
        if (ch != null && name.contentEquals(ch.getName())) return;
        // Same id keeps the owner's own settings for this app; only the name follows the app.
        if (ch == null) ch = new NotificationChannel(AppNotifyPolicy.channel(app), name, NotificationManager.IMPORTANCE_HIGH);
        else ch.setName(name);
        ch.setGroup(GROUP);
        ch.setDescription("New items from " + name + " on your Wizard, when " + name + " goes to Chats");
        nm.createNotificationChannel(ch);
    }

    /** The app's pinned home-screen icon, when the owner pinned it (the same picture as on his home screen). */
    private static Bitmap icon(Context c, String origin, String app) {
        try {
            String png = c.getSharedPreferences("home-screen-pins", Context.MODE_PRIVATE)
                    .getString(HomeScreenPolicy.identity(origin, app) + ":icon", "");
            if (!png.startsWith("data:image/png;base64,") || png.length() > 90000) return null;
            byte[] b = Base64.decode(png.substring(22), Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(b, 0, b.length);
        } catch (RuntimeException e) { return null; }
    }

    static PendingIntent openSession(Context c, String app, String tag) {
        Intent open = new Intent(c, AppSessionActivity.class).setAction(Intent.ACTION_VIEW)
                .setData(HomeScreenShortcuts.taskUri(c, app))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Intent actIntent(Context c, String origin, String app, String key, String action) {
        // Explicit, not exported, and a distinct data URI per item + action so PendingIntents never collide.
        return new Intent(c, AppNotifyReceiver.class).setAction(ACTION_ACT)
                .setData(new Uri.Builder().scheme("wizapp-act").authority(app).appendPath(action).appendQueryParameter("k", key).build())
                .putExtra(EXTRA_APP, app).putExtra(EXTRA_KEY, key).putExtra(EXTRA_ACTION, action).putExtra(EXTRA_ORIGIN, origin);
    }

    static boolean post(Context c, String origin, JSONObject ev, boolean routerSaysNew) {
        String app = ev.optString("app"), key = ev.optString("key");
        if (!AppNotifyPolicy.validApp(app) || !AppNotifyPolicy.validKey(key) || !HomeScreenPolicy.validId(app)) return false;
        if (!canNotify(c)) { Log.i(TAG, "notifications are off for Wizard OS; skipped " + app); return true; }
        String tag = AppNotifyPolicy.tag(app, key), name = appName(c, origin, app);
        channel(c, app, name);
        long time = ev.optLong("time");
        long alerted = prefs(c).getLong("alerted:" + tag, 0);
        boolean alert = AppNotifyPolicy.alert(routerSaysNew, time, alerted, AppState.front());
        SharedPreferences.Editor e = prefs(c).edit().putString("item:" + tag, ev.toString());
        if (routerSaysNew && time > alerted) e.putLong("alerted:" + tag, time);   // seen once, never alerted again
        e.apply();
        String title = ev.optString("title").trim(), text = ev.optString("text").trim();
        Notification.Builder b = new Notification.Builder(c, AppNotifyPolicy.channel(app))
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle(title.isEmpty() ? name : title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSubText(name)
                .setShowWhen(time > 0)
                .setContentIntent(openSession(c, app, tag))
                .setAutoCancel(true)
                .setGroup(AppNotifyPolicy.channel(app))
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setOnlyAlertOnce(!alert);
        if (time > 0) b.setWhen(time * 1000L);
        // Quiet: a grouped child that only lets the (never posted) summary alert makes no sound or heads-up.
        if (!alert) b.setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY);
        Bitmap big = icon(c, origin, app);
        if (big != null) b.setLargeIcon(big);
        JSONArray acts = ev.optJSONArray("actions");
        int shown = 0;
        for (int i = 0; acts != null && i < acts.length() && shown < 3; i++) {
            JSONObject a = acts.optJSONObject(i);
            if (a == null || !AppNotifyPolicy.validAction(a.optString("id"))) continue;
            String label = a.optString("label", a.optString("id"));
            Intent act = actIntent(c, origin, app, key, a.optString("id"));
            int req = (tag + "|" + a.optString("id")).hashCode();
            Notification.Action.Builder ab;
            if (a.optBoolean("input")) {
                // RemoteInput fills the intent in: Android requires it mutable; it stays explicit to our receiver.
                PendingIntent pi = PendingIntent.getBroadcast(c, req, act, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                ab = new Notification.Action.Builder(Icon.createWithResource(c, android.R.drawable.ic_menu_send), label, pi)
                        .addRemoteInput(new RemoteInput.Builder(REPLY_KEY).setLabel(label + " to " + (title.isEmpty() ? name : title)).build())
                        .setAllowGeneratedReplies(true);
                ab.setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY);
            } else {
                PendingIntent pi = PendingIntent.getBroadcast(c, req, act, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                ab = new Notification.Action.Builder(Icon.createWithResource(c, android.R.drawable.ic_menu_view), label, pi);
                if ("read".equals(a.optString("id"))) ab.setSemanticAction(Notification.Action.SEMANTIC_ACTION_MARK_AS_READ);
            }
            b.addAction(ab.build());
            shown++;
        }
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.notify(tag, N_ID, b.build());
        Log.i(TAG, "posted " + app + " alert=" + alert);
        return true;
    }

    /** The reply could not reach the app: say so on the same notification, quietly, keeping its buttons. */
    static void failed(Context c, String origin, String app, String key, String why) {
        String tag = AppNotifyPolicy.tag(app, key);
        try {
            JSONObject ev = new JSONObject(prefs(c).getString("item:" + tag, "{}"));
            if (ev.optString("app").isEmpty()) ev.put("app", app).put("key", key).put("title", appName(c, origin, app));
            ev.put("text", why);
            synchronized (LOCK) { post(c, origin, ev, false); }
        } catch (JSONException ignored) { }
    }
}
