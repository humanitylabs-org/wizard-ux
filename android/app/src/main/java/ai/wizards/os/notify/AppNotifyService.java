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
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import ai.wizards.os.MainActivity;
import ai.wizards.os.device.AppState;
import ai.wizards.os.device.Http;

/**
 * Instant notifications from the owner's Wizard without Google: ONE long-lived connection to the box's Notifications
 * router (Server-Sent Events over Tailscale), like Signal or ntfy without FCM. A foreground service with a silent,
 * minimised "connected" notification keeps it alive; it reconnects with backoff (and at once when the network
 * changes, e.g. Tailscale coming back after Proton VPN), and resumes from the last event id, so nothing sent while the
 * phone was unreachable is lost. {@link AppNotifyJob} is the backstop if Android stops the service.
 *
 * Runs only when the selected Wizard's Notifications app has the phone router (GET /notifications/api/phone) and
 * Wizard OS may post notifications. Which apps reach the phone is the owner's choice on the box (Chats only).
 */
public final class AppNotifyService extends Service {
    static final String TAG = AppNotifications.TAG;
    static final String CH_CONN = "wizard-connection";
    static final int N_CONN = 7601;
    static final String ACTION_RECHECK = "ai.wizards.os.notify.RECHECK";
    public static final int REQ_PERMISSION = 7603;
    private static volatile boolean running;
    /** The Wizard the open stream belongs to ("" while not connected). */
    private static volatile String connectedTo = "";
    private volatile boolean stop;
    private volatile HttpURLConnection live;
    private Thread worker;
    private final Object nap = new Object();
    private ConnectivityManager.NetworkCallback netCallback;
    private String shownState = "";

    static SharedPreferences prefs(Context c) { return AppNotifications.prefs(c); }

    public static boolean running() { return running; }

    /** See {@link #ensure(Context, android.app.Activity)}; never asks for the notification permission. */
    public static void ensure(Context context) { ensure(context, null); }

    /**
     * Start (or keep) the connection if this Wizard supports it. Cheap; call it whenever Wizard OS comes to the front,
     * after boot and from the backstop job. Network work happens off the calling thread. With an activity, asks once
     * for Android's notification permission when this Wizard has the phone router and it is missing.
     */
    public static void ensure(Context context, android.app.Activity askFrom) {
        final Context c = context.getApplicationContext();
        final String origin = AppState.origin(c);
        if (origin == null || origin.isEmpty()) return;
        if (running) {
            // Connect switched Wizards: drop the old stream now (its pings would keep it open forever).
            if (!origin.equals(connectedTo)) recheck(c);
            return;
        }
        if (prefs(c).getBoolean("supported:" + origin, false)) { startOrAsk(c, askFrom); return; }
        if (System.currentTimeMillis() - prefs(c).getLong("probed:" + origin, 0) < 6 * 3600_000L) return;
        new Thread(() -> {
            boolean ok;
            try {
                ok = Http.json("GET", origin + AppNotifyPolicy.PROBE_PATH, origin, null, null).optInt("phone") == 1;
            } catch (Http.Error e) {
                if (e.status == 0) return;          // not reachable now (Tailscale off): ask again next time
                ok = false;                         // a Wizard without the phone router (yet)
            } catch (IOException e) { return; }
            prefs(c).edit().putBoolean("supported:" + origin, ok).putLong("probed:" + origin, System.currentTimeMillis()).apply();
            Log.i(TAG, "phone router on this Wizard: " + ok);
            if (ok) startOrAsk(c, askFrom);
        }, "wizard-app-notify-probe").start();
    }

