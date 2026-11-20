package ai.wizards.os.badge;

import static org.junit.Assert.*;
import org.junit.Test;
import java.util.*;

public class BadgeSyncTest {
    static final class MemStore implements BadgeSync.Store {
        final Map<String,Integer> m = new HashMap<>();
        public int applied(String k) { return m.getOrDefault(k, BadgeSync.NONE); }
        public void setApplied(String k, int v) { m.put(k, v); }
    }
    static final class Fake implements BadgeSync.Mechanism {
        final String id; boolean limited, succeed = true, boom; int calls; final List<Integer> seen = new ArrayList<>();
        Fake(String id) { this.id = id; }
        public String id() { return id; }
        public boolean rateLimited() { return limited; }
        public boolean apply(int n) { calls++; seen.add(n); if (boom) throw new IllegalStateException("x"); return succeed; }
    }

    @Test public void decisions() {
        assertEquals(BadgeSync.Decision.SKIP_UNKNOWN, BadgeSync.decide(-1, 3, false));
        assertEquals(BadgeSync.Decision.SKIP_SAME, BadgeSync.decide(3, 3, false));
        assertEquals(BadgeSync.Decision.DEFER_RATE_LIMITED, BadgeSync.decide(3, 0, true));
        assertEquals(BadgeSync.Decision.APPLY, BadgeSync.decide(3, 0, false));
        assertEquals(BadgeSync.Decision.APPLY, BadgeSync.decide(0, 3, false)); // clearing is a change too
        assertEquals(BadgeSync.Decision.APPLY, BadgeSync.decide(0, BadgeSync.NONE, false));
    }
    @Test public void onlyCallsWhenTheCountChanges() {
        MemStore s = new MemStore(); Fake f = new Fake("shortcut");
        assertTrue(BadgeSync.sync(s, f, 3)); assertTrue(BadgeSync.sync(s, f, 3)); assertTrue(BadgeSync.sync(s, f, 3));
        assertEquals(1, f.calls);
        assertTrue(BadgeSync.sync(s, f, 12)); assertEquals(2, f.calls);
        assertTrue(BadgeSync.sync(s, f, 0)); assertEquals(3, f.calls);
        assertEquals(Arrays.asList(3, 12, 0), f.seen);
    }
    @Test public void unknownCountNeverTouchesTheBadge() {
        MemStore s = new MemStore(); Fake f = new Fake("shortcut");
        BadgeSync.sync(s, f, 5);
        assertFalse(BadgeSync.sync(s, f, -1));
        assertEquals(1, f.calls); assertEquals(5, s.applied("shortcut"));
    }
    @Test public void rateLimitDefersThenRetriesNextTickWithTheNewestCount() {
        MemStore s = new MemStore(); Fake f = new Fake("shortcut"); f.limited = true;
        assertFalse(BadgeSync.sync(s, f, 3)); assertFalse(BadgeSync.sync(s, f, 4));
        assertEquals(0, f.calls); assertEquals(BadgeSync.NONE, s.applied("shortcut"));
        f.limited = false;
        assertTrue(BadgeSync.sync(s, f, 5));
        assertEquals(Collections.singletonList(5), f.seen); // intermediate 3 and 4 coalesced away
    }
    @Test public void failedApplyIsNotRecordedSoItRetries() {
        MemStore s = new MemStore(); Fake f = new Fake("shortcut"); f.succeed = false;
        assertFalse(BadgeSync.sync(s, f, 3)); assertEquals(BadgeSync.NONE, s.applied("shortcut"));
        f.succeed = true;
        assertTrue(BadgeSync.sync(s, f, 3)); assertEquals(2, f.calls); assertEquals(3, s.applied("shortcut"));
    }
    @Test public void aThrowingMechanismNeverStopsTheOthers() {
        MemStore s = new MemStore(); Fake a = new Fake("shortcut"), b = new Fake("notify"), c = new Fake("widget");
        a.boom = true;
        int ok = BadgeSync.syncAll(s, Arrays.asList(a, b, c), 3);
        assertEquals(2, ok); assertEquals(1, b.calls); assertEquals(1, c.calls);
        assertEquals(BadgeSync.NONE, s.applied("shortcut")); assertEquals(3, s.applied("notify")); assertEquals(3, s.applied("widget"));
        a.boom = false;
        assertEquals(3, BadgeSync.syncAll(s, Arrays.asList(a, b, c), 3));
        assertEquals(1, b.calls); // already in sync: not called again
    }
    @Test public void mechanismsKeepIndependentAppliedValues() {
        MemStore s = new MemStore(); Fake a = new Fake("shortcut"), b = new Fake("notify");
        a.limited = true;
        BadgeSync.syncAll(s, Arrays.asList(a, b), 3);
        assertEquals(BadgeSync.NONE, s.applied("shortcut")); assertEquals(3, s.applied("notify"));
    }
}
