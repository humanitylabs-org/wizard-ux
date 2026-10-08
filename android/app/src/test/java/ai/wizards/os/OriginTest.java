package ai.wizards.os;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class OriginTest {
    @Test
    public void privateOriginOnly() {
        assertTrue(Origin.isPrivate("https", "private.wizard001.com", -1));
        assertTrue(Origin.isPrivate("https", "PRIVATE.wizard001.com", 443));
        assertFalse(Origin.isPrivate("http", "private.wizard001.com", -1));
        assertFalse(Origin.isPrivate("https", "private.wizard001.com.evil.test", -1));
        assertFalse(Origin.isPrivate("https", "wizard001.com", -1));
        assertFalse(Origin.isPrivate("https", "private.wizard001.com", 8443));
        assertFalse(Origin.isPrivate("https", null, -1));
    }

    @Test
    public void shellPaths() {
        assertTrue(Origin.isShellPath("/wizard-os-home/"));
        assertTrue(Origin.isShellPath("/wizard-os-home"));
        assertTrue(Origin.isShellPath("/wizard-os-home/?desk=2"));
        assertFalse(Origin.isShellPath("/wizard-os-home-preview/"));
        assertFalse(Origin.isShellPath("/wizard/"));
    }
}
