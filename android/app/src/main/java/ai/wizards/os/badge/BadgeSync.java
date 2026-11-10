package ai.wizards.os.badge;

import java.util.List;

/**
 * Coalescing for every badge mechanism. Each mechanism is independent: its own last-applied value, its own
 * rate limit, and a failure (or exception) in one never stops the others. Nothing is applied for an unknown
 * count, an unchanged count, or while the platform is rate limiting; a deferred or failed apply is simply
 * retried on the next tick with whatever the newest count is by then.
 */
public final class BadgeSync {
    private BadgeSync() {}
    public static final int NONE = -1;

    public enum Decision { SKIP_UNKNOWN, SKIP_SAME, DEFER_RATE_LIMITED, APPLY }

    public interface Store { int applied(String mechanism); void setApplied(String mechanism, int count); }

    public interface Mechanism {
        String id();
        /** Cheap and side-effect free. */
        boolean rateLimited();
        /** @return true only if the badge now shows {@code count}. */
        boolean apply(int count);
    }

    public static Decision decide(int desired, int applied, boolean rateLimited) {
        if (desired < 0) return Decision.SKIP_UNKNOWN;
        if (desired == applied) return Decision.SKIP_SAME;
        if (rateLimited) return Decision.DEFER_RATE_LIMITED;
        return Decision.APPLY;
    }

    /** @return true when this mechanism shows {@code desired} afterwards. */
    public static boolean sync(Store store, Mechanism m, int desired) {
        int applied = store.applied(m.id());
        boolean limited;
        try { limited = m.rateLimited(); } catch (RuntimeException e) { limited = false; }
        Decision d = decide(desired, applied, limited);
        if (d == Decision.SKIP_SAME) return true;
        if (d != Decision.APPLY) return false;
        boolean ok;
        try { ok = m.apply(desired); } catch (RuntimeException e) { ok = false; }
        if (ok) store.setApplied(m.id(), desired);
        return ok;
    }

    /** Runs every mechanism; returns how many are in sync. One failing never blocks another. */
    public static int syncAll(Store store, List<? extends Mechanism> all, int desired) {
        int ok = 0;
        for (Mechanism m : all) {
            try { if (sync(store, m, desired)) ok++; } catch (RuntimeException ignored) { /* isolated */ }
        }
        return ok;
    }
}
