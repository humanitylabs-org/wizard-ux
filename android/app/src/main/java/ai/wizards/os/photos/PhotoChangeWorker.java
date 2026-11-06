package ai.wizards.os.photos;
import android.content.Context;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
public final class PhotoChangeWorker extends Worker {
    public PhotoChangeWorker(Context c,WorkerParameters p) { super(c,p); }
    @Override public Result doWork() {
        BackupSettings s=new BackupSettings(getApplicationContext());
        if(s.enabled()) {
            s.prefs.edit().putLong("last_content_trigger",System.currentTimeMillis()).commit();
            // Append successor before completing: KEEP would discard it while this watcher is running.
            BackupScheduler.watch(getApplicationContext(),true);
            BackupScheduler.enqueue(getApplicationContext());
        }
        return Result.success();
    }
}
