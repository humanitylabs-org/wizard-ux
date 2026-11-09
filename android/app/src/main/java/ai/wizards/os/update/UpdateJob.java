package ai.wizards.os.update;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Background update check: every few hours on any network except roaming (wizard-ux#1219), even with WizardOS closed. Reads the feed,
 * downloads + verifies a newer build, and installs it (silently once WizardOS installed the running version).
 * Plain JobScheduler: no WorkManager dependency for one periodic job.
 */
public class UpdateJob extends JobService {
    static final int JOB_ID = 7611;
    static final long PERIOD_MS = 6 * 3600_000L, FLEX_MS = 2 * 3600_000L;
    /** Wi-Fi or home mobile data; never while roaming (wizard-ux#1219). */
    static final int NETWORK = JobInfo.NETWORK_TYPE_NOT_ROAMING;

    @SuppressWarnings("deprecation") // getNetworkType(): fine for comparing our own simple job
    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null) return;
        JobInfo cur = js.getPendingJob(JOB_ID);
        // Re-schedule a job persisted by an older build with the old UNMETERED constraint, or it never fires on mobile data.
        if (cur != null && cur.getIntervalMillis() == PERIOD_MS && cur.getNetworkType() == NETWORK) return;
        JobInfo j = new JobInfo.Builder(JOB_ID, new ComponentName(c, UpdateJob.class))
                .setRequiredNetworkType(NETWORK)
                .setPeriodic(PERIOD_MS, FLEX_MS)
                .setPersisted(true)
                .build();
        try { js.schedule(j); } catch (RuntimeException e) { Log.w(Updater.TAG, "job: " + e); }
    }

    @Override
    public boolean onStartJob(JobParameters p) {
        Log.i(Updater.TAG, "job: checking");
        Updater.check(this, () -> jobFinished(p, false));
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters p) { return true; }
}
