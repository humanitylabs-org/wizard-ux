package ai.wizards.os.notify;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Backstop for ReplyWatcher after the app process was killed: one poll pass, then reschedule while runs remain. */
public class ReplyJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            ReplyWatcher.pollOnce(getApplicationContext());
            jobFinished(params, false);
            if (ReplyWatcher.count(getApplicationContext()) > 0) ReplyWatcher.scheduleJob(getApplicationContext());
        }, "wizard-reply-job").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }
}
