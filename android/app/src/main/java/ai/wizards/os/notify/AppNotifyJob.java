package ai.wizards.os.notify;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import ai.wizards.os.device.AppState;
import ai.wizards.os.device.Http;

/**
 * Backstop for {@link AppNotifyService}: every ~15 minutes (Android's minimum; it also runs in Doze maintenance
 * windows) restart the connection if Android stopped it, and if it can't, fetch what the phone missed as one JSON
 * answer (same cursor), so notifications still arrive, late rather than lost.
 */
public final class AppNotifyJob extends JobService {
    static final int JOB_ID = 7602;

    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(JOB_ID) != null) return;
        JobInfo j = new JobInfo.Builder(JOB_ID, new ComponentName(c, AppNotifyJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60_000L)
                .setPersisted(true)
                .build();
        try { js.schedule(j); } catch (RuntimeException e) { Log.w(AppNotifications.TAG, "job: " + e.getMessage()); }
    }

    @Override public boolean onStartJob(JobParameters params) {
        final Context c = getApplicationContext();
        new Thread(() -> {
            try {
                AppNotifyService.ensure(c);
                if (!AppNotifyService.running()) catchUp(c);
            } finally {
                jobFinished(params, false);
            }
        }, "wizard-app-notify-job").start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) { return true; }

    /** Everything after the cursor (or a reset snapshot), handled exactly like the stream would. */
    static void catchUp(Context c) {
        String origin = AppState.origin(c);
        if (origin == null || origin.isEmpty() || !AppNotifications.canNotify(c)) return;
        if (!AppNotifications.prefs(c).getBoolean("supported:" + origin, false)) return;
        try {
            JSONObject r = Http.json("GET", AppNotifyPolicy.eventsUrl(origin, AppNotifications.last(c, origin), AppNotifications.sid(c, origin)), origin, null, null);
            String sid = r.optString("sid");
            long latest = r.optLong("latest", -1);
            if (r.optBoolean("reset")) {
                AppNotifications.handle(c, origin, "reset", r);
                AppNotifications.cursor(c, origin, sid, latest);
                return;
            }
            JSONArray events = r.optJSONArray("events");
            for (int i = 0; events != null && i < events.length(); i++) {
                JSONObject ev = events.optJSONObject(i);
                if (ev == null) continue;
                AppNotifications.handle(c, origin, ev.optString("type"), ev);
                AppNotifications.cursor(c, origin, sid, ev.optLong("id"));
            }
        } catch (Exception e) {
            Log.i(AppNotifications.TAG, "catch-up: " + e.getMessage());
        }
    }
}
