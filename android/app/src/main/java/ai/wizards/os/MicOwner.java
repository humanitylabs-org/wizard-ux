package ai.wizards.os;

/**
 * One microphone owner at a time, inside the Wizard OS process.
 *
 * The meeting recorder (Mizel), the floating Everywhere orb and the side button each take the mic through here.
 * A second taker is refused (the caller shows a toast with {@link #reason}) instead of silently stealing or
 * sharing the mic. Pure Java so it is unit-testable off-device.
 */
public final class MicOwner {
    public static final String MEETING = "meeting", EVERYWHERE = "everywhere", SIDE = "side";

    private static String holder;

    private MicOwner() {}

    /** Takes the mic for {@code who}. True if it was free or already held by {@code who}. */
    public static synchronized boolean tryAcquire(String who) {
        if (holder == null || holder.equals(who)) { holder = who; return true; }
        return false;
    }

    /** Gives the mic back; a no-op if {@code who} does not hold it. */
    public static synchronized void release(String who) {
        if (who != null && who.equals(holder)) holder = null;
    }

    public static synchronized String holder() { return holder; }

    public static synchronized boolean heldBy(String who) { return who != null && who.equals(holder); }

    /** Why {@code who} could not get the mic, in words for a toast. */
    public static synchronized String reason(String who) {
        String h = holder;
        if (MEETING.equals(h)) return "A meeting is recording. Pause or stop it first.";
        if (EVERYWHERE.equals(h)) return "The floating orb is listening. Finish that first.";
        if (SIDE.equals(h)) return "The side button is listening. Finish that first.";
        return "The microphone is busy.";
    }

    /** Tests only. */
    static synchronized void resetForTest() { holder = null; }
}
