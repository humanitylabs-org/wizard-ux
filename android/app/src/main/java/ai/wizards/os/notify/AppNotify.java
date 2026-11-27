package ai.wizards.os.notify;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.LinkedHashSet;
import java.util.Set;

import ai.wizards.os.MainActivity;
import ai.wizards.os.device.AppState;
import ai.wizards.os.device.Http;

/**
 * Phone notifications per app (wizard-ux issue 1567, on for everyone).
 * Reads the Notifications app (the one notify door every Wizard app and the agent already post to) and posts each new
 * item as its own Android notification, on a channel per app named after it, so Android settings can mute one app
 * and keep the others. A tap opens the item's link on this Wizard, or the app. Rules: {@link AppNotifyPolicy}.
 *
 * Delivery is a read every 30 s while the app process lives, plus a 15-minute JobScheduler backstop after a kill.
 * With the switch wizard/phone-push on as well, {@link AppPush} keeps a line to the box open and reads at once on
 * each new item, also while the phone is locked (issue 1618). While WizardOS is on screen nothing is posted
 * (the shell shows it), but the watermark still moves, so nothing seen there is posted later.
 *
 * The main page hands over the installed apps' names for the channels (WizardOSNative.appNotifySwitch; the name stays
 * from when this had a switch, and its on/off argument is ignored: the switch wizard/phone-app-notifications is gone).
 */
public final class AppNotify {
    static final String TAG = "WizardAppNotify";
    static final String GROUP = "wizard-apps";
    static final int JOB_ID = 7403, N_ID = 7700;
    static final long LOOP_MS = 30_000L;
    private static final String PREFS = "app-notify";
    private static final Object LOCK = new Object();
    private static Handler loop;

    private AppNotify() {}

    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** From the main page: the installed apps' names ({id: name}, may be empty); starts the reader. */
    public static void apps(Context c, String names) {
        Context app = c.getApplicationContext();
        SharedPreferences.Editor e = prefs(app).edit();
        if (names != null && names.length() <= 20_000) {
            try { new JSONObject(names); e.putString("names", names); } catch (JSONException ignored) { }
        }
        e.remove("on"); // the copy of the removed switch wizard/phone-app-notifications older versions kept
        e.apply();
        kick(app);
    }

    /** True once: the page may ask Android for permission to post, never again. */
    public static boolean askOnce(Context c) {
        SharedPreferences p = prefs(c);
        if (p.getBoolean("asked", false)) return false;
        p.edit().putBoolean("asked", true).apply();
        return true;
    }

    /** Start (or keep) the in-process read and the backstop job. */
    public static void kick(Context c) {
        Context app = c.getApplicationContext();
        AppPush.ensure(app); // box-to-phone push (issue 1618, its own switch)
        synchronized (LOCK) {
            if (loop == null) {
                HandlerThread t = new HandlerThread("wizard-app-notify");
                t.start();
                loop = new Handler(t.getLooper());
            }
            loop.removeCallbacksAndMessages(null);
            loop.post(new Runnable() {
                @Override public void run() {
                    if (!AppPush.listening()) pollOnce(app); // the push line reads at once; no need to ask every 30 s

                    loop.postDelayed(this, LOOP_MS);
                }
            });
        }
        scheduleJob(app);
    }

