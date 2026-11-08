package ai.wizards.os.mizel;

/** Package replacement is not permission to start a background microphone. */
public final class MizelUpdatePolicy {
    private MizelUpdatePolicy() {}

    public static boolean pending(MizelJournal j) {
        return j != null && j.recording && j.resumeAfterUpdate && j.stopReason == null && !j.stopSent;
    }

    public static boolean interruptedByUpdate(MizelJournal j, int installedVersion) {
        return j != null && j.recording && !j.paused && j.stopReason == null && !j.stopSent
                && j.captureVersion > 0 && j.captureVersion != installedVersion;
    }

    public static boolean canResume(MizelJournal j, String origin) {
        return pending(j) && j.uploadOrigin != null && !j.uploadOrigin.isEmpty() && j.uploadOrigin.equals(origin);
    }
}
