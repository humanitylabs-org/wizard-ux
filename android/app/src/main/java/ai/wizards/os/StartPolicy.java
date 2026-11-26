package ai.wizards.os;

import org.json.JSONObject;

/**
 * Pure rules for recovery mode (wizard-ux issue 1775, switch wizard/phone-recovery-mode, off by default): when a start
 * of the phone app froze or never finished, the next start opens in recovery mode (the shell only, meeting recording
 * and uploads paused, a native card with Check for update, Send diagnostics and Start normally). Unit-tested off-device;
 * {@link StartGuard} keeps the state in one small prefs file and feeds it.
 *
 * A start is "pending" from MainActivity.onCreate until it settles: {@link #SETTLE_MS} after its first onResume, or
 * when WizardOS leaves the screen. A normal start that never settled in its own process (Android closed it after
 * "isn't responding", it crashed, or the owner swiped a frozen app away) or that froze on the way (the first
 * onResume came {@link #SLOW_START_MS} late, or the UI thread or page stopped answering before it settled) is a bad
 * start. One bad start is enough: the next one recovers.
 */
public final class StartPolicy {
    /** Bad normal starts in a row that make the next start a recovery start. */
    public static final int BAD_STARTS = 1;
    /** A start that ran this long after its first onResume without a freeze went fine. */
    public static final long SETTLE_MS = 10_000;
    /** onCreate to the first onResume taking this long (uptime) is a frozen start, also when it later went on. */
    public static final long SLOW_START_MS = 8_000;

    private StartPolicy() {}

    /** What is kept between starts. */
    public static final class State {
        /** Wall time the pending start began, 0 when none is pending. */
        public long pendingAt;
        /** Process that ran the pending start; another process finding it pending means that start died. */
        public int pendingPid;
        /** The pending start was a normal one (recovery starts never count as bad). */
        public boolean pendingNormal;
        /** Bad normal starts in a row, and the build they happened on. */
        public int bad, badVersion;
        /** "froze" or "closed": why the last bad start went wrong. */
        public String why = "";
    }

    /**
     * A start begins in process {@code pid} of build {@code version}. Returns true when it opens in recovery mode.
     * A different build than the one with the bad starts starts normally: a fixed build always gets a normal try.
     */
    public static boolean begin(State s, int pid, int version, long now) {
        if (s.pendingAt > 0 && s.pendingPid != pid && s.pendingNormal) bad(s, version, "closed");
        if (s.bad > 0 && s.badVersion != version) { s.bad = 0; s.why = ""; }
        boolean recover = s.bad >= BAD_STARTS;
        s.pendingAt = now; s.pendingPid = pid; s.pendingNormal = !recover;
        return recover;
    }

    /** The pending start settled; {@code froze} = it froze on the way. A recovery start leaves the count as it is. */
    public static void settled(State s, boolean froze, int version) {
        if (s.pendingAt == 0) return;
        if (s.pendingNormal) {
            if (froze) bad(s, version, "froze");
            else { s.bad = 0; s.why = ""; }
        }
        s.pendingAt = 0; s.pendingPid = 0; s.pendingNormal = false;
    }

    /** The owner tapped Start normally in recovery mode: from now on this process runs a normal start that can go bad. */
    public static void normal(State s, int pid, long now) {
        s.pendingAt = now; s.pendingPid = pid; s.pendingNormal = true;
    }

    /** A freeze saved at {@code hangAt} (wall time) lasting {@code hangMs} belongs to a start that began at {@code startAt}. */
    public static boolean frozeDuring(long startAt, long hangAt, long hangMs) {
        return startAt > 0 && hangAt + Math.max(0, hangMs) >= startAt;
    }

    private static void bad(State s, int version, String why) {
        s.bad = (s.badVersion == version ? s.bad : 0) + 1;
        s.badVersion = version;
        s.why = why;
    }

    /* ---------------- what the recovery card says ---------------- */

    public static String title() { return "Recovery mode"; }

    public static String body(String why) {
        String what = "closed".equals(why) ? "WizardOS closed before it finished starting last time."
                : "WizardOS froze when it last started.";
        return what + " Meeting recording and uploads are paused until you start normally.";
    }

    /** The update line under the buttons for Updater's state ({@code Updater.state()}); "" = nothing to say. */
    public static String updateLine(JSONObject u) {
        if (u == null) return "";
        String st = u.optString("state"), v = u.optString("version"), have = u.optString("installed");
        String name = v.isEmpty() ? "The update" : "WizardOS " + v;
        switch (st) {
            case "checking": return "Checking for an update…";
            case "current": return "WizardOS " + have + " is the newest version.";
            case "offline": return "Couldn’t reach your Wizard to check. Try again in a moment.";
            case "available": return name + " is available.";
            case "downloading": return "Downloading " + (v.isEmpty() ? "the update" : "WizardOS " + v) + "…";
            case "verifying": return "Checking the download…";
            case "ready": return name + " is ready to install.";
            case "deferred": return name + " installs once the recording has stopped.";
            case "permission": return "Allow WizardOS to install apps, then come back.";
            case "confirm": return "Confirm the install in Android’s window.";
            case "installing": return "Installing " + (v.isEmpty() ? "the update" : "WizardOS " + v) + "…";
            case "installed": return "Updated. WizardOS restarts.";
            case "error": { String m = u.optString("message"); return m.isEmpty() ? "The update didn’t work. Try again." : m; }
            default: return "";
        }
    }

    /** The update button's label: Install once a newer build is known, else Check for update. */
    public static String updateButton(JSONObject u) {
        String st = u == null ? "" : u.optString("state"), v = u == null ? "" : u.optString("version");
        if ("available".equals(st) || "ready".equals(st) || "deferred".equals(st) || "permission".equals(st))
            return v.isEmpty() ? "Install update" : "Install " + v;
        return "Check for update";
    }

    /** Whether the update button installs (true) or checks (false). */
    public static boolean updateInstalls(JSONObject u) { return !"Check for update".equals(updateButton(u)); }

    /** The update button waits while a check, download or install is under way. */
    public static boolean updateBusy(JSONObject u) {
        String st = u == null ? "" : u.optString("state");
        return "checking".equals(st) || "downloading".equals(st) || "verifying".equals(st) || "installing".equals(st) || "confirm".equals(st);
    }
}
