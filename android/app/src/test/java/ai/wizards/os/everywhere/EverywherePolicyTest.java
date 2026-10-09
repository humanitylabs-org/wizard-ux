package ai.wizards.os.everywhere;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class EverywherePolicyTest {
    @Test public void hiddenWhileWizardOsIsInFront() {
        assertFalse(EverywherePolicy.bubbleVisible(true, true, true));
        assertTrue(EverywherePolicy.bubbleVisible(true, true, false));
    }

    @Test public void hiddenWhenOffOrNotAllowed() {
        assertFalse(EverywherePolicy.bubbleVisible(false, true, false));
        assertFalse(EverywherePolicy.bubbleVisible(true, false, false));
    }

    @Test public void retriesTransientFailuresOnTheWebSchedule() {
        assertEquals(2000, EverywherePolicy.nextDelay(1, 0));
        assertEquals(5000, EverywherePolicy.nextDelay(2, 502));
        assertEquals(60000, EverywherePolicy.nextDelay(5, 503));
        assertEquals(-1, EverywherePolicy.nextDelay(6, 503));
        assertEquals(-1, EverywherePolicy.nextDelay(EverywherePolicy.AUTO_TRIES, 0));
        assertEquals(15000, EverywherePolicy.nextDelay(3, 429));
    }

    @Test public void stopsAtOnceOnHumanErrors() {
        assertEquals(-1, EverywherePolicy.nextDelay(1, 403));
        assertEquals(-1, EverywherePolicy.nextDelay(1, 400));
        assertEquals(-1, EverywherePolicy.nextDelay(1, 413));
    }

    @Test public void reasonsReadLikeTheApp() {
        assertEquals("Couldn’t reach Wizard", EverywherePolicy.reason(0, "x"));
        assertEquals("Wizard sign-in needed", EverywherePolicy.reason(403, ""));
        assertEquals("Wizard was unavailable (502)", EverywherePolicy.reason(502, ""));
        assertEquals("Wizard refused it (422)", EverywherePolicy.reason(422, ""));
    }

    @Test public void dragStaysOnScreenAndSnapsToTheNearerEdge() {
        assertArrayEquals(new int[]{10, 10}, EverywherePolicy.clamp(-500, -500, 100, 1080, 2400, 10));
        assertArrayEquals(new int[]{970, 2290}, EverywherePolicy.clamp(5000, 5000, 100, 1080, 2400, 10));
        assertArrayEquals(new int[]{10, 700}, EverywherePolicy.snap(300, 700, 100, 1080, 2400, 10));
        assertArrayEquals(new int[]{970, 700}, EverywherePolicy.snap(700, 700, 100, 1080, 2400, 10));
    }

    @Test public void defaultsToBottomRight() {
        int[] p = EverywherePolicy.defaultPosition(150, 1080, 2400, 20);
        assertEquals(1080 - 150 - 20, p[0]);
        assertTrue(p[1] > 2400 / 2);
    }

    @Test public void clipsLongText() {
        assertEquals("abc", EverywherePolicy.clip("  abc ", 10));
        assertEquals("abcd…", EverywherePolicy.clip("abcdefghij", 5));
    }
}
