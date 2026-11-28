package ai.wizards.os.badge;

import static org.junit.Assert.*;
import org.junit.Test;

public class BadgeTextTest {
    @Test public void zeroAndUnknownDrawNothing() {
        assertEquals("", BadgeText.label(0));
        assertEquals("", BadgeText.label(-1));
    }
    @Test public void clampKeepsUnknownUnknownAndBoundsHugeCounts() {
        assertEquals(-1, BadgeText.clamp(-1));
        assertEquals(3, BadgeText.clamp(3));
        assertEquals(BadgeText.MAX_STORED, BadgeText.clamp(Integer.MAX_VALUE));
    }

    /* One UI look (wizard-ux issue 1669, on for everyone): the real number, "999+" only above 999. */
    @Test public void exactLabelShowsTheRealCountUpTo999() {
        for (int i = 1; i <= 9; i++) assertEquals(Integer.toString(i), BadgeText.label(i));
        assertEquals("10", BadgeText.label(10));
        assertEquals("85", BadgeText.label(85));
        assertEquals("999", BadgeText.label(999));
        assertEquals("999+", BadgeText.label(1000));
        assertEquals("999+", BadgeText.label(BadgeText.MAX_STORED));
        assertEquals("999+", BadgeText.label(Integer.MAX_VALUE));
    }
}
