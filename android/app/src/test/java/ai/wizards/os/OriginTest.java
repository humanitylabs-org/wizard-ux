package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class OriginTest {
    static final String HOME = "wizard.tail1234.ts.net";

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
        // The retired name is still honoured (old links, notifications).
        assertTrue(Origin.isPrivate("https", "legacy.wizard.example", -1));
        assertTrue(Origin.isPrivate("https", "PRIVATE.wizard.example", 443));
        assertFalse(Origin.isPrivate("http", "legacy.wizard.example", -1));
        assertFalse(Origin.isPrivate("http", HOME, -1));
        assertFalse(Origin.isPrivate("https", "legacy.wizard.example.evil.test", -1));
        assertFalse(Origin.isPrivate("https", HOME + ".evil.test", -1));
        assertFalse(Origin.isPrivate("https", "evil-" + HOME, -1));
        assertFalse(Origin.isPrivate("https", "wizard.example", -1));
        assertFalse(Origin.isPrivate("https", "apps.wizard.example", -1));
        assertFalse(Origin.isPrivate("https", "legacy.wizard.example", 8443));
        assertFalse(Origin.isPrivate("https", HOME, 8443));
        assertFalse(Origin.isPrivate("https", null, -1));
    }

    @Test
    public void onlyTheRetiredNameIsLegacy() {
        assertTrue(Origin.isLegacy("https", "legacy.wizard.example", -1));
        assertFalse(Origin.isLegacy("https", HOME, -1));
        assertFalse(Origin.isLegacy("http", "legacy.wizard.example", -1));
        assertFalse(Origin.isLegacy("https", "legacy.wizard.example.evil.test", -1));
    }

    @Test
    public void retiredNameMovesToTheSamePageOnTheTailnetName() {
        assertEquals("https://" + HOME + "/wizard-os-home/?session=abc#x", Origin.toHome("https://legacy.wizard.example/wizard-os-home/?session=abc#x"));
        assertEquals("https://" + HOME + "/mizel-live/123", Origin.toHome("https://legacy.wizard.example:443/mizel-live/123"));
        assertEquals("https://" + HOME + "/", Origin.toHome("https://legacy.wizard.example"));
        assertEquals("https://" + HOME + "/?q=1", Origin.toHome("https://legacy.wizard.example?q=1"));
        assertEquals("https://legacy.wizard.example.evil.test/x", Origin.toHome("https://legacy.wizard.example.evil.test/x"));
        assertEquals("https://" + HOME + "/wizard-os-home/", Origin.toHome("https://" + HOME + "/wizard-os-home/"));
        assertEquals("https://example.com/", Origin.toHome("https://example.com/"));
    }

    @Test
    public void safetyNetMovesTheSamePageBackToTheRetiredName() {
        assertEquals("https://legacy.wizard.example/wizard-os-home/?session=abc#x", Origin.toLegacy("https://" + HOME + "/wizard-os-home/?session=abc#x"));
        assertEquals("https://legacy.wizard.example/mizel-live/1", Origin.toLegacy("https://" + HOME + ":443/mizel-live/1"));
        assertEquals("https://" + HOME + ".evil.test/x", Origin.toLegacy("https://" + HOME + ".evil.test/x"));
        assertEquals("https://example.com/", Origin.toLegacy("https://example.com/"));
        assertEquals("https://legacy.wizard.example/x", Origin.toLegacy("https://legacy.wizard.example/x"));
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
