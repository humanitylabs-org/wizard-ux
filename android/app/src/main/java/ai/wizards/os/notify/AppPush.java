package ai.wizards.os.notify;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import java.net.HttpURLConnection;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import ai.wizards.os.MainActivity;
import ai.wizards.os.device.AppState;

/**
 * Box-to-phone push for app notifications (wizard-ux issue 1618, switch wizard/phone-push, off by default).
 *
 * {@link AppNotify} reads the Notifications app every 30 s while this app's process lives and every 15 minutes after
 * that (a JobScheduler job Doze defers further), so a locked phone could see an item up to ~15 minutes late. With
 * this switch on (and Phone notifications per app on), a small foreground service keeps one connection to the box's
 * Notifications app open over the owner's Tailscale ({@link AppPushPolicy}: nothing goes through Google), and each
 * hello / new-item ping runs the same reader once. A foreground service keeps its network while the phone dozes;
 * Android requires it to show a notification, which goes on its own silent, minimised channel the owner can hide.
 *
 * Off (the default): no service, no connection, no notification; switching it off stops all of it at once.
 */
public final class AppPush {
    static final String TAG = "WizardAppPush";
    static final String CH = "wizard-push";
    static final int FG_ID = 7404;
    private static final String PREFS = "app-push";

    private AppPush() {}

    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** The shell's switch wizard/phone-push, as the main page last copied it. */
    public static boolean switchOn(Context c) { return prefs(c).getBoolean("on", false); }

    /** Push runs only on top of Phone notifications per app: it only makes that reader read sooner. */
    public static boolean wanted(Context c) { return switchOn(c) && AppNotify.on(c) && AppNotify.canNotify(c); }

    /** The line to the box is up (its hello came): each new item is read at once, so the 30 s reads can rest. */
    public static boolean listening() { return AppPushService.running && AppPushService.connected; }

    /** From the main page (WizardOSNative.appPushSwitch). */
    public static void setOn(Context c, boolean on) {
        boolean was = switchOn(c);
        prefs(c).edit().putBoolean("on", on).apply();
        if (was != on) Log.i(TAG, "switch " + (on ? "on" : "off"));
        ensure(c);
    }

    /** Start the service when it is wanted, stop it when not. Safe to call any time (boot, update, job, page). */
    public static void ensure(Context c) {
        Context app = c.getApplicationContext();
        if (wanted(app)) {
            try { app.startForegroundService(new Intent(app, AppPushService.class)); }
            catch (RuntimeException e) { Log.w(TAG, "start: " + e); } // Android refuses a start from the background: next boot / open
        } else if (AppPushService.running) {
            try { app.stopService(new Intent(app, AppPushService.class)); } catch (RuntimeException ignored) { }
        }
    }

    static Notification ongoing(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH) == null) {
            NotificationChannel ch = new NotificationChannel(CH, "Instant app notifications", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Keeps this phone listening to your Wizard, so app notifications arrive at once. You can hide this one.");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, FG_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(c, CH)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("Ready for app notifications")
                .setContentText("Your Wizard tells this phone the moment something arrives.")
                .setContentIntent(pi)
                .setOngoing(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    /** The foreground service holding the one connection. */
    public static class AppPushService extends Service {
        static volatile boolean running, connected;
        private final Object lock = new Object();
        private final AtomicBoolean pending = new AtomicBoolean();
        private ExecutorService reads;
        private Thread loop;
        private volatile boolean stopped;
        private volatile HttpURLConnection open;
        private ConnectivityManager.NetworkCallback net;

        @Override public IBinder onBind(Intent i) { return null; }

        @Override
        public int onStartCommand(Intent intent, int flags, int startId) {
            try {
                Notification n = ongoing(this);
                if (Build.VERSION.SDK_INT >= 34) startForeground(FG_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                else startForeground(FG_ID, n);
            } catch (RuntimeException e) {
                Log.w(TAG, "startForeground: " + e);
                stopSelf();
                return START_NOT_STICKY;
            }
            if (!wanted(this)) { stopSelf(); return START_NOT_STICKY; }
            running = true;
            if (loop == null || !loop.isAlive()) start();
            return START_STICKY;
        }

        private void start() {
            stopped = false;
            if (reads == null) reads = Executors.newSingleThreadExecutor();
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            if (cm != null && net == null) {
                net = new ConnectivityManager.NetworkCallback() {
                    @Override public void onAvailable(Network n) { wake(); } // back online: reconnect now, not after the backoff
                };
                try { cm.registerDefaultNetworkCallback(net); } catch (RuntimeException e) { net = null; }
            }
            loop = new Thread(this::listenLoop, "wizard-app-push");
            loop.start();
        }

        private void wake() { synchronized (lock) { lock.notifyAll(); } }

        private void pause(long ms) {
            synchronized (lock) {
                if (stopped) return;
                try { lock.wait(ms); } catch (InterruptedException ignored) { }
            }
        }

        private void listenLoop() {
            int attempt = 0;
            final Context c = getApplicationContext();
            AppPushPolicy.Keep keep = new AppPushPolicy.Keep() {
                @Override public boolean on() { return !stopped && wanted(c); }
                @Override public void opened(HttpURLConnection h) { open = h; }
            };
            while (keep.on()) {
                String origin = AppState.origin(c);
                long t0 = System.currentTimeMillis();
                try {
                    AppPushPolicy.listen(AppPushPolicy.url(origin), keep, this::read, "Origin", origin);
                } catch (AppPushPolicy.Ended e) {
                    if (!keep.on()) break;
                    long held = System.currentTimeMillis() - t0;
                    if (held > 60_000L) attempt = 0; // it worked for a while: this is a fresh drop, retry soon
                    long wait = e.status == 404 ? AppPushPolicy.MISSING_RETRY_MS : AppPushPolicy.backoffMs(attempt++);
                    // Anything published while the line was down is read on the next hello.
                    Log.i(TAG, "line down (" + e.getMessage() + "), again in " + wait / 1000 + " s");
                    pause(wait);
                } finally {
                    open = null;
                    connected = false;
                }
            }
            if (!stopped) stopSelf();
        }

        /** One read of Notifications, off the line's thread; reads asked for meanwhile fold into one more. */
        private void read(String why) {
            if ("hello".equals(why)) connected = true;
            if (!pending.compareAndSet(false, true)) return;
            final Context c = getApplicationContext();
            PowerManager pm = getSystemService(PowerManager.class);
            final PowerManager.WakeLock wl = pm == null ? null : pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wizard:app-push");
            if (wl != null) wl.acquire(45_000L); // the phone may be dozing: stay awake for the one read
            try {
                reads.execute(() -> {
                    pending.set(false);
                    try { AppNotify.pollOnce(c); }
                    catch (RuntimeException e) { Log.w(TAG, "read: " + e); }
                    finally { if (wl != null && wl.isHeld()) wl.release(); }
                });
            } catch (RuntimeException e) {
                pending.set(false);
                if (wl != null && wl.isHeld()) wl.release();
            }
        }

        @Override
        public void onDestroy() {
            running = false;
            connected = false;
            stopped = true;
            HttpURLConnection h = open;
            if (h != null) new Thread(h::disconnect, "wizard-app-push-stop").start(); // unblocks the line's read at once
            wake();
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            if (cm != null && net != null) try { cm.unregisterNetworkCallback(net); } catch (RuntimeException ignored) { }
            net = null;
            if (reads != null) reads.shutdown();
            super.onDestroy();
        }
    }
}
