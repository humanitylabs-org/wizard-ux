package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class OriginTest {
    static final String HOME = "wizard.tailc0f369.ts.net";

    @Test
    public void homeIsTheTailnetName() {
        assertEquals(HOME, Origin.HOST);
        assertEquals("https://" + HOME, BuildConfig.ORIGIN);
        assertEquals("https://" + HOME + "/wizard-os-home/", BuildConfig.HOME_URL);
    }

    @Test
    public void privateOriginOnly() {
        assertTrue(Origin.isPrivate("https", HOME, -1));
        assertTrue(Origin.isPrivate("https", HOME, 443));
        assertFalse(Origin.isPrivate("https", "retired.example", -1)); // retired name: no longer honoured
        assertFalse(Origin.isPrivate("http", HOME, -1));
        assertFalse(Origin.isPrivate("https", HOME + ".evil.test", -1));
        assertFalse(Origin.isPrivate("https", "evil-" + HOME, -1));
        assertFalse(Origin.isPrivate("https", HOME, 8443));
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

    @Test
    public void inAppPaths() {
        assertTrue(Origin.isInAppPath("/wizard-os-home/"));
        assertTrue(Origin.isInAppPath("/mizel-live/"));
        assertTrue(Origin.isInAppPath("/mizel-live"));
        assertFalse(Origin.isInAppPath("/mizel-live-evil/"));
        assertFalse(Origin.isInAppPath("/meetings/"));
        assertFalse(Origin.isInAppPath("/"));
    }
}
