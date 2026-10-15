package ai.wizards.os.share;

import android.app.Notification;
import android.app.Service;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import java.util.List;

/**
 * Keeps the share uploader alive while it works, as a foreground service of type dataSync with a progress
 * notification ("N files → Agent"). Started only from something on screen (the share sheet, or Wizard OS opening
 * with shares still queued), which Android allows on every version.
 *
 * Why dataSync and not a user-initiated data transfer job: this is a sideloaded app with minSdk 28, the job API is
 * 34+ only and must be scheduled from the foreground with RUN_USER_INITIATED_JOBS; dataSync works the same on all
 * supported versions and Play policy (which prefers UIDT on 34+) does not bind a sideloaded build. Android 15's
 * 6-hour dataSync budget and its boot-time restriction are covered by {@link ShareJob}: {@link #onTimeout} and
 * BOOT_COMPLETED hand over to the job, which resumes from the Wizard's offset.
 *
 * The read grant for what was shared: the sheet passes the content URIs here as ClipData with
 * FLAG_GRANT_READ_URI_PERMISSION, so Android ties the grant to this start (START_REDELIVER_INTENT keeps it until
 * stopSelf) rather than to the sheet, which closes the moment James taps Send. The copy finishes before the
 * service may stop.
 */
public class ShareService extends Service implements ShareUploader.Host {
    static final String TAG = ShareUploader.TAG;
    static final String ACTION_SEND = "ai.wizards.os.share.SEND", EXTRA_ID = "ai.wizards.os.share.ID";
    /** Waiting this long for a network/Wizard: stop the service, leave it to the job (needs a network to run). */
    static final long HAND_TO_JOB_MS = 10 * 60_000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private int lastStart;
    private ShareUploader up;
    private boolean stopping;

    /** From the sheet: queue item {@code id} already saved; {@code uris} carry the read grant to this service. */
    static void send(Context c, String id, List<Uri> uris) {
        Intent i = new Intent(c, ShareService.class).setAction(ACTION_SEND).putExtra(EXTRA_ID, id);
        if (!uris.isEmpty()) {
            ClipData clip = ClipData.newRawUri("shared", uris.get(0));
            for (int k = 1; k < uris.size(); k++) clip.addItem(new ClipData.Item(uris.get(k)));
            i.setClipData(clip);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        start(c, i);
    }

    /** Wizard OS came to the front with shares still queued (e.g. after a force-stop): carry on now. */
    public static void resumeIfPending(Context c) {
        try {
            ShareQueue q = ShareQueue.get(c);
            q.prune(System.currentTimeMillis());
            if (q.pending()) start(c, new Intent(c, ShareService.class));
        } catch (RuntimeException e) { Log.w(TAG, "resume: " + e); }
    }

    private static void start(Context c, Intent i) {
        try { c.startForegroundService(i); }
        catch (RuntimeException e) { // ForegroundServiceStartNotAllowedException (API 31+) and friends
            Log.w(TAG, "foreground start refused, job takes over: " + e);
            ShareJob.schedule(c);
            ShareUploader.get(c).kick();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        lastStart = startId;
        stopping = false;
        Notification n = ShareNotifier.progress(this, ShareQueue.get(this).next(), "uploading", 0, 0);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ShareNotifier.FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ShareNotifier.FG_ID, n);
        } catch (RuntimeException e) {
            // A system restart after a process death may not be allowed back into the foreground: the job backs us up.
            Log.w(TAG, "startForeground: " + e);
            ShareJob.schedule(this);
        }
        if (up == null) { up = ShareUploader.get(this); up.addHost(this); }
        else up.kick();
        Log.i(TAG, "service start #" + startId + (intent != null && ACTION_SEND.equals(intent.getAction()) ? " send " + intent.getStringExtra(EXTRA_ID) : " resume"));
        main.removeCallbacks(watch);
        main.postDelayed(watch, 30_000);
        return START_REDELIVER_INTENT;
    }

    /** Long outage: let JobScheduler bring the work back when there is a network (copies are done by then). */
    private final Runnable watch = new Runnable() {
        @Override public void run() {
            if (up == null || stopping) return;
            long since = up.retryingSince();
            if (since > 0 && !up.copying() && System.currentTimeMillis() - since > HAND_TO_JOB_MS) {
                Log.i(TAG, "waiting " + (System.currentTimeMillis() - since) / 1000 + " s: handing over to the job");
                ShareJob.schedule(ShareService.this);
                finish();
                return;
            }
            main.postDelayed(this, 30_000);
        }
    };

    @Override public void idle() { main.post(this::finish); }

    private void finish() {
        if (stopping) return;
        if (up != null && up.outstanding() && up.copying()) return; // never drop the read grant mid-copy
        stopping = true;
        main.removeCallbacks(watch);
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (up != null && up.outstanding()) ShareJob.schedule(this);
        stopSelf(lastStart);
    }

    /** Android 15+: the dataSync budget ran out. The job resumes from the Wizard's offset. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        Log.i(TAG, "dataSync time limit reached: handing over to the job");
        ShareJob.schedule(this);
        finish();
    }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (up != null) { up.removeHost(this); if (up.outstanding()) ShareJob.schedule(this); }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
