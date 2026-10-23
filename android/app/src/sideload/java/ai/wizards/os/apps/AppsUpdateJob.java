package ai.wizards.os.apps;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Background updates for apps Wizard OS installed: every few hours on an unmetered network, ask the Android Apps
 * server for newer pinned builds and install them silently (Wizard OS is their update owner). A quiet notification
 * appears only when one fails or Android insists on a confirm. Same pattern as update/UpdateJob.
 */
public class AppsUpdateJob extends JobService {
    static final int JOB_ID = 7621;
    static final long PERIOD_MS = 6 * 3600_000L, FLEX_MS = 2 * 3600_000L;

    public static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null) return;
        JobInfo cur = js.getPendingJob(JOB_ID);
        if (cur != null && cur.getIntervalMillis() == PERIOD_MS) return;
        JobInfo j = new JobInfo.Builder(JOB_ID, new ComponentName(c, AppsUpdateJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)
                .setPeriodic(PERIOD_MS, FLEX_MS)
                .setPersisted(true)
                .build();
        try { js.schedule(j); } catch (RuntimeException e) { Log.w(AppsInstaller.TAG, "job: " + e); }
    }

    @Override
    public boolean onStartJob(JobParameters p) {
        Log.i(AppsInstaller.TAG, "job: checking app updates");
        AppsInstaller.checkUpdates(this, () -> jobFinished(p, false));
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters p) { return true; }
}