    private static void startOrAsk(Context c, android.app.Activity askFrom) {
        if (AppNotifications.canNotify(c)) { start(c); return; }
        // Android 13+: notifications start denied. Ask once, from Wizard OS on screen; the next resume starts it.
        if (askFrom == null || Build.VERSION.SDK_INT < 33 || prefs(c).getBoolean("asked-permission", false)) return;
        prefs(c).edit().putBoolean("asked-permission", true).apply();
        askFrom.runOnUiThread(() -> {
            if (!askFrom.isFinishing() && !askFrom.isDestroyed())
                askFrom.requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, REQ_PERMISSION);
        });
    }

    private static void recheck(Context c) {
        try { c.startService(new Intent(c, AppNotifyService.class).setAction(ACTION_RECHECK)); }
        catch (RuntimeException e) { Log.w(TAG, "recheck: " + e.getMessage()); }
    }

    static void start(Context c) {
        try { c.startForegroundService(new Intent(c, AppNotifyService.class)); }
        catch (RuntimeException e) { Log.w(TAG, "could not start: " + e.getMessage()); }   // background start refused: the job catches up
        AppNotifyJob.schedule(c);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        running = true;
        foreground("Connecting to your Wizard\u2026");
        netCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) { poke(); }
            @Override public void onLost(Network n) { poke(); }
        };
        try { getSystemService(ConnectivityManager.class).registerDefaultNetworkCallback(netCallback); }
        catch (RuntimeException e) { netCallback = null; }
        worker = new Thread(this::loop, "wizard-app-notify");
        worker.start();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        foreground(shownState.isEmpty() ? "Connecting to your Wizard\u2026" : shownState);
        if (intent != null && ACTION_RECHECK.equals(intent.getAction())) poke();
        return START_STICKY;
    }

    @Override public void onDestroy() {
        stop = true;
        running = false;
        poke();
        connectedTo = "";
        if (netCallback != null) try { getSystemService(ConnectivityManager.class).unregisterNetworkCallback(netCallback); } catch (RuntimeException ignored) { }
        super.onDestroy();
    }

    /** Network changed: drop a connection that may be dead and try again now instead of after the backoff. */
    private void poke() {
        HttpURLConnection c = live;
        if (c != null) new Thread(c::disconnect).start();
        synchronized (nap) { nap.notifyAll(); }
    }

    private void loop() {
        int attempt = 0;
        while (!stop) {
            String origin = AppState.origin(this);
            if (origin == null || origin.isEmpty() || !AppNotifications.canNotify(this)) break;
            long opened = System.currentTimeMillis();
            int status = connect(origin);
            if (stop) break;
            if (status == 403 || status == 404) {
                // This Wizard refuses this phone (owner pin) or lost the router: stop; the next app open probes again.
                prefs(this).edit().putBoolean("supported:" + origin, false).putLong("probed:" + origin, System.currentTimeMillis()).apply();
                Log.i(TAG, "router answered " + status + "; stopping");
                break;
            }
            attempt = System.currentTimeMillis() - opened > 60_000 ? 0 : attempt + 1;
            long wait = AppNotifyPolicy.backoff(attempt);
            foreground("Waiting for your Wizard \u00b7 is Tailscale on?");
            synchronized (nap) { try { nap.wait(wait); } catch (InterruptedException e) { break; } }
        }
        stopSelf();
    }

    /** One connection: returns the HTTP status, or 0 when the network failed or the stream ended. */
    private int connect(String origin) {
        if (AppNotifications.appsStale(this, origin)) AppNotifications.refreshApps(this, origin);
        long since = AppNotifications.last(this, origin);
        String sid = AppNotifications.sid(this, origin);
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(AppNotifyPolicy.streamUrl(origin, since, sid)).openConnection();
            c.setConnectTimeout(15_000);
            c.setReadTimeout(AppNotifyPolicy.READ_TIMEOUT_MS);
            c.setRequestProperty("Accept", "text/event-stream");
            c.setRequestProperty("Origin", origin);
            c.setUseCaches(false);
            live = c;
            connectedTo = origin;
            int code = c.getResponseCode();
            if (code != 200) return code;
            BufferedReader in = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8), 8192);
            AppNotifyPolicy.Sse sse = new AppNotifyPolicy.Sse();
            String line;
            while (!stop && (line = in.readLine()) != null) {
                AppNotifyPolicy.Sse.Event e = sse.line(line);
                if (e == null) continue;
                dispatch(origin, e);
            }
            return 0;
        } catch (IOException e) {
            Log.i(TAG, "stream: " + e.getMessage());
            return 0;
        } finally {
            live = null;
            connectedTo = "";
            if (c != null) c.disconnect();
        }
    }

    private void dispatch(String origin, AppNotifyPolicy.Sse.Event e) {
        // The owner switched Wizards mid-stream: nothing from the old one may show (or be answered to the new one).
        if (!origin.equals(AppState.origin(this))) { poke(); return; }
        JSONObject ev;
        try { ev = new JSONObject(e.data); } catch (JSONException bad) { return; }
        PowerManager.WakeLock wl = null;
        try {
            PowerManager pm = getSystemService(PowerManager.class);
            wl = pm == null ? null : pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wizard:app-notify");
            if (wl != null) wl.acquire(10_000);
            if ("hello".equals(e.type)) {
                String sid = ev.optString("sid");
                if (!sid.equals(AppNotifications.sid(this, origin))) AppNotifications.cursor(this, origin, sid, -1);
                foreground("Connected \u00b7 instant notifications from your Wizard");
                return;
            }
            AppNotifications.handle(this, origin, e.type, ev);
            if (e.id != null) {
                try { AppNotifications.cursor(this, origin, AppNotifications.sid(this, origin), Long.parseLong(e.id)); }
                catch (NumberFormatException ignored) { }
            }
        } finally {
            if (wl != null && wl.isHeld()) wl.release();
        }
    }

    // ---- the quiet "connected" notification Android requires for a foreground service ----

    private void foreground(String text) {
        shownState = text;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_CONN) == null) {
            NotificationChannel ch = new NotificationChannel(CH_CONN, "Connection to your Wizard", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Keeps one private connection to your Wizard over Tailscale so app notifications arrive at once, without Google.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent open = PendingIntent.getActivity(this, N_CONN, new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(this, CH_CONN)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setContentTitle("Wizard notifications")
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_SERVICE);
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            // Doze would cut the connection for hours; one tap lets it stay (Android's own dialog).
            Intent ask = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
            b.addAction(new Notification.Action.Builder(null, "Stay connected while idle",
                    PendingIntent.getActivity(this, N_CONN + 1, ask, PendingIntent.FLAG_IMMUTABLE)).build());
        }
        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(N_CONN, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(N_CONN, n);
        } catch (RuntimeException e) {
            Log.w(TAG, "foreground refused: " + e.getMessage());
            stop = true;
            stopSelf();
        }
    }
}
