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
    private static final String[] LABELS = {"1", "17", "85", "999", "999+"};
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

    /** Every point of the pill grown by {@code grow} (its shadow, plus the clear margin) passes {@code inside}. */
    private static void assertPillInside(String what, BadgeGeometry g, float grow, Inside inside) {
        float r = g.radius(), cy = g.top + r, R = r + grow;
        for (float cx : new float[]{g.left + r, g.right - r}) for (int i = 0; i < 360; i++) {
            double t = Math.toRadians(i), x = cx + R * Math.cos(t), y = cy + R * Math.sin(t);
            assertTrue(what + " point " + x + "," + y + " (grown by " + grow + ") inside the mask", inside.at(x, y));
        }
    }
    /** One UI's mask, two conservative models (issue 1960): an n = 3 squircle and a 25 %-corner rounded square. */
    private static boolean inN3(double x, double y, double c, double a) {
        return Math.pow(Math.abs(x - c) / a, 3) + Math.pow(Math.abs(y - c) / a, 3) <= 1.0;
    }
    private static boolean inRounded(double x, double y, double l, double side) {
        double u = x - l, v = y - l, r = side * 0.25;
        if (u < 0 || v < 0 || u > side || v > side) return false;
        double cx = Math.min(Math.max(u, r), side - r), cy = Math.min(Math.max(v, r), side - r);
        return Math.hypot(u - cx, v - cy) <= r;
    }

    @Test public void samsungBadgeAndItsShadowAreWhollyInsideARounderMaskWithAClearMargin() {
        for (int sq : SQUARES) for (String label : LABELS) {
            int f = full(sq);
            float tile = BadgeGeometry.visibleTile(f), c = f / 2f, tileLeft = c - tile / 2f;
            BadgeGeometry g = BadgeGeometry.oneUiAdaptive(f, label.length(), 0, true);
            String what = sq + "px " + label;
            float shadow = BadgeGeometry.shadowReach(g.height()), margin = tile * 0.04f;
            // Badge plus shadow plus a ~4 % clear margin inside both models of the mask.
            assertPillInside(what + " n=3", g, shadow + margin - 0.01f, (x, y) -> inN3(x, y, c, tile / 2f));
            assertPillInside(what + " rounded square", g, shadow + margin - 0.01f, (x, y) -> inRounded(x, y, tileLeft, tile));
            assertEquals(what + " no ring", 0f, g.ring, 0f);
            assertEquals(what + " about 25 % bigger: 0.31 of the visible tile high", tile * 0.31f, g.height(), 0.01f);
            assertTrue(what + " shadow 1-2 px down at phone sizes", BadgeGeometry.shadowDy(g.height()) >= 1f && BadgeGeometry.shadowDy(g.height()) <= Math.max(2f, g.height() * 0.03f));
            // Still at the corner, top-right, well past the glyph: right edge in the tile's right sixth, top in its top sixth.
            assertTrue(what + " right edge near the tile's right edge: " + (g.right - tileLeft) / tile, (g.right - tileLeft) / tile > 0.84f);
            assertTrue(what + " top edge near the tile's top edge: " + (g.top - tileLeft) / tile, (g.top - tileLeft) / tile < 0.16f);
            assertTrue(what + " centre in the top-right quarter", (g.left + g.right) / 2f > c && (g.top + g.bottom) / 2f < c);
        }
    }

    @Test public void theFirstPlacementWouldHaveBeenCutByTheRounderCorner() {
        // Issue 1960's cause, kept as a guard: a 0.25 badge pushed to the n = 4 edge (right 181 / top 11 of a 192 tile)
        // has points outside the n = 3 model; the new placement has none.
        float tile = 192f, c = 96f, d = 48f, r = d / 2f;
        double cx = 181.3 - r, cy = 10.7 + r;
        boolean cut = false;
        for (int i = 0; i < 360; i++) {
            double t = Math.toRadians(i);
            if (!inN3(cx + r * Math.cos(t), cy + r * Math.sin(t), c, tile / 2f)) cut = true;
        }
        assertTrue("old placement pokes out of an n=3 mask", cut);
        BadgeGeometry g = BadgeGeometry.oneUi(0f, tile, 1, 0, true);
        assertPillInside("new placement", g, 0f, (x, y) -> inN3(x, y, c, tile / 2f));
    }

    @Test public void otherLaunchersKeepTheBadgeInTheSafeZoneSoACircleMaskNeverClipsIt() {
        for (int sq : SQUARES) for (String label : LABELS) {
            int f = full(sq);
            float c = f / 2f, safe = f * 33f / 108f; // 66 dp safe-zone circle on 108 dp art
            BadgeGeometry g = BadgeGeometry.oneUiAdaptive(f, label.length(), 0, false);
            String what = sq + "px " + label;
            assertPillInside(what, g, (x, y) -> Math.hypot(x - c, y - c) <= safe + 0.01);
            // Its faint shadow may spill past the safe zone but stays inside the 72 dp circle a round mask shows.
            float shown = f * 36f / 108f;
            assertPillInside(what + " with its shadow", g, BadgeGeometry.shadowReach(g.height()), (x, y) -> Math.hypot(x - c, y - c) <= shown + 0.01);
            assertEquals(what + " same size as on Samsung", BadgeGeometry.visibleTile(f) * 0.31f, g.height(), 0.01f);
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
            // Issue 1960: about 25 % bigger than the first One UI look (a quarter of the visible tile).
            assertEquals("about 25 % bigger than before", 1.24f, one.height() / (BadgeGeometry.visibleTile(288) * 0.25f), 0.02f);
        }
    }

    @Test public void oneUiWidgetBadgeStaysInsideARoundedTile() {
        for (int sq : SQUARES) for (String label : LABELS) {
            BadgeGeometry g = BadgeGeometry.oneUi(0f, sq, label.length(), 0, true);
            float grow = BadgeGeometry.shadowReach(g.height()) + sq * 0.04f - 0.01f;
            assertPillInside(sq + " " + label + " n=3", g, grow, (x, y) -> inN3(x, y, sq / 2f, sq / 2f));
            assertPillInside(sq + " " + label + " rounded square", g, grow, (x, y) -> inRounded(x, y, 0, sq));
            assertTrue(g.left >= 0 && g.top >= 0 && g.right <= sq && g.bottom <= sq);
        }
    }
}
