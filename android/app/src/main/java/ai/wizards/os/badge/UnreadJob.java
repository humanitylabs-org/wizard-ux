package ai.wizards.os.badge;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Periodic backstop for the unread badge after the app process was killed. */
public class UnreadJob extends JobService {
    @Override public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try { UnreadBadges.pollNow(getApplicationContext()); } finally { jobFinished(params, false); }
        }, "wizard-unread-job").start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}
