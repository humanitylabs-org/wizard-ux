package ai.wizards.os.share;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * The backstop that finishes shares with Wizard OS closed: after a reboot (persisted job), a process death, a
 * long network outage or Android 15's dataSync limit. Android runs it when there is a network. The work is
 * {@link ShareUploader}'s; this keeps the process alive while it runs, posts the same progress notification, and
 * asks to be rescheduled if the share is still on its way after a few minutes. Plain JobScheduler, like
 * UpdateJob and MizelUploadJob: no WorkManager dependency.
 */
public class ShareJob extends JobService implements ShareUploader.Host {
    static final int JOB_ID = 0x53A1;
    private static final long MAX_RUN_MS = 8 * 60_000L;
    private final Handler main = new Handler(Looper.getMainLooper());
    private JobParameters params;

    public static void schedule(Context c) {
        try {
            JobScheduler js = c.getSystemService(JobScheduler.class);
            if (js == null || js.getPendingJob(JOB_ID) != null) return; // re-scheduling the same id would restart a running one
            js.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(c, ShareJob.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .setPersisted(true)
                    .build());
            Log.i(ShareUploader.TAG, "share job scheduled");
        } catch (RuntimeException e) { Log.w(ShareUploader.TAG, "could not schedule share job", e); }
    }

    /** After a reboot: a share was still on its way. */
    public static void scheduleIfPending(Context c) {
        try { if (ShareQueue.get(c).pending()) schedule(c); } catch (RuntimeException ignored) { }
    }

    @Override
    public boolean onStartJob(JobParameters p) {
        params = p;
        ShareUploader up = ShareUploader.get(this);
        if (!up.outstanding()) return false;
        Log.i(ShareUploader.TAG, "share job started");
        up.addHost(this);
        final long t0 = System.currentTimeMillis();
        main.postDelayed(new Runnable() {
            @Override public void run() {
                if (params == null) return;
                if (System.currentTimeMillis() - t0 > MAX_RUN_MS) {
                    Log.i(ShareUploader.TAG, "share job: still on its way, reschedule");
                    done(up.outstanding());
                    return;
                }
                main.postDelayed(this, 5000);
            }
        }, 5000);
        return true;
    }

    @Override public void idle() { main.post(() -> done(false)); }

    private void done(boolean again) {
        if (params == null) return;
        JobParameters p = params; params = null;
        main.removeCallbacksAndMessages(null);
        ShareUploader.get(this).removeHost(this);
        jobFinished(p, again);
    }

    @Override
    public boolean onStopJob(JobParameters p) {
        params = null;
        main.removeCallbacksAndMessages(null);
        ShareUploader up = ShareUploader.get(this);
        up.removeHost(this);
        return up.outstanding();
    }
}
