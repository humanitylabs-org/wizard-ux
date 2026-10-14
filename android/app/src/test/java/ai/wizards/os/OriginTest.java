package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class OriginTest {
    static final String HOME = java.net.URI.create(BuildConfig.ORIGIN).getHost();
    static final String PRODUCTION_HOME = "wizard.tailc0f369.ts.net";

    @Test
    public void homeMatchesItsConfiguredBuildOrigin() {
        assertEquals(HOME, Origin.HOST);
        assertEquals("https://" + HOME, BuildConfig.ORIGIN);
        assertEquals("https://" + HOME + "/wizard-os-home/", BuildConfig.HOME_URL);
        if ("preview".equals(BuildConfig.BUILD_TYPE)) {
            assertEquals("home-screen-apps.staging.wizard001.com", HOME);
            assertFalse(Origin.isPrivate("https", PRODUCTION_HOME, -1));
        } else {
            assertEquals(PRODUCTION_HOME, HOME);
        }
    }

    @Test
    public void privateOriginOnly() {
        assertTrue(Origin.isPrivate("https", HOME, -1));
        assertTrue(Origin.isPrivate("https", HOME, 443));
        // The retired name is still honoured (old links, notifications).
        assertTrue(Origin.isPrivate("https", "private.wizard001.com", -1));
        assertTrue(Origin.isPrivate("https", "PRIVATE.wizard001.com", 443));
        assertFalse(Origin.isPrivate("http", "private.wizard001.com", -1));
        assertFalse(Origin.isPrivate("http", HOME, -1));
        assertFalse(Origin.isPrivate("https", "private.wizard001.com.evil.test", -1));
        assertFalse(Origin.isPrivate("https", HOME + ".evil.test", -1));
        assertFalse(Origin.isPrivate("https", "evil-" + HOME, -1));
        assertFalse(Origin.isPrivate("https", "wizard001.com", -1));
        assertFalse(Origin.isPrivate("https", "apps.wizard001.com", -1));
        assertFalse(Origin.isPrivate("https", "private.wizard001.com", 8443));
        assertFalse(Origin.isPrivate("https", HOME, 8443));
        assertFalse(Origin.isPrivate("https", null, -1));
    }

    @Test
    public void onlyTheRetiredNameIsLegacy() {
        assertTrue(Origin.isLegacy("https", "private.wizard001.com", -1));
        assertFalse(Origin.isLegacy("https", HOME, -1));
        assertFalse(Origin.isLegacy("http", "private.wizard001.com", -1));
        assertFalse(Origin.isLegacy("https", "private.wizard001.com.evil.test", -1));
    }

    @Test
    public void retiredNameMovesToTheSamePageOnTheTailnetName() {
        assertEquals("https://" + HOME + "/wizard-os-home/?session=abc#x", Origin.toHome("https://private.wizard001.com/wizard-os-home/?session=abc#x"));
        assertEquals("https://" + HOME + "/mizel-live/123", Origin.toHome("https://private.wizard001.com:443/mizel-live/123"));
        assertEquals("https://" + HOME + "/", Origin.toHome("https://private.wizard001.com"));
        assertEquals("https://" + HOME + "/?q=1", Origin.toHome("https://private.wizard001.com?q=1"));
        assertEquals("https://private.wizard001.com.evil.test/x", Origin.toHome("https://private.wizard001.com.evil.test/x"));
        assertEquals("https://" + HOME + "/wizard-os-home/", Origin.toHome("https://" + HOME + "/wizard-os-home/"));
        assertEquals("https://example.com/", Origin.toHome("https://example.com/"));
    }

    @Test
    public void safetyNetMovesTheSamePageBackToTheRetiredName() {
        assertEquals("https://private.wizard001.com/wizard-os-home/?session=abc#x", Origin.toLegacy("https://" + HOME + "/wizard-os-home/?session=abc#x"));
        assertEquals("https://private.wizard001.com/mizel-live/1", Origin.toLegacy("https://" + HOME + ":443/mizel-live/1"));
        assertEquals("https://" + HOME + ".evil.test/x", Origin.toLegacy("https://" + HOME + ".evil.test/x"));
        assertEquals("https://example.com/", Origin.toLegacy("https://example.com/"));
        assertEquals("https://private.wizard001.com/x", Origin.toLegacy("https://private.wizard001.com/x"));
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

    @Test
    public void carryAcceptsOnlyAJsonObject() {
        assertTrue(Carry.looksLikeObject("{\"v\":1}"));
        assertFalse(Carry.looksLikeObject(null));
        assertFalse(Carry.looksLikeObject("[1]"));
        assertFalse(Carry.looksLikeObject("\"x\""));
        assertEquals("/wizard-os-home/carry.html", Carry.PAGE);
    }
}
