package ai.wizards.os.badge;

import static org.junit.Assert.*;
import org.junit.Test;

public class BadgeGeometryTest {
    @Test public void bubbleSitsTopRightInsideTheBitmapIncludingItsRing() {
        for (int size : new int[]{48, 96, 192, 256}) {
            for (String label : new String[]{"1", "9", "9+"}) {
                BadgeGeometry g = BadgeGeometry.compute(size, label.length(), 0);
                assertTrue(size + " " + label + " ring left", g.left - g.ring >= 0);
                assertTrue(size + " " + label + " ring top", g.top - g.ring >= 0);
                assertTrue(size + " " + label + " ring right", g.right + g.ring <= size);
                assertTrue(size + " " + label + " ring bottom", g.bottom + g.ring <= size);
                assertTrue("top-right quadrant", g.left > size / 2f && g.bottom < size / 2f);
            }
        }
    }
    @Test public void singleDigitIsACircleAndNinePlusIsAWiderPill() {
        BadgeGeometry one = BadgeGeometry.compute(192, 1, 0), plus = BadgeGeometry.compute(192, 2, 0);
        assertEquals(one.height(), one.width(), 0.01f);
        assertTrue(plus.width() > one.width());
        assertEquals(one.height(), plus.height(), 0.01f);
        assertEquals(one.right, plus.right, 0.01f); // grows leftwards, stays anchored to the corner
    }
    @Test public void measuredTextWidthWinsOverTheEstimate() {
        BadgeGeometry wide = BadgeGeometry.compute(192, 2, 200f);
        assertTrue(wide.width() >= 200f);
    }
}
