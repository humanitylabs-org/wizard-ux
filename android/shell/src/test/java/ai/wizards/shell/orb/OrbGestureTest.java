package ai.wizards.shell.orb;

import org.junit.Test;

import static org.junit.Assert.*;

public class OrbGestureTest {
    @Test public void aShortStillPressIsATap() {
        OrbGesture g = new OrbGesture(10);
        g.down(100, 100, 0);
        assertFalse(g.move(104, 103));
        assertEquals(OrbGesture.Kind.TAP, g.up(105, 104, 200));
        assertEquals(OrbGesture.Kind.NONE, g.up(105, 104, 210));
    }

    @Test public void movingPastTheSlopIsADragNeverATap() {
        OrbGesture g = new OrbGesture(10);
        g.down(100, 100, 0);
        assertTrue(g.move(130, 100));
        assertFalse("a drag never hides", g.held(5000));
        assertEquals(OrbGesture.Kind.DRAG, g.up(200, 300, 100));
    }

    @Test public void aLongStillPressHides() {
        OrbGesture g = new OrbGesture(10);
        g.down(0, 0, 1000);
        assertFalse(g.held(1000 + OrbGesture.HOLD_MS - 1));
        assertTrue(g.held(1000 + OrbGesture.HOLD_MS));
        assertEquals(OrbGesture.Kind.HOLD, g.up(1, 1, 1000 + OrbGesture.HOLD_MS + 5));
        g.down(0, 0, 0); g.cancel();
        assertFalse(g.held(10_000));
    }

    @Test public void aDroppedOrbSnapsToTheNearerEdgeOnScreen() {
        assertArrayEquals(new int[]{8, 500}, OrbGesture.rest(100, 500, 168, 1080, 2400, 8));
        assertArrayEquals(new int[]{1080 - 168 - 8, 500}, OrbGesture.rest(800, 500, 168, 1080, 2400, 8));
        assertArrayEquals(new int[]{8, 8}, OrbGesture.rest(-500, -500, 168, 1080, 2400, 8));
        assertArrayEquals(new int[]{1080 - 168 - 8, 2400 - 168 - 8}, OrbGesture.rest(5000, 9000, 168, 1080, 2400, 8));
    }
}
