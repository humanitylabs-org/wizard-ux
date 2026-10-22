package ai.wizards.os.photos;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.InputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.locks.ReentrantLock;
import org.json.JSONObject;

public final class BackupWorker extends Worker {
    private static final ReentrantLock RUN=new ReentrantLock();
    private static final int NOTIFICATION=7301;
    private volatile ImmichClient client;
    private BackupSettings settings;
    private String generation;
    public BackupWorker(Context c,WorkerParameters p) { super(c,p); }
    private long envCheckedAt=0, foregroundAt=0;
    private void guard() throws IOException {
        if(isStopped() || !settings.enabled() || !generation.equals(settings.generation())) throw new IOException("Backup paused");
        // Network/power checks are system calls; read() calls guard() per buffer, so re-check at most every 2 s.
        long now=android.os.SystemClock.elapsedRealtime(); if(now-envCheckedAt<2000) return; envCheckedAt=now;
        if(!BackupScheduler.networkAllowed(getApplicationContext(),settings.wifi())) throw new IOException("Waiting for Wi-Fi / network");
        if(settings.initialCharging() && !BackupScheduler.charging(getApplicationContext())) throw new IOException("First backup waits for charging");
    }
    private ForegroundInfo foreground(int done,int total) {
        Context c=getApplicationContext(); NotificationManager nm=c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("photos-backup","Photos backup",NotificationManager.IMPORTANCE_LOW));
        // Opens Settings › Photos backup in the web shell (older web just opens Settings, whose Photos row opens the native screen).
        Intent page=new Intent(c,ai.wizards.os.MainActivity.class).setAction(ai.wizards.os.MainActivity.ACTION_SETTINGS)
                .putExtra(ai.wizards.os.MainActivity.EXTRA_SETTINGS_FOCUS,"photos-backup").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open=PendingIntent.getActivity(c,NOTIFICATION,page,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification n=new Notification.Builder(c,"photos-backup").setSmallIcon(android.R.drawable.stat_sys_upload)
                .setContentTitle("Photos backup").setContentText("Backed up "+done+" of "+total)
                .setProgress(Math.max(1,total),done,total==0).setOnlyAlertOnce(true).setOngoing(true).setContentIntent(open).build();
        return Build.VERSION.SDK_INT>=29 ? new ForegroundInfo(NOTIFICATION,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) : new ForegroundInfo(NOTIFICATION,n);
    }
    @Override public Result doWork() {
        if(!RUN.tryLock()) return Result.retry();
        settings=new BackupSettings(getApplicationContext()); generation=settings.generation();
        int done=0,uploaded=0,failed=0;
        try {
            if(!settings.enabled()) return Result.success();
            guard(); PhotoLibrary library=new PhotoLibrary(getApplicationContext());
            if(!library.readable() || (Build.VERSION.SDK_INT>=29 && !library.has(Manifest.permission.ACCESS_MEDIA_LOCATION))) {
                settings.status("Photo and original-location permissions needed · originals not uploaded"); return Result.failure();
            }
            JSONObject auth;
            try { auth=settings.secret("credentials"); }
            catch(Exception unavailable) { settings.status("Sign in again · secure backup key unavailable"); return Result.failure(); }
            if(!auth.has("key")) { settings.status("Sign in to enable backup"); return Result.failure(); }
            client=new ImmichClient(auth.getString("server"),auth.getString("key"),"",this::guard);
            setForegroundAsync(foreground(0,0)).get();
            settings.status("Checking selected albums…");
            List<PhotoLibrary.Item> items=library.list(true);
            settings.prefs.edit().putInt("total",items.size()).putInt("done",0).commit();
            try(BackupLedger ledger=new BackupLedger(getApplicationContext())) {
                String scope=settings.scope(auth);
                for(PhotoLibrary.Item item:items) {
                    envCheckedAt=0; guard(); // full network/power check before every item; only mid-file reads are throttled
                    try {
                        if(ledger.contains(scope,item.identity)) { done++; }
                        else {
                            String checksum;
                            try(InputStream in=new FilterInputStream(library.original(item)) {
                                @Override public int read(byte[] b,int off,int len) throws IOException { guard(); return super.read(b,off,len); }
                            }) { checksum=BackupPolicy.sha1(in); }
                            String asset=client.duplicate(item.identity,checksum);
                            if(asset.isEmpty()) { asset=client.upload(library,item,checksum); uploaded++; }
                            guard(); ledger.acknowledge(scope,item.identity,checksum,asset); done++;
                        }
                    } catch(SecurityException e) { throw e; }
                    catch(ImmichClient.HttpFailure e) { if(e.code==401 || e.code==403) throw e; failed++; }
                    catch(Exception e) { guard(); failed++; }
                    settings.prefs.edit().putInt("done",done).putInt("last_uploaded",uploaded).commit();
                    long t=android.os.SystemClock.elapsedRealtime();
                    if(t-foregroundAt>=1000 || done==items.size()) { foregroundAt=t; setForegroundAsync(foreground(done,items.size())).get(); }
                }
            }
            guard();
            if(failed>0) { settings.status(failed+" originals waiting · Retry (completed items kept)"); return Result.retry(); }
            boolean initial=settings.initialCharging();
            settings.prefs.edit().putLong("last_sync",System.currentTimeMillis()).putBoolean("initial_done",true)
                    .putInt("last_uploaded",uploaded).putString("status",library.limited()?"Selected photos only · allow all photos for full backup":"Up to date · originals preserved").commit();
            if(initial) BackupScheduler.schedule(getApplicationContext());
            return Result.success();
        } catch(SecurityException e) {
            settings.status("Permission changed · grant photo and original-location access, then Retry"); return Result.failure();
        } catch(ImmichClient.HttpFailure e) {
            settings.status(e.code==401 || e.code==403 ? "Sign in again · backup key unavailable or revoked" : "Photo server unavailable · Retry");
            return e.code==401 || e.code==403 ? Result.failure() : Result.retry();
        } catch(Exception e) {
            android.util.Log.w("WizardPhotos","backup run deferred: "+e);
            if(generation.equals(settings.generation())) settings.status("Backup waiting for network / charging or server · Retry");
            return isStopped()?Result.success():Result.retry();
        } finally { client=null; RUN.unlock(); }
    }
    @Override public void onStopped() { ImmichClient c=client; if(c!=null) c.cancel(); super.onStopped(); }
}
