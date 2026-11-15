package ai.wizards.os.notify;

/** Pure rules for reply notifications (unit-tested off-device). */
public final class ReplyPolicy {
    private ReplyPolicy() {}

    public static boolean settled(String status) {
        return "completed".equals(status) || "failed".equals(status) || "cancelled".equals(status)
                || "stopped".equals(status) || "interrupted".equals(status);
    }

    /* How often a watch is worth a network read (wizard-os#648: a 5 s poll for every watch, Snoozes included, kept the
     * phone awake in the background for hours). A reply in flight is read often while it is young, then less; a Snooze
     * is not read at all before its return time; an approval already announced is read once a minute. */
    static final long FAST_BG = 5_000, FAST_FRONT = 8_000, YOUNG = 10 * 60_000L, HOUR = 3_600_000L;
    static final long MID = 30_000, SLOW = 120_000, ASKED = 60_000, DUE = 15_000, LATE = 5 * 60_000L;
    /** Upper bound for one in-process wait, so a changed list is looked at again within the hour. */
    public static final long MAX_WAIT = HOUR;

    /** Gap between two reads of one watch. dueAt is a Snooze's return time (0 when the page did not say). */
    public static long interval(boolean boomerang, boolean asked, long at, long dueAt, long now, boolean front) {
        if (boomerang) {
            if (dueAt <= 0) return LATE;
            return now - dueAt < 30 * 60_000L ? DUE : LATE; // the scheduler may answer a little late; past that, rarely
        }
        if (asked) return ASKED;
        long age = Math.max(0, now - at);
        if (age < YOUNG) return front ? FAST_FRONT : FAST_BG;
        return age < HOUR ? MID : SLOW;
    }

    /** Milliseconds until this watch should be read again (0 = now). lastPoll 0 = never read in this process. */
    public static long waitMs(boolean boomerang, boolean asked, long at, long dueAt, long lastPoll, long now, boolean front) {
        if (boomerang && dueAt > 0 && now < dueAt) return dueAt - now; // nothing can come back before its time
        if (lastPoll <= 0) return 0;
        return Math.max(0, lastPoll + interval(boomerang, asked, at, dueAt, now, front) - now);
    }

    /** The in-process loop's next delay, from the watches' own waits: never under 5 s nor over an hour. */
    public static long nextDelay(long soonestWait) {
        return Math.max(FAST_BG, Math.min(MAX_WAIT, soonestWait));
    }

    public static String ended(String status) {
        return "failed".equals(status) || "interrupted".equals(status) ? "That request stopped with an error" : "That request was stopped";
    }

    /** The start of a reply, without Markdown noise, at most 280 characters. */
    public static String excerpt(String s) {
        if (s == null) return "";
        String t = s.replaceAll("(?s)```.*?```", " [code] ")
                .replaceAll("\\[([^\\]]+)]\\([^)]*\\)", "$1")
                .replaceAll("(?m)^\\s{0,3}(#{1,6}|>|[-*+]|\\d+\\.)\\s+", "")
                .replaceAll("[*_`~]+", "")
                .replaceAll("\\s+", " ").trim();
        if (t.length() <= 280) return t;
        int cut = t.lastIndexOf(' ', 279);
        return t.substring(0, cut > 200 ? cut : 279) + "…";
    }
}
