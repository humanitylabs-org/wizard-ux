package ai.wizards.os.notify;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Backstop for {@link AppNotify} after the app process was killed: one read of the Notifications app. */
public class AppNotifyJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try { AppNotify.pollOnce(getApplicationContext()); } finally { jobFinished(params, false); }
        }, "wizard-app-notify-job").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }
}
