package ai.wizards.os.mizel;

/**
 * When an open meeting may continue in a new process. Package replacement and a process death are not permission to
 * start a background microphone: both become a durable pause that a visible Activity (or a notification tap) resumes.
 */
public final class MizelUpdatePolicy {
    private MizelUpdatePolicy() {}

    public static final String CAUSE_UPDATE = "update", CAUSE_PROCESS_DEATH = "process_death";

    public static boolean pending(MizelJournal j) {
        return j != null && j.recording && j.resumeAfterUpdate && j.stopReason == null && !j.stopSent;
    }

    /** A durable pause left by a process death (not an app update). */
    public static boolean afterProcessDeath(MizelJournal j) {
        return pending(j) && CAUSE_PROCESS_DEATH.equals(j.resumeCause);
    }

    public static boolean interruptedByUpdate(MizelJournal j, int installedVersion) {
        return j != null && j.recording && !j.paused && j.stopReason == null && !j.stopSent
                && j.captureVersion > 0 && j.captureVersion != installedVersion;
    }

    /**
     * The process died while this meeting was capturing (not paused by the owner or a mic loan, not stopped) and the
     * last audio is recent enough to continue the same meeting: older than the pause limit, it has ended for good.
     */
    public static boolean resumableAfterDeath(MizelJournal j, long diedAt, long now, long limitMs) {
        return j != null && j.recording && !j.paused && !j.resumeAfterUpdate && j.stopReason == null && !j.stopSent
                && now - diedAt < limitMs;
    }

    /** A process-death pause nobody resumed within the pause limit ends the meeting (reason process_death). */
    public static boolean expiredAfterDeath(MizelJournal j, long now, long limitMs) {
        return afterProcessDeath(j) && now - j.pausedAt >= limitMs;
    }

    public static boolean canResume(MizelJournal j, String origin) {
        return pending(j) && j.uploadOrigin != null && !j.uploadOrigin.isEmpty() && j.uploadOrigin.equals(origin);
    }
}
