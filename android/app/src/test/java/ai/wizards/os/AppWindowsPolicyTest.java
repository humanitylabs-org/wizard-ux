package ai.wizards.os;

import org.junit.Test;
import static org.junit.Assert.*;

/** App windows (wizard-os issue 650): what a link may open and when. */
public class AppWindowsPolicyTest {
    @Test public void appStartAndPagesInsideAnAppAreKept() {
        assertEquals("", AppWindowsPolicy.path(null));
        assertEquals("", AppWindowsPolicy.path(""));
        assertEquals("/wizard-health/", AppWindowsPolicy.path("/wizard-health/"));
        assertEquals("/wizard-health/day?d=2026-11-17#sleep", AppWindowsPolicy.path("/wizard-health/day?d=2026-11-17#sleep"));
        assertEquals("/messenger/chat/a%20b?x=%2F", AppWindowsPolicy.path("/messenger/chat/a%20b?x=%2F")); // encoded only in the query
    }

    @Test public void otherHostsSchemesAndTrickyPathsAreRefused() {
        assertNull(AppWindowsPolicy.path("https://elsewhere.example/app/"));
        assertNull(AppWindowsPolicy.path("//elsewhere.example/app/"));
        assertNull(AppWindowsPolicy.path("javascript:alert(1)"));
        assertNull(AppWindowsPolicy.path("wizard-health/"));
        assertNull(AppWindowsPolicy.path("/app\\..\\wizard-os-home/"));
        assertNull(AppWindowsPolicy.path("/app/%2e%2e/wizard-os-home/"));
        assertNull(AppWindowsPolicy.path("/app/%2F..%2Fx"));
        assertNull(AppWindowsPolicy.path("/app/%252e"));
        assertNull(AppWindowsPolicy.path("/app/../wizard-os-home/"));
        assertNull(AppWindowsPolicy.path("/app/./x"));
        assertNull(AppWindowsPolicy.path("/app/ x"));
        assertNull(AppWindowsPolicy.path("/app/\nx"));
        StringBuilder long_ = new StringBuilder("/app/");
        while (long_.length() <= 2048) long_.append('a');
        assertNull(AppWindowsPolicy.path(long_.toString()));
    }

    @Test public void wizardsOwnPagesStayInTheMainWindow() {
        assertNull(AppWindowsPolicy.path("/wizard-os-home/"));
        assertNull(AppWindowsPolicy.path("/wizard-os-home"));
        assertNull(AppWindowsPolicy.path("/wizard-os-home/?open=wizard-health"));
        assertNull(AppWindowsPolicy.path("/wizard-os-home-next/index.html"));
        assertEquals("/wizard-os-homework/", AppWindowsPolicy.path("/wizard-os-homework/"));
    }

    @Test public void onlyRightAfterATapOrOnceAfterALinkIntent() {
        assertFalse("boot is not a tap", AppWindowsPolicy.admitted(10_000, 0, 0, 0));
        assertTrue(AppWindowsPolicy.admitted(10_000, 9_000, 0, 0));
        assertTrue(AppWindowsPolicy.admitted(10_000, 10_000 - AppWindowsPolicy.TAP_MS, 0, 0));
        assertFalse("a stale tap", AppWindowsPolicy.admitted(10_000, 10_000 - AppWindowsPolicy.TAP_MS - 1, 0, 0));
        assertFalse("a clock going back", AppWindowsPolicy.admitted(10_000, 11_000, 0, 0));
        assertTrue("a notification's link", AppWindowsPolicy.admitted(30_000, 0, 15_000, 0));
        assertFalse(AppWindowsPolicy.admitted(40_000, 0, 15_000, 0));
    }

    @Test public void oneTapOpensOneWindow() {
        assertFalse(AppWindowsPolicy.admitted(10_000, 9_900, 0, 9_950));
        assertTrue(AppWindowsPolicy.admitted(10_000, 9_900, 0, 10_000 - AppWindowsPolicy.REPEAT_MS));
    }

    @Test public void recentsNameIsPlainAndShort() {
        assertEquals("", AppWindowsPolicy.name(null));
        assertEquals("Health", AppWindowsPolicy.name("  Health\n"));
        assertEquals("A B", AppWindowsPolicy.name("A\u0007B"));
        StringBuilder n = new StringBuilder();
        for (int i = 0; i < 100; i++) n.append('x');
        assertEquals(80, AppWindowsPolicy.name(n.toString()).length());
    }
}
