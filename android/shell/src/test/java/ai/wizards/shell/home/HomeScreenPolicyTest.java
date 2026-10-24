package ai.wizards.shell.home;

import org.junit.Test;

import static org.junit.Assert.*;

public class HomeScreenPolicyTest {
    static final String W = "https://wizard.example:8444", PKG = "ai.wizards.shell.test";

    @Test public void appIdsAreRegistryIdsNeverUrls() {
        assertTrue(HomeScreenPolicy.validId("wisdom"));
        assertTrue(HomeScreenPolicy.validId("wizard-signal_2"));
        for (String bad : new String[]{null, "", "-x", "a/b", "a?b", "https://x", "a b", "a.b", new String(new char[97]).replace('\0', 'a')})
            assertFalse(bad, HomeScreenPolicy.validId(bad));
        assertTrue(HomeScreenPolicy.validRequest("12"));
        assertFalse(HomeScreenPolicy.validRequest("x1"));
        assertFalse(HomeScreenPolicy.validRequest("1234567890123"));
    }

    @Test public void identityIsPerWizardAndApp() {
        String a = HomeScreenPolicy.identity(W, "wisdom");
        assertTrue(a.matches("homeapp-[0-9a-f]{64}"));
        assertEquals(a, HomeScreenPolicy.identity(W, "wisdom"));
        assertNotEquals(a, HomeScreenPolicy.identity("https://other.example", "wisdom"));
        assertNotEquals(a, HomeScreenPolicy.identity(W, "files"));
        try { HomeScreenPolicy.identity(W, "../x"); fail(); } catch (IllegalArgumentException expected) { }
        try { HomeScreenPolicy.identity(null, "x"); fail(); } catch (IllegalArgumentException expected) { }
    }

    @Test public void taskUriRoundTripsOnlyForTheSelectedWizard() {
        String t = HomeScreenPolicy.taskUri(PKG, W, "wisdom");
        assertEquals("wisdom", HomeScreenPolicy.appFromTask(t, PKG, W));
        assertNull("another Wizard's shortcut", HomeScreenPolicy.appFromTask(t, PKG, "https://other.example"));
        assertNull("another package", HomeScreenPolicy.appFromTask(t, "ai.wizards.shell", W));
        assertNull("edited app", HomeScreenPolicy.appFromTask(t.replace("app=wisdom", "app=files"), PKG, W));
        assertNull(HomeScreenPolicy.appFromTask(t + "&x=1", PKG, W));
        assertNull(HomeScreenPolicy.appFromTask("wizard-homeapp://" + PKG + "/x?app=wisdom", PKG, W));
        assertNull(HomeScreenPolicy.appFromTask(null, PKG, W));
        assertNull("no Wizard chosen", HomeScreenPolicy.appFromTask(t, PKG, null));
    }

    @Test public void sessionUrlOpensTheShellForJustThatApp() {
        assertEquals(W + "/wizard-os-home/?app-session=wisdom", HomeScreenPolicy.sessionUrl(W, "wisdom"));
        assertNull(HomeScreenPolicy.sessionUrl(W, "a/b"));
        assertNull(HomeScreenPolicy.sessionUrl(null, "wisdom"));
    }

    @Test public void onlyTheSelectedWizardsOwnShellMayPin() {
        assertTrue(HomeScreenPolicy.shellPage(W, W + "/wizard-os-home/"));
        assertTrue(HomeScreenPolicy.shellPage(W, W + "/wizard-os-home/index.html?open=x"));
        assertFalse("a pinned app's session", HomeScreenPolicy.shellPage(W, W + "/wizard-os-home/?app-session=wisdom"));
        assertFalse("hosted app page", HomeScreenPolicy.shellPage(W, W + "/wisdom/"));
        assertFalse("other port", HomeScreenPolicy.shellPage(W, "https://wizard.example/wizard-os-home/"));
        assertFalse("other host", HomeScreenPolicy.shellPage(W, "https://evil.example:8444/wizard-os-home/"));
        assertFalse("http", HomeScreenPolicy.shellPage(W, "http://wizard.example:8444/wizard-os-home/"));
        assertFalse(HomeScreenPolicy.shellPage(W, null));
    }

    @Test public void aPinnedAppStaysOnItsOwnSession() {
        String s = W + "/wizard-os-home/?app-session=wisdom";
        assertTrue(HomeScreenPolicy.sessionPage(W, s, "wisdom"));
        assertTrue(HomeScreenPolicy.sessionPage(W, W + "/wizard-os-home/index.html?app-session=wisdom", "wisdom"));
        assertFalse("another app", HomeScreenPolicy.sessionPage(W, s, "files"));
        assertFalse("the whole Wizard", HomeScreenPolicy.sessionPage(W, W + "/wizard-os-home/", "wisdom"));
        assertFalse("repeated parameter", HomeScreenPolicy.sessionPage(W, s + "&app-session=files", "wisdom"));
        assertFalse("other Wizard", HomeScreenPolicy.sessionPage(W, "https://other.example/wizard-os-home/?app-session=wisdom", "wisdom"));
        assertFalse(HomeScreenPolicy.sessionPage(W, W + "/wisdom/", "wisdom"));
    }

    @Test public void labelsAndIconsAreBounded() {
        assertTrue(HomeScreenPolicy.validLabel("Wisdom"));
        assertFalse(HomeScreenPolicy.validLabel("  "));
        assertFalse(HomeScreenPolicy.validLabel(new String(new char[81]).replace('\0', 'a')));
        assertTrue(HomeScreenPolicy.validIconData("data:image/png;base64,AAAA"));
        assertFalse(HomeScreenPolicy.validIconData("data:image/svg+xml;base64,AAAA"));
        assertFalse(HomeScreenPolicy.validIconData("data:image/png;base64," + new String(new char[90000]).replace('\0', 'A')));
        assertTrue(HomeScreenPolicy.validIconSize(192, 192));
        assertFalse(HomeScreenPolicy.validIconSize(47, 192));
        assertFalse(HomeScreenPolicy.validIconSize(192, 257));
        assertEquals("Signal", HomeScreenPolicy.displayName("wizard-signal", "Wizard Signal"));
        assertEquals("Wisdom", HomeScreenPolicy.displayName("wisdom", "Wisdom"));
    }

    @Test public void tapGateNeedsOneFreshStillTap() {
        HomeScreenPolicy.TapGate g = new HomeScreenPolicy.TapGate(8);
        assertEquals("no tap yet", -1, g.claim(100));
        g.down(10, 10); g.move(12, 12); g.up(1000);
        long c = g.claim(1200);
        assertTrue(c >= 0);
        assertTrue(g.current(c));
        assertEquals("one claim per tap", -1, g.claim(1201));
        g.down(10, 10); assertFalse("a newer touch invalidates the claim", g.current(c));
        g.move(40, 40); g.up(2000);
        assertEquals("a drag is not a tap", -1, g.claim(2001));
        g.down(0, 0); g.up(3000);
        assertEquals("stale after 1.5 s", -1, g.claim(4501));
        g.down(0, 0); g.cancel(); g.up(5000);
        assertEquals("cancelled", -1, g.claim(5001));
    }
}
