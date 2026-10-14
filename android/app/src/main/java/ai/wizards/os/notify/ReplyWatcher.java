package ai.wizards.os.notify;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.URLEncoder;

import ai.wizards.os.MainActivity;
import ai.wizards.os.device.AppState;
import ai.wizards.os.device.Http;

/**
 * Reply-ready notifications for any chat James started or answered from Wizard OS (gap #21).
 * The page reports each accepted send (session + run). This polls the run until it settles and, if Wizard OS is
 * not on screen, posts "Archimedes replied" with the start of the answer; a tap opens that thread in the app.
 * Polls in-process every few seconds while the app lives, with a JobScheduler job as the backstop after a kill.
 */
public final class ReplyWatcher {
    static final String TAG = "WizardReplies";
    public static final String CH = "chat-replies";
    static final int JOB_ID = 7401, N_BASE = 7500;
    static final long MAX_AGE = 6 * 3600_000L;
    private static final Object LOCK = new Object();
    private static Handler loop;

    private ReplyWatcher() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("reply-watch", Context.MODE_PRIVATE); }

    static JSONArray list(Context c) {
        try { return new JSONArray(prefs(c).getString("w", "[]")); } catch (JSONException e) { return new JSONArray(); }
    }

    static void save(Context c, JSONArray a) { prefs(c).edit().putString("w", a.toString()).apply(); }

    public static int count(Context c) { synchronized (LOCK) { return list(c).length(); } }

    public static void watch(Context c, String session, String run, String title) {
        if (session == null || session.isEmpty() || run == null || run.isEmpty()) return;
        Context app = c.getApplicationContext();
        synchronized (LOCK) {
            JSONArray a = list(app), out = new JSONArray();
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && !session.equals(o.optString("s"))) out.put(o); // the newest run per thread wins
            }
            try {
                out.put(new JSONObject().put("s", session).put("r", run).put("t", title == null ? "" : title)
                        .put("at", System.currentTimeMillis()).put("asked", false));
            } catch (JSONException ignored) { }
            save(app, out);
        }
        Log.i(TAG, "watch " + session + " run=" + run);
        kick(app);
    }

    /** Extra carried by every per-thread notification (reply watcher + Wizard Everywhere) so it can be found again. */
    public static final String EXTRA_THREAD = "wos.thread";

    public static Bundle threadExtras(String session) {
        Bundle b = new Bundle();
        if (session != null) b.putString(EXTRA_THREAD, session);
        return b;
    }

    /** Thread notifications on the shade right now, as [{"s": session, "at": postedAtMillis}]. */
    public static String active(Context c) {
        JSONArray out = new JSONArray();
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return "[]";
        try {
            for (StatusBarNotification sbn : nm.getActiveNotifications()) {
                String s = sbn.getNotification().extras.getString(EXTRA_THREAD);
                if (s == null || s.isEmpty()) continue;
                out.put(new JSONObject().put("s", s).put("at", sbn.getPostTime()));
            }
        } catch (RuntimeException | JSONException e) { Log.w(TAG, "active: " + e); }
        return out.toString();
    }

    /** The thread was read in Wizard (any route, any surface): its notifications have done their job. */
    public static int clearThread(Context c, String session) {
        if (session == null || session.isEmpty()) return 0;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return 0;
        int n = 0;
        try {
            for (StatusBarNotification sbn : nm.getActiveNotifications()) {
                if (!session.equals(sbn.getNotification().extras.getString(EXTRA_THREAD))) continue;
                nm.cancel(sbn.getTag(), sbn.getId());
                n++;
            }
        } catch (RuntimeException e) { Log.w(TAG, "clear: " + e); }
        if (n > 0) Log.i(TAG, "cleared " + n + " for " + session);
        return n;
    }

    /** Wizard OS came to the front: the thread is right there, so drop notifications for it. */
    public static void appFront(Context c) {
        kick(c.getApplicationContext());
    }

    /** Start (or keep) the in-process poll and make sure the backstop job is scheduled. */
    public static void kick(Context c) {
        Context app = c.getApplicationContext();
        if (count(app) == 0) { cancelJob(app); return; }
        synchronized (LOCK) {
            if (loop == null) {
                HandlerThread t = new HandlerThread("wizard-replies");
                t.start();
                loop = new Handler(t.getLooper());
            }
            loop.removeCallbacksAndMessages(null);
            loop.postDelayed(new Runnable() {
                @Override public void run() {
                    pollOnce(app);
                    if (count(app) > 0) loop.postDelayed(this, AppState.front() ? 8000 : 5000);
                }
            }, 3000);
        }
        scheduleJob(app);
    }

    static void scheduleJob(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(JOB_ID) != null) return;
        JobInfo j = new JobInfo.Builder(JOB_ID, new ComponentName(c, ReplyJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setMinimumLatency(60_000)
                .setOverrideDeadline(15 * 60_000)
                .build();
        try { js.schedule(j); } catch (RuntimeException e) { Log.w(TAG, "job: " + e); }
    }

    static void cancelJob(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js != null) js.cancel(JOB_ID);
    }

    /** One pass over every watched run. Network: call off the main thread. */
    static void pollOnce(Context c) {
        JSONArray a;
        synchronized (LOCK) { a = list(c); }
        if (a.length() == 0) return;
        String origin = AppState.origin(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject w = a.optJSONObject(i);
            if (w == null) continue;
            String s = w.optString("s"), r = w.optString("r");
            if (System.currentTimeMillis() - w.optLong("at") > MAX_AGE) { drop(c, s, r); continue; }
            JSONObject run;
            try {
                run = Http.json("GET", origin + "/wizard/hermes/v1/runs/" + URLEncoder.encode(r, "UTF-8"), origin, null, null);
            } catch (Http.Error e) {
                if (e.status == 404) drop(c, s, r);
                continue;
            } catch (IOException e) { continue; }
            String st = run.optString("status");
            String title = w.optString("t");
            if ("waiting_for_approval".equals(st) && !w.optBoolean("asked")) {
                mark(c, s, r);
                if (!AppState.front()) post(c, s, title.isEmpty() ? "Waiting on you" : title, "Archimedes needs your approval to continue");
            } else if (ReplyPolicy.settled(st)) {
                drop(c, s, r);
                String text = "completed".equals(st) ? ReplyPolicy.excerpt(run.optString("output", "")) : ReplyPolicy.ended(st);
                if (!AppState.front()) post(c, s, title.isEmpty() ? "Archimedes replied" : title, text.isEmpty() ? "Reply ready" : text);
                Log.i(TAG, "settled " + s + " " + st + " front=" + AppState.front());
            }
        }
    }

    private static void drop(Context c, String s, String r) {
        synchronized (LOCK) {
            JSONArray a = list(c), out = new JSONArray();
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && !(s.equals(o.optString("s")) && r.equals(o.optString("r")))) out.put(o);
            }
            save(c, out);
        }
    }

    private static void mark(Context c, String s, String r) {
        synchronized (LOCK) {
            JSONArray a = list(c);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && s.equals(o.optString("s")) && r.equals(o.optString("r"))) {
                    try { o.put("asked", true); } catch (JSONException ignored) { }
                }
            }
            save(c, a);
        }
    }

    static boolean canNotify(Context c) {
        return Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static void channel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH) != null) return;
        NotificationChannel ch = new NotificationChannel(CH, "Chat replies", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("When Archimedes answers a chat you sent from Wizard OS");
        nm.createNotificationChannel(ch);
    }

    static void post(Context c, String session, String title, String text) {
        if (!canNotify(c)) { Log.i(TAG, "notifications off; skipped " + session); return; }
        channel(c);
        Intent open = new Intent(c, MainActivity.class).setAction(MainActivity.ACTION_THREAD)
                .putExtra(MainActivity.EXTRA_THREAD, session)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int id = N_BASE + (session.hashCode() & 0x3ff);
        PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CH)
                .setSmallIcon(ai.wizards.os.R.drawable.ic_wizard_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .addExtras(threadExtras(session))
                .build();
        c.getSystemService(NotificationManager.class).notify(id, n);
        Log.i(TAG, "notified " + session);
    }
}
