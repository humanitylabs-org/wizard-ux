package ai.wizards.os;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.util.Log;

/**
 * Recovery mode on the phone (wizard-ux issue 1775, switch wizard/phone-recovery-mode, off by default). Keeps the start
 * record ({@link StartPolicy}) in prefs "start-guard" and this process's answer: does this start run in recovery mode
 * (the shell only, the meeting recorder and uploads paused) until the owner taps Start normally?
 *
 * The switch lives in the shell (look.json); the main page copies it here (WizardOSNative.recoveryModeSwitch), because
 * the decision is taken before any page loads. With the switch off nothing is recorded and nothing is paused.
 */
public final class StartGuard {
    static final String TAG = "WizardRecovery";
    private static final String SWITCH = "recovery-mode", STATE = "start-guard";
    private static boolean began;
    private static volatile boolean recovering;
    private static long beganUptime, resumedUptime;
    private static String why = "";

    private StartGuard() {}

    public static boolean on(Context c) {
        return c.getApplicationContext().getSharedPreferences(SWITCH, Context.MODE_PRIVATE).getBoolean("on", false);
    }

    /**
     * Saves the switch. Off also forgets the start record, so the next start is a normal one. A recovery start already
     * on screen keeps its card until Start normally (an early off copied while the page boots must never end it).
     */
    public static void setOn(Context c, boolean on) {
        Context app = c.getApplicationContext();
        if (on(app) == on) return;
        app.getSharedPreferences(SWITCH, Context.MODE_PRIVATE).edit().putBoolean("on", on).apply();
        Log.i(TAG, "recovery-mode switch " + (on ? "on" : "off"));
        if (!on) app.getSharedPreferences(STATE, Context.MODE_PRIVATE).edit().clear().apply();
    }

    /**
     * Background work started by the app itself waits while this is true: this process is a recovery start and the
     * owner hasn't tapped Start normally yet.
     */
    public static boolean paused() { return recovering; }

    /** Why the start before went wrong ("froze" or "closed"), for the card. */
    public static String why() { return why; }

    /**
     * MainActivity.onCreate (the shell, never a pinned app window). Once per process: a recreated Activity keeps the
     * answer. Returns true for a recovery start.
     */
    public static synchronized boolean begin(Context c) {
        if (began) return recovering;
        began = true;
        if (!on(c)) return false;
        StartPolicy.State s = read(c);
        recovering = StartPolicy.begin(s, android.os.Process.myPid(), BuildConfig.VERSION_CODE, System.currentTimeMillis());
        why = s.why;
        beganUptime = SystemClock.uptimeMillis();
        write(c, s);
        if (recovering) Log.w(TAG, "the last start " + (s.why.isEmpty() ? "went wrong" : s.why) + ": this one opens in recovery mode");
        return recovering;
    }

    /** First onResume of the pending start: a slow way here is a frozen start. Returns true when it has a start to settle. */
    public static synchronized boolean resumed() {
        if (!began || beganUptime == 0 || resumedUptime != 0) return false;
        resumedUptime = SystemClock.uptimeMillis();
        return true;
    }

    /** The pending start ran {@link StartPolicy#SETTLE_MS} after its first onResume, or WizardOS left the screen. */
    public static synchronized void settle(Context c) {
        if (!began || beganUptime == 0 || !on(c)) return;
        StartPolicy.State s = read(c);
        if (s.pendingAt == 0 || s.pendingPid != android.os.Process.myPid()) return;
        boolean slow = resumedUptime != 0 && resumedUptime - beganUptime >= StartPolicy.SLOW_START_MS;
        boolean froze = slow;
        for (HangLog.Hang h : HangWatch.log(c).hangs()) if (StartPolicy.frozeDuring(s.pendingAt, h.at, h.ms)) { froze = true; break; }
        StartPolicy.settled(s, froze, BuildConfig.VERSION_CODE);
        write(c, s);
        Log.i(TAG, "start settled" + (froze ? " after a freeze" + (slow ? " (" + (resumedUptime - beganUptime) + " ms to the screen)" : "") : ""));
        beganUptime = 0;
    }

    /** Start normally: the pause ends and this process's start counts again (so a freeze now brings recovery back). */
    public static synchronized void startNormally(Context c) {
        if (!recovering) return;
        recovering = false;
        if (!on(c)) return;
        StartPolicy.State s = read(c);
        StartPolicy.normal(s, android.os.Process.myPid(), System.currentTimeMillis());
        write(c, s);
        beganUptime = SystemClock.uptimeMillis();
        resumedUptime = beganUptime; // already on screen: only a freeze from here on counts
        Log.i(TAG, "recovery mode ended: normal start");
    }

    /** Emulator tests only: forget this process's start, as if the next Activity were the first of a new process. */
    static synchronized void forgetProcessForQa() {
        began = false; recovering = false; beganUptime = 0; resumedUptime = 0; why = "";
    }

    private static StartPolicy.State read(Context c) {
        SharedPreferences p = c.getApplicationContext().getSharedPreferences(STATE, Context.MODE_PRIVATE);
        StartPolicy.State s = new StartPolicy.State();
        s.pendingAt = p.getLong("pendingAt", 0); s.pendingPid = p.getInt("pendingPid", 0);
        s.pendingNormal = p.getBoolean("pendingNormal", false);
        s.bad = p.getInt("bad", 0); s.badVersion = p.getInt("badVersion", 0); s.why = p.getString("why", "");
        return s;
    }

    /** commit(), not apply(): a start that dies a moment later must still be on disk. The file is a few bytes. */
    private static void write(Context c, StartPolicy.State s) {
        c.getApplicationContext().getSharedPreferences(STATE, Context.MODE_PRIVATE).edit()
                .putLong("pendingAt", s.pendingAt).putInt("pendingPid", s.pendingPid).putBoolean("pendingNormal", s.pendingNormal)
                .putInt("bad", s.bad).putInt("badVersion", s.badVersion).putString("why", s.why).commit();
    }
}
