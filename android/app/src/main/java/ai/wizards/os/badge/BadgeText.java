package ai.wizards.os.badge;

/** What the bubble says. Pure so every mechanism (icon, notification, widget) agrees. */
public final class BadgeText {
    private BadgeText() {}
    /** Counts above this show as "9+". */
    public static final int CAP = 9;
    public static final int MAX_STORED = 9999;

    /** Unknown (negative) is not zero: callers must not clear a badge because a fetch failed. */
    public static int clamp(int count) { return count < 0 ? count : Math.min(count, MAX_STORED); }

    /** Bubble text; empty means draw no bubble at all. */
    public static String label(int count) {
        if (count <= 0) return "";
        return count > CAP ? CAP + "+" : Integer.toString(count);
    }
}
