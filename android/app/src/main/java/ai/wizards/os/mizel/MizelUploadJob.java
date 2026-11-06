package ai.wizards.os.mizel;

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
 * Finishes meeting uploads after the recorder has gone (Stop while offline, or a process death): Android runs this
 * when there is a network, even with Wizard OS closed. The work itself is MizelUploader's; this only keeps the
 * process alive until nothing is outstanding, and asks to be rescheduled if the server is still unreachable.
 */
public class MizelUploadJob extends JobService {
    static final int JOB_ID = 0x4d5a01;
    private static final long MAX_RUN_MS = 8 * 60_000L;
    private final Handler main = new Handler(Looper.getMainLooper());

    public static void schedule(Context c) {
        try {
            JobScheduler js = c.getSystemService(JobScheduler.class);
            if (js == null) return;
            // Scheduling the same id again cancels a pending/running job and starts over: never replace one.
            if (js.getPendingJob(JOB_ID) != null) return;
            JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, MizelUploadJob.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .setPersisted(true)
                    .build();
            js.schedule(job);
        } catch (RuntimeException e) { Log.w(MizelHub.TAG, "could not schedule upload job", e); }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Log.i(MizelHub.TAG, "upload job started");
        MeetingRecorderService.recover(this, false);
        MizelUploader up = MizelUploader.get(this);
        up.kick();
        final long t0 = System.currentTimeMillis();
        main.postDelayed(new Runnable() {
            int idle;
            @Override public void run() {
                if (!up.outstanding()) { Log.i(MizelHub.TAG, "upload job done"); jobFinished(params, false); return; }
                if (System.currentTimeMillis() - t0 > MAX_RUN_MS) { Log.i(MizelHub.TAG, "upload job: still outstanding, reschedule"); jobFinished(params, true); return; }
                up.kick();
                main.postDelayed(this, 2000);
            }
        }, 2000);
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        main.removeCallbacksAndMessages(null);
        return MizelUploader.get(this).outstanding();
    }
}
