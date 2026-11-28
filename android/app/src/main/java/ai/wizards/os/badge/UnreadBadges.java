package ai.wizards.os.badge;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;

import ai.wizards.os.HomeScreenShortcuts;
import ai.wizards.os.device.AppState;

/**
 * Unread count for the Messenger home-screen icon (James, 8 Nov). One poll feeds three independent mechanisms:
 * the pinned shortcut's icon with a red bubble (primary), a silent "Unread" notification that Pixel/AOSP launchers
 * and the Wizard app icon dot show (secondary), and an opt-in 1x1 widget (fallback). Drivers: an in-process loop
 * while something that may run in the background holds it (the Everywhere foreground service) or the app is on
 * screen, plus a JobScheduler periodic backstop. Android notification badges are per package and cannot target a
 * shortcut, which is why the icon itself is redrawn.
 */
public final class UnreadBadges {
    static final String TAG = "WizardUnread";
    /** The Messenger app's registered id (identity hash of box origin + this id names the pinned shortcut). */
    public static final String APP_ID = "messenger";
    static final int JOB_ID = 7402;
    static final long LOOP_MS = 45_000L;
    private static final String PREFS = "unread-badge";

    private static final Object LOCK = new Object();
    private static final Object POLL = new Object();
    private static long started, appliedSeq; // guarded by POLL
    private static final Set<Object> holders = Collections.newSetFromMap(new IdentityHashMap<>());
    private static Handler loop;
    private static Runnable tick;

    private UnreadBadges() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** Latest count we learned (0 when never fetched); the icon builders use it so a page refresh never wipes the bubble. */
    public static int storedCount(Context c, String appId) {
        if (!APP_ID.equals(appId)) return 0;
        return Math.max(0, prefs(c).getInt("count", 0));
    }

    static final class PrefsStore implements BadgeSync.Store {
        private final SharedPreferences p;
        PrefsStore(SharedPreferences p) { this.p = p; }
        @Override public int applied(String m) { return p.getInt("applied." + m, BadgeSync.NONE); }
        @Override public void setApplied(String m, int n) { p.edit().putInt("applied." + m, n).apply(); }
    }

    static List<BadgeSync.Mechanism> mechanisms(Context c) {
        List<BadgeSync.Mechanism> all = new ArrayList<>();
        all.add(new ShortcutBadge(c));      // 1 primary
        all.add(new UnreadNotification(c)); // 2 secondary
        all.add(new WidgetBadge(c));        // 3 fallback (no-op without a placed widget)
        return all;
    }

    /** Anything on the home screen to badge? Worker thread (queries ShortcutManager). */
    static boolean wanted(Context c) {
        try { if (HomeScreenShortcuts.pinned(c, APP_ID)) return true; } catch (RuntimeException e) { Log.w(TAG, "pinned: " + e); }
        try {
            AppWidgetManager w = c.getSystemService(AppWidgetManager.class);
            return w != null && w.getAppWidgetIds(new ComponentName(c, UnreadWidget.class)).length > 0;
        } catch (RuntimeException e) { return false; }
    }

    /** One pass: fetch, then offer the newest known count to each mechanism. Blocking; call off the main thread. */
    public static void pollNow(Context context) {
        Context c = context.getApplicationContext();
        if (!wanted(c)) { synchronized (POLL) { forget(c); } cancelJob(c); return; }
        scheduleJob(c); // a target pinned after the app started still gets the background backstop (no-op when pending)
        long seq; String origin;
        synchronized (POLL) { seq = ++started; origin = AppState.origin(c); }
        int fetched = UnreadSource.fetch(origin); // network, outside the lock: reset() never waits on it
        // Everything that shows a count happens under POLL, the same lock reset() and forget() take, and only for the
        // newest poll of the Wizard that is still current. A slow or old-Wizard result is dropped, never applied.
        synchronized (POLL) {
            if (!java.util.Objects.equals(origin, AppState.origin(c)) || seq < appliedSeq) return;
            appliedSeq = seq;
            if (!wanted(c)) { forget(c); return; }
            SharedPreferences p = prefs(c);
            if (fetched >= 0) p.edit().putInt("count", fetched).apply();
            // A failed fetch (offline, 5xx) leaves the badge alone but still retries earlier deferrals.
            int desired = fetched >= 0 ? fetched : (p.contains("count") ? p.getInt("count", 0) : -1);
            int ok = BadgeSync.syncAll(new PrefsStore(p), mechanisms(c), desired);
            Log.i(TAG, "poll fetched=" + fetched + " desired=" + desired + " inSync=" + ok);
        }
    }

