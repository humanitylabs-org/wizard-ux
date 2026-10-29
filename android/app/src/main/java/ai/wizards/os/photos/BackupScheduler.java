package ai.wizards.os.photos;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.provider.MediaStore;
import androidx.work.*;
import java.util.concurrent.TimeUnit;

public final class BackupScheduler {
    private BackupScheduler() {}
    static final String TAG="photos-backup", PERIOD="photos-period", WATCH="photos-watch", NOW="photos-now";
    static Constraints constraints(BackupSettings s,boolean watch) {
        // The watcher only notices new media; the backup run it enqueues carries the network/charging rules.
        // Keeping network off the watcher means a photo taken offline still wakes the app once seen.
        Constraints.Builder b=new Constraints.Builder();
        if(!watch) b.setRequiredNetworkType(s.wifi()?NetworkType.UNMETERED:NetworkType.CONNECTED).setRequiresCharging(s.initialCharging());
        if(watch) b.addContentUriTrigger(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,true)
                .addContentUriTrigger(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,true)
                .setTriggerContentUpdateDelay(15,TimeUnit.SECONDS).setTriggerContentMaxDelay(60,TimeUnit.SECONDS);
        return b.build();
    }
    public static void schedule(Context c) {
        BackupSettings s=new BackupSettings(c); if(!s.enabled()) { cancel(c); return; }
        WorkManager wm=WorkManager.getInstance(c);
        wm.enqueueUniquePeriodicWork(PERIOD,ExistingPeriodicWorkPolicy.UPDATE,new PeriodicWorkRequest.Builder(BackupWorker.class,15,TimeUnit.MINUTES)
                .setConstraints(constraints(s,false)).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).addTag(TAG).build());
        watch(c,false);
    }
    static void watch(Context c,boolean successor) {
        BackupSettings s=new BackupSettings(c); if(!s.enabled()) return;
        WorkManager.getInstance(c).enqueueUniqueWork(WATCH,successor?ExistingWorkPolicy.APPEND_OR_REPLACE:ExistingWorkPolicy.REPLACE,
                new OneTimeWorkRequest.Builder(PhotoChangeWorker.class).setConstraints(constraints(s,true)).addTag(TAG).build());
    }
    public static void enqueue(Context c) {
        BackupSettings s=new BackupSettings(c); if(!s.enabled()) return;
        WorkManager.getInstance(c).enqueueUniqueWork(NOW,ExistingWorkPolicy.APPEND_OR_REPLACE,new OneTimeWorkRequest.Builder(BackupWorker.class)
                .setConstraints(constraints(s,false)).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).addTag(TAG).build());
    }
    public static void cancel(Context c) { WorkManager.getInstance(c).cancelAllWorkByTag(TAG); }
    public static boolean networkAllowed(Context c,boolean wifi) {
        ConnectivityManager cm=c.getSystemService(ConnectivityManager.class);
        NetworkCapabilities active=cm.getNetworkCapabilities(cm.getActiveNetwork());
        if(active==null || !active.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false;
        if(!wifi) return true;
        if(!active.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) return false;
        if(active.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return true;
        // A tailnet VPN can be the active transport; require an actual unmetered Wi-Fi underlay.
        if(active.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) for(Network n:cm.getAllNetworks()) {
            NetworkCapabilities nc=cm.getNetworkCapabilities(n);
            if(nc!=null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)) return true;
        }
        return false;
    }
    /** Plugged in counts: phones at 100% or in battery-protection mode report "not charging" while on power. */
    public static boolean charging(Context c) {
        android.content.Intent b=c.registerReceiver(null,new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
        if(b!=null && b.getIntExtra(BatteryManager.EXTRA_PLUGGED,0)!=0) return true;
        return c.getSystemService(BatteryManager.class).isCharging();
    }
}
