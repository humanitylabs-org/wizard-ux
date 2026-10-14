package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import ai.wizards.os.device.WizardAddress;

public class OriginTest {
    static final String HOME = "wizard.example.ts.net";
    static final String OLD = "old-name.example.com";

    @Before public void connected() { WizardAddress.setForTest("https://" + HOME, OLD); }
    @After public void reset() { WizardAddress.setForTest(""); }

    @Test
    public void homeIsTheConfiguredName() {
        assertEquals(HOME, Origin.host());
        assertEquals("https://" + HOME, WizardAddress.origin());
        assertEquals("https://" + HOME + "/wizard-os-home/", WizardAddress.homeUrl());
    }

    @Test
    public void privateOriginOnly() {
        assertTrue(Origin.isPrivate("https", HOME, -1));
        assertTrue(Origin.isPrivate("https", HOME, 443));
        // The older name is still honoured (old links, notifications).
        assertTrue(Origin.isPrivate("https", OLD, -1));
        assertTrue(Origin.isPrivate("https", "OLD-name.example.com", 443));
        assertFalse(Origin.isPrivate("http", OLD, -1));
        assertFalse(Origin.isPrivate("http", HOME, -1));
        assertFalse(Origin.isPrivate("https", OLD + ".evil.test", -1));
        assertFalse(Origin.isPrivate("https", HOME + ".evil.test", -1));
        assertFalse(Origin.isPrivate("https", "evil-" + HOME, -1));
        assertFalse(Origin.isPrivate("https", "example.com", -1));
        assertFalse(Origin.isPrivate("https", "apps.example.com", -1));
        assertFalse(Origin.isPrivate("https", OLD, 8443));
        assertFalse(Origin.isPrivate("https", HOME, 8443));
        assertFalse(Origin.isPrivate("https", null, -1));
        assertFalse(Origin.isPrivate("https", "", -1));
    }

    @Test
    public void onlyTheOlderNameIsLegacy() {
        assertTrue(Origin.isLegacy("https", OLD, -1));
        assertFalse(Origin.isLegacy("https", HOME, -1));
        assertFalse(Origin.isLegacy("http", OLD, -1));
        assertFalse(Origin.isLegacy("https", OLD + ".evil.test", -1));
    }

    @Test
    public void olderNameMovesToTheSamePageOnTheOwnName() {
        assertEquals("https://" + HOME + "/wizard-os-home/?session=abc#x", Origin.toHome("https://" + OLD + "/wizard-os-home/?session=abc#x"));
        assertEquals("https://" + HOME + "/mizel-live/123", Origin.toHome("https://" + OLD + ":443/mizel-live/123"));
        assertEquals("https://" + HOME + "/", Origin.toHome("https://" + OLD));
        assertEquals("https://" + HOME + "/?q=1", Origin.toHome("https://" + OLD + "?q=1"));
        assertEquals("https://" + OLD + ".evil.test/x", Origin.toHome("https://" + OLD + ".evil.test/x"));
        assertEquals("https://" + HOME + "/wizard-os-home/", Origin.toHome("https://" + HOME + "/wizard-os-home/"));
        assertEquals("https://example.com/", Origin.toHome("https://example.com/"));
    }

    @Test
    public void safetyNetMovesTheSamePageBackToTheOlderName() {
        assertEquals("https://" + OLD + "/wizard-os-home/?session=abc#x", Origin.toLegacy("https://" + HOME + "/wizard-os-home/?session=abc#x"));
        assertEquals("https://" + OLD + "/mizel-live/1", Origin.toLegacy("https://" + HOME + ":443/mizel-live/1"));
        assertEquals("https://" + HOME + ".evil.test/x", Origin.toLegacy("https://" + HOME + ".evil.test/x"));
        assertEquals("https://example.com/", Origin.toLegacy("https://example.com/"));
        assertEquals("https://" + OLD + "/x", Origin.toLegacy("https://" + OLD + "/x"));
    }

    @Test
    public void withoutOlderNamesNothingMoves() {
        WizardAddress.setForTest("https://" + HOME);
        assertFalse(Origin.isPrivate("https", OLD, -1));
        assertFalse(Origin.isLegacy("https", OLD, -1));
        assertEquals("https://" + HOME + "/x", Origin.toLegacy("https://" + HOME + "/x"));
        assertEquals("https://" + OLD + "/x", Origin.toHome("https://" + OLD + "/x"));
    }

    @Test
    public void unconnectedPhoneTrustsNoOrigin() {
        WizardAddress.setForTest("");
        assertFalse(WizardAddress.configured());
        assertEquals("", Origin.host());
        assertEquals("", WizardAddress.homeUrl());
        assertFalse(Origin.isPrivate("https", HOME, -1));
        assertFalse(Origin.isPrivate("https", OLD, -1));
        assertFalse(Origin.isPrivate("https", "", -1));
        assertFalse(Origin.isLegacy("https", OLD, -1));
        assertEquals("https://" + OLD + "/x", Origin.toHome("https://" + OLD + "/x"));
        assertEquals("https://" + HOME + "/x", Origin.toLegacy("https://" + HOME + "/x"));
        assertTrue(WizardAddress.listenerOrigins(WizardAddress.origin()).isEmpty());
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