    /** Feed a count without the network (debug/QA entry and tests); same coalescing path as a poll. */
    public static int applyCount(Context context, int count) {
        Context c = context.getApplicationContext();
        synchronized (POLL) {
            SharedPreferences p = prefs(c);
            p.edit().putInt("count", Math.max(0, count)).apply();
            return BadgeSync.syncAll(new PrefsStore(p), mechanisms(c), BadgeText.clamp(count));
        }
    }

    /**
     * The badge look changed (wizard-ux issue 1669, BadgeLook.upgrade): redraw every mechanism with the
     * newest known count. The count is unchanged, so the applied marks are dropped first or the sync would skip it.
     * No network; off the caller's thread (shortcut and widget IPC).
     */
    static void restyle(Context context) {
        Context c = context.getApplicationContext();
        new Thread(() -> {
            try {
                synchronized (POLL) {
                    SharedPreferences p = prefs(c);
                    SharedPreferences.Editor e = p.edit();
                    for (String k : p.getAll().keySet()) if (k.startsWith("applied.")) e.remove(k);
                    e.apply();
                    if (!p.contains("count") || !wanted(c)) return;
                    int ok = BadgeSync.syncAll(new PrefsStore(p), mechanisms(c), p.getInt("count", 0));
                    Log.i(TAG, "restyle inSync=" + ok);
                }
            } catch (RuntimeException e) { Log.w(TAG, "restyle: " + e); }
        }, "wizard-unread-restyle").start();
    }

    /** The app is on screen or the Everywhere service lives: keep a light in-process poll going. */
    public static void hold(Context context, Object owner, boolean on) {
        Context c = context.getApplicationContext();
        synchronized (LOCK) {
            if (on) holders.add(owner); else holders.remove(owner);
            if (holders.isEmpty()) {
                if (loop != null) loop.removeCallbacksAndMessages(null);
                return;
            }
            if (loop == null) {
                HandlerThread t = new HandlerThread("wizard-unread");
                t.start();
                loop = new Handler(t.getLooper());
            }
            if (tick == null) tick = new Runnable() {
                @Override public void run() {
                    try {
                        PowerManager pm = c.getSystemService(PowerManager.class);
                        if (pm == null || pm.isInteractive()) pollNow(c);
                    } catch (RuntimeException e) { Log.w(TAG, "tick: " + e); }
                    synchronized (LOCK) { if (!holders.isEmpty()) loop.postDelayed(this, LOOP_MS); }
                }
            };
            loop.removeCallbacks(tick);
            loop.post(tick);
        }
        if (on) scheduleJob(c);
    }

    static void scheduleJob(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(JOB_ID) != null) return;
        JobInfo j = new JobInfo.Builder(JOB_ID, new ComponentName(c, UnreadJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60_000L)
                .setPersisted(true)
                .build();
        try { js.schedule(j); } catch (RuntimeException e) { Log.w(TAG, "job: " + e); }
    }

    static void cancelJob(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js != null) js.cancel(JOB_ID);
    }

    /** Nothing left on the home screen: drop the tray count and its launcher dot, and start clean on a new pin. */
    static void forget(Context c) {
        SharedPreferences p = prefs(c);
        if (p.getAll().isEmpty()) return;
        android.app.NotificationManager nm = c.getSystemService(android.app.NotificationManager.class);
        if (nm != null) nm.cancel(UnreadNotification.ID);
        p.edit().clear().apply();
    }

    /**
     * Wizard address changed (called after the new address is saved): forget the old box's count, clear the tray
     * note, redraw a placed widget plain with the new tap target, and take the bubble off the old Wizard's pinned
     * shortcut, which later polls no longer look at. No network, so the caller never waits on a fetch.
     */
    public static void reset(Context context, String oldOrigin) {
        Context c = context.getApplicationContext();
        prefs(c).edit().clear().apply();
        // Shortcut and widget IPC stays off the caller's (possibly UI) thread.
        new Thread(() -> { synchronized (POLL) { clearAfterSwitch(c, oldOrigin); } }, "wizard-unread-reset").start();
    }

    private static void clearAfterSwitch(Context c, String oldOrigin) {
        prefs(c).edit().clear().apply();
        android.app.NotificationManager nm = c.getSystemService(android.app.NotificationManager.class);
        if (nm != null) nm.cancel(UnreadNotification.ID);
        try { new WidgetBadge(c).apply(0); } catch (RuntimeException e) { Log.w(TAG, "widget reset: " + e); }
        if (oldOrigin != null && !oldOrigin.isEmpty() && !oldOrigin.equals(HomeScreenShortcuts.origin(c))) {
            try { ShortcutBadge.draw(c, oldOrigin, 0); } catch (RuntimeException e) { Log.w(TAG, "old shortcut reset: " + e); }
        }
    }

    @SuppressWarnings("unused") static boolean frontForTests() { return AppState.front(); }
}
