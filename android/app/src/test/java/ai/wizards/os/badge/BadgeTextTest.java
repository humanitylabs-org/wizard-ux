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
}
