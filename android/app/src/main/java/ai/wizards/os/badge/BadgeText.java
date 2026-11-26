package ai.wizards.os.badge;

/** What the bubble says. Pure so every mechanism (icon, notification, widget) agrees. */
public final class BadgeText {
    private BadgeText() {}
    /** Counts above this show as "9+" (classic look). */
    public static final int CAP = 9;
    /** Counts above this show as "999+" (One UI look, wizard-ux issue 1669). */
    public static final int EXACT_CAP = 999;
    public static final int MAX_STORED = 9999;

    /** Unknown (negative) is not zero: callers must not clear a badge because a fetch failed. */
    public static int clamp(int count) { return count < 0 ? count : Math.min(count, MAX_STORED); }

    /** Bubble text in the classic look; empty means draw no bubble at all. */
    public static String label(int count) { return label(count, false); }

    /** {@code exact}: the One UI look shows the real number up to 999, and "999+" only above that. */
    public static String label(int count, boolean exact) {
        if (count <= 0) return "";
        int cap = exact ? EXACT_CAP : CAP;
        return count > cap ? cap + "+" : Integer.toString(count);
    }
}
