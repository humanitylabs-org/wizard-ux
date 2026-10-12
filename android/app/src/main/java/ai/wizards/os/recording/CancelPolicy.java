package ai.wizards.os.recording;

import java.util.ArrayList;
import java.util.List;

/** Pure rules for which cancelled takes are kept (unit-tested; see CancelledTakes). */
public final class CancelPolicy {
    private CancelPolicy() { }

    /** A cancel after this much talking is kept for recovery; anything shorter is a deliberate "never mind". */
    public static final long KEEP_FROM_MS = 15_000;
    /** At most this many kept takes, newest first. */
    public static final int MAX_KEPT = 10;
    /** Kept takes go away after a week. */
    public static final long MAX_AGE_MS = 7L * 24 * 3600 * 1000;
    /** Below this the file holds no usable audio. */
    static final long MIN_BYTES = 2_000;

    public static boolean keep(long ms, long bytes) { return ms >= KEEP_FROM_MS && bytes >= MIN_BYTES; }

    /** Indexes (into ats, newest first) of the takes to delete now. */
    public static List<Integer> drop(long[] ats, long now) {
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < ats.length; i++) if (i >= MAX_KEPT || now - ats[i] > MAX_AGE_MS) out.add(i);
        return out;
    }
}
