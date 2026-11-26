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
                // A wide "9+" pill grows leftwards from the right edge, so its left edge may cross the
                // midline; what makes it top-right is the anchored right edge and the bubble centre.
                assertTrue(size + " " + label + " right half", g.right > size / 2f && (g.left + g.right) / 2f > size / 2f);
                assertTrue(size + " " + label + " top half", g.bottom < size / 2f);
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
    @Test public void adaptiveBubbleStaysInsideTheSafeZoneCircleWhatEverTheMask() {
        for (int full : new int[]{108, 162, 288, 432}) {
            float[] r = BadgeGeometry.adaptiveRegion(full);
            float cx = full / 2f, safe = full * 33f / 108f; // 66 dp safe-zone circle on 108 dp art
            for (String label : new String[]{"1", "9+"}) {
                BadgeGeometry g = BadgeGeometry.compute(Math.round(r[1]), label.length(), 0);
                float l = r[0] + g.left - g.ring, t = r[0] + g.top - g.ring, rt = r[0] + g.right + g.ring, b = r[0] + g.bottom + g.ring;
                for (float[] p : new float[][]{{l, t}, {rt, t}, {l, b}, {rt, b}}) {
                    double d = Math.hypot(p[0] - cx, p[1] - cx);
                    assertTrue(full + " " + label + " corner inside the safe circle: " + d + " <= " + safe, d <= safe + 0.5);
                }
                assertTrue(full + " " + label + " top-right of the visible icon", (l + rt) / 2f > cx && (t + b) / 2f < cx);
            }
        }
    }

    /* ---- One UI look (wizard-ux issue 1669). Adaptive bitmaps are built from 48..256 px squares (108 / 72 of them). */
    private static final int[] SQUARES = {48, 96, 192, 256};
    private static final String[] LABELS = {"1", "85", "999", "999+"};
    private static int full(int square) { return Math.round(square * 108f / 72f); }

    /** Every point of the pill (both end circles, sampled) passes {@code inside}. */
    private interface Inside { boolean at(double x, double y); }
    private static void assertPillInside(String what, BadgeGeometry g, Inside inside) {
        float r = g.radius(), cy = g.top + r;
        for (float cx : new float[]{g.left + r, g.right - r}) for (int i = 0; i < 360; i++) {
            double t = Math.toRadians(i), x = cx + r * Math.cos(t), y = cy + r * Math.sin(t);
            assertTrue(what + " point " + x + "," + y + " inside the mask", inside.at(x, y));
        }
    }

    @Test public void samsungBadgeIsInsideTheSquircleAtTheTilesTopRightCorner() {
        for (int sq : SQUARES) for (String label : LABELS) {
            int f = full(sq);
            float tile = BadgeGeometry.visibleTile(f), c = f / 2f;
            BadgeGeometry g = BadgeGeometry.oneUiAdaptive(f, label.length(), 0, true);
            String what = sq + "px " + label;
            assertPillInside(what, g, (x, y) -> BadgeGeometry.insideSquircle(x, y, c, tile / 2f));
            assertEquals(what + " no ring", 0f, g.ring, 0f);
            assertEquals(what + " a quarter of the visible tile high", tile / 4f, g.height(), 0.01f);
            // At the corner: right edge in the tile's right tenth... and the top within the tile's top tenth-and-a-bit,
            // i.e. well past the glyph (the old bubble's top-right edge was at 69 % / 31 % of the full art).
            float tileLeft = c - tile / 2f;
            assertTrue(what + " right edge near the tile's right edge: " + (g.right - tileLeft) / tile, (g.right - tileLeft) / tile > 0.88f);
            assertTrue(what + " top edge near the tile's top edge: " + (g.top - tileLeft) / tile, (g.top - tileLeft) / tile < 0.12f);
            assertTrue(what + " centre in the top-right quarter", (g.left + g.right) / 2f > c && (g.top + g.bottom) / 2f < c);
        }
    }

    @Test public void otherLaunchersKeepTheBadgeInTheSafeZoneSoACircleMaskNeverClipsIt() {
        for (int sq : SQUARES) for (String label : LABELS) {
            int f = full(sq);
            float c = f / 2f, safe = f * 33f / 108f; // 66 dp safe-zone circle on 108 dp art
            BadgeGeometry g = BadgeGeometry.oneUiAdaptive(f, label.length(), 0, false);
            String what = sq + "px " + label;
            assertPillInside(what, g, (x, y) -> Math.hypot(x - c, y - c) <= safe + 0.01);
            assertEquals(what + " same size as on Samsung", BadgeGeometry.visibleTile(f) / 4f, g.height(), 0.01f);
            float[] r = BadgeGeometry.adaptiveRegion(f);
            assertEquals(what + " anchored at the safe square's right edge", r[0] + r[1], g.right, Math.max(0.5f, r[1] * 0.01f) + 0.01f);
            assertTrue(what + " centre in the top-right quarter", (g.left + g.right) / 2f > c && (g.top + g.bottom) / 2f < c);
        }
    }

    @Test public void oneUiIsACircleForOneDigitAndAPillThatGrowsLeftwardsForMore() {
        for (boolean samsung : new boolean[]{true, false}) {
            BadgeGeometry one = BadgeGeometry.oneUiAdaptive(288, 1, 0, samsung), two = BadgeGeometry.oneUiAdaptive(288, 2, 0, samsung),
                    three = BadgeGeometry.oneUiAdaptive(288, 3, 0, samsung);
            assertEquals(one.height(), one.width(), 0.01f);
            assertTrue(two.width() > one.width() && three.width() > two.width());
            assertEquals(one.height(), three.height(), 0.01f);
            assertTrue("smaller than the classic 40 % bubble", one.height() < BadgeGeometry.compute(Math.round(BadgeGeometry.adaptiveRegion(288)[1]), 1, 0).height());
        }
    }

    @Test public void oneUiWidgetBadgeStaysInsideARoundedTile() {
        for (int sq : SQUARES) for (String label : LABELS) {
            BadgeGeometry g = BadgeGeometry.oneUi(0f, sq, label.length(), 0, true);
            assertPillInside(sq + " " + label, g, (x, y) -> BadgeGeometry.insideSquircle(x, y, sq / 2f, sq / 2f));
            assertTrue(g.left >= 0 && g.top >= 0 && g.right <= sq && g.bottom <= sq);
        }
    }
}