    static void stop(Context c) {
        synchronized (LOCK) { if (loop != null) loop.removeCallbacksAndMessages(null); }
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js != null) js.cancel(JOB_ID);
    }

    static void scheduleJob(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(JOB_ID) != null) return;
        JobInfo j = new JobInfo.Builder(JOB_ID, new ComponentName(c, AppNotifyJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60_000L)
                .setPersisted(true)
                .build();
        try { js.schedule(j); } catch (RuntimeException e) { Log.w(TAG, "job: " + e); }
    }

    private static final Object POLL = new Object();

    /** One read of the Notifications app. Network: call off the main thread. */
    static void pollOnce(Context c) {
        // Without permission to post (Android 13+, not granted yet) nothing is read or consumed, so it shows once allowed.
        if (!canNotify(c)) return;
        synchronized (POLL) {
            String origin = AppState.origin(c);
            JSONArray items;
            JSONObject routes = null;
            try {
                items = Http.json("GET", origin + "/notifications/api/items?view=all&limit=50", origin, null, null).optJSONArray("items");
            } catch (IOException e) { return; } // Notifications not installed or the box is away: try again next time
            SharedPreferences p = prefs(c);
            try {
                routes = Http.json("GET", origin + "/notifications/api/routes", origin, null, null).optJSONObject("routes");
                if (routes == null) routes = new JSONObject();
                p.edit().putString("routes", routes.toString()).apply();
            } catch (Http.Error e) {
                // An Off app must never slip through a failed read: use the last levels read, else skip this pass.
                // A Notifications without saved levels (404) means every app is on.
                try { routes = e.status == 404 ? new JSONObject() : p.contains("routes") ? new JSONObject(p.getString("routes", "{}")) : null; }
                catch (JSONException bad) { routes = null; }
                if (routes == null) return;
            } catch (IOException e) { return; }
            double since = p.contains("since") ? Double.longBitsToDouble(p.getLong("since", 0)) : -1;
            Set<String> posted = new LinkedHashSet<>();
            try {
                JSONArray a = new JSONArray(p.getString("posted", "[]"));
                for (int i = 0; i < a.length(); i++) posted.add(a.optString(i));
            } catch (JSONException ignored) { }
            AppNotifyPolicy.Pass pass = AppNotifyPolicy.pass(items, routes, since, posted);
            boolean show = !AppState.front();
            JSONObject names = names(c);
            for (AppNotifyPolicy.Note n : pass.post) {
                posted.add(n.id);
                if (show) post(c, origin, n, names);
            }
            JSONArray keep = new JSONArray();
            int skip = Math.max(0, posted.size() - AppNotifyPolicy.KEEP_POSTED), i = 0;
            for (String id : posted) if (i++ >= skip) keep.put(id);
            p.edit().putLong("since", Double.doubleToLongBits(pass.since)).putString("posted", keep.toString()).apply();
            if (!pass.post.isEmpty()) Log.i(TAG, (show ? "posted " : "seen on screen ") + pass.post.size());
        }
    }

    static JSONObject names(Context c) {
        try { return new JSONObject(prefs(c).getString("names", "{}")); } catch (JSONException e) { return new JSONObject(); }
    }

    static boolean canNotify(Context c) {
        return Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    /** The app's own channel, made once (later calls only rename it: the owner's sound / mute choices stay). */
    static String channel(Context c, String app, JSONObject names) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        String id = AppNotifyPolicy.channelId(app), name = AppNotifyPolicy.channelName(app, names);
        if (nm.getNotificationChannelGroup(GROUP) == null) nm.createNotificationChannelGroup(new NotificationChannelGroup(GROUP, "Wizard apps"));
        NotificationChannel ch = nm.getNotificationChannel(id);
        if (ch == null) {
            ch = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_DEFAULT);
            ch.setGroup(GROUP);
        } else ch.setName(name);
        ch.setDescription("Notifications from " + name + " on your Wizard");
        nm.createNotificationChannel(ch);
        return id;
    }

    static void post(Context c, String origin, AppNotifyPolicy.Note n, JSONObject names) {
        if (!canNotify(c)) return;
        String name = AppNotifyPolicy.channelName(n.app, names);
        String ch = channel(c, n.app, names);
        // A chat reply (wizard-ux issue 1619) opens its thread through the same handoff as the reply watcher's notes.
        Intent i = n.thread != null
                ? new Intent(c, MainActivity.class).setAction(MainActivity.ACTION_THREAD).putExtra(MainActivity.EXTRA_THREAD, n.thread)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                : new Intent(Intent.ACTION_VIEW, Uri.parse(AppNotifyPolicy.target(origin, n.link, n.app)), c, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        String tag = "app-note:" + n.id;
        PendingIntent pi = PendingIntent.getActivity(c, tag.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String title = n.title.isEmpty() ? name : n.title;
        Notification.Builder b = new Notification.Builder(c, ch)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle(title)
                .setSubText(name)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setGroup(ch)
                .setWhen((long) (n.time * 1000))
                .setShowWhen(true);
        if (!n.text.isEmpty()) b.setContentText(n.text).setStyle(new Notification.BigTextStyle().bigText(n.text));
        // The thread goes along, so reading it anywhere in Wizard clears this note (ReplyWatcher.clearThread / active).
        if (n.thread != null) b.setCategory(Notification.CATEGORY_MESSAGE).addExtras(ReplyWatcher.threadExtras(n.thread));
        try {
            c.getSystemService(NotificationManager.class).notify(tag, N_ID, b.build());
        } catch (RuntimeException e) { Log.w(TAG, "post: " + e); }
    }
}
