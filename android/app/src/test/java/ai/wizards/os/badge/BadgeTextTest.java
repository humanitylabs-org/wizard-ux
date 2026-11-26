package ai.wizards.os.badge;

import static org.junit.Assert.*;
import org.junit.Test;

public class BadgeTextTest {
    @Test public void zeroAndUnknownDrawNothing() {
        assertEquals("", BadgeText.label(0));
        assertEquals("", BadgeText.label(-1));
    }
    @Test public void showsExactCountUpToNine() {
        for (int i = 1; i <= 9; i++) assertEquals(Integer.toString(i), BadgeText.label(i));
    }
    @Test public void capsAboveNineAsNinePlus() {
        assertEquals("9+", BadgeText.label(10));
        assertEquals("9+", BadgeText.label(12));
        assertEquals("9+", BadgeText.label(9999));
        assertEquals("9+", BadgeText.label(Integer.MAX_VALUE));
    }
    @Test public void clampKeepsUnknownUnknownAndBoundsHugeCounts() {
        assertEquals(-1, BadgeText.clamp(-1));
        assertEquals(3, BadgeText.clamp(3));
        assertEquals(BadgeText.MAX_STORED, BadgeText.clamp(Integer.MAX_VALUE));
    }

    /* One UI look (wizard-ux issue 1669, switch wizard/phone-badge-look): the real number, "999+" only above 999. */
    @Test public void exactLabelShowsTheRealCountUpTo999() {
        assertEquals("1", BadgeText.label(1, true));
        assertEquals("9", BadgeText.label(9, true));
        assertEquals("10", BadgeText.label(10, true));
        assertEquals("85", BadgeText.label(85, true));
        assertEquals("999", BadgeText.label(999, true));
        assertEquals("999+", BadgeText.label(1000, true));
        assertEquals("999+", BadgeText.label(BadgeText.MAX_STORED, true));
        assertEquals("", BadgeText.label(0, true));
        assertEquals("", BadgeText.label(-1, true));
    }
    @Test public void switchOffKeepsTheClassicLabel() {
        for (int n : new int[]{-1, 0, 1, 9, 10, 85, 999, 1000}) assertEquals(BadgeText.label(n), BadgeText.label(n, false));
    }
}
