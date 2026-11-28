package ai.wizards.os.badge;

/** What the bubble says. Pure so every mechanism (icon, notification, widget) agrees. */
public final class BadgeText {
    private BadgeText() {}
    /** Counts above this show as "999+" (wizard-ux issue 1669, on for everyone). */
    public static final int EXACT_CAP = 999;
    public static final int MAX_STORED = 9999;

    /** Unknown (negative) is not zero: callers must not clear a badge because a fetch failed. */
    public static int clamp(int count) { return count < 0 ? count : Math.min(count, MAX_STORED); }

    /** Bubble text: the real number up to 999, and "999+" only above that; empty means draw no bubble at all. */
    public static String label(int count) {
        if (count <= 0) return "";
        return count > EXACT_CAP ? EXACT_CAP + "+" : Integer.toString(count);
    }
}
