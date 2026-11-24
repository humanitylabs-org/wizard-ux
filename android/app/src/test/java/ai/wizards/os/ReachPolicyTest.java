package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import ai.wizards.os.ReachPolicy.Why;
import org.junit.Test;

public class ReachPolicyTest {
    @Test
    public void reasonFollowsNetworkThenTailscale() {
        assertEquals(Why.NO_NETWORK, ReachPolicy.why(false, false));
        assertEquals(Why.NO_NETWORK, ReachPolicy.why(false, true));
        assertEquals(Why.TAILSCALE_OFF, ReachPolicy.why(true, false));
        assertEquals(Why.NOT_ANSWERING, ReachPolicy.why(true, true));
    }

    @Test
    public void tailscaleOffOrOfflineSaysWhyAtOnce() {
        assertTrue(ReachPolicy.failNow(true, false));   // James's case: Wi-Fi up, Tailscale off
        assertTrue(ReachPolicy.failNow(false, false));
        assertFalse(ReachPolicy.failNow(true, true));   // Tailscale on: give it time, show Connecting
    }

    @Test
    public void onlyServerFailuresCountOnThePage() {
        assertTrue(ReachPolicy.httpFailure(502));
        assertTrue(ReachPolicy.httpFailure(503));
        assertTrue(ReachPolicy.httpFailure(504));
        assertFalse(ReachPolicy.httpFailure(200));
        assertFalse(ReachPolicy.httpFailure(304));
        assertFalse(ReachPolicy.httpFailure(403));  // a sign-in or access page is a real page
        assertFalse(ReachPolicy.httpFailure(404));
    }

    @Test
    public void networkChangeRetriesOnlyWhenItHelps() {
        assertTrue(ReachPolicy.retryOnChange(Why.TAILSCALE_OFF, Why.NOT_ANSWERING)); // Tailscale came on
        assertTrue(ReachPolicy.retryOnChange(Why.NO_NETWORK, Why.TAILSCALE_OFF));
        assertFalse(ReachPolicy.retryOnChange(Why.TAILSCALE_OFF, Why.NO_NETWORK));
        assertFalse(ReachPolicy.retryOnChange(Why.NOT_ANSWERING, Why.NOT_ANSWERING)); // signal-strength noise
    }

    @Test
    public void wordsNameTheFix() {
        assertEquals("Tailscale is off", ReachPolicy.title(Why.TAILSCALE_OFF));
        assertTrue(ReachPolicy.body(Why.TAILSCALE_OFF).contains("Turn Tailscale on"));
        assertTrue(ReachPolicy.body(Why.NO_NETWORK).contains("by itself"));
        assertTrue(ReachPolicy.body(Why.NOT_ANSWERING).contains("keeps trying"));
        for (Why w : Why.values()) assertFalse(ReachPolicy.title(w).isEmpty());
    }

    @Test
    public void openTailscaleOnlyWhenItCanHelp() {
        assertTrue(ReachPolicy.offerTailscale(Why.TAILSCALE_OFF, true));
        assertTrue(ReachPolicy.offerTailscale(Why.NOT_ANSWERING, true));
        assertFalse(ReachPolicy.offerTailscale(Why.TAILSCALE_OFF, false));
        assertFalse(ReachPolicy.offerTailscale(Why.NO_NETWORK, true));
    }

    @Test
    public void detailIsShort() {
        assertEquals("ERR_NAME_NOT_RESOLVED", ReachPolicy.detail("net::ERR_NAME_NOT_RESOLVED"));
        assertEquals("", ReachPolicy.detail(null));
        assertEquals(60, ReachPolicy.detail(new String(new char[200]).replace('\0', 'x')).length());
    }

    @Test
    public void anAnswerStopsConnecting() {
        // wizard-ux issue 1607: the Wizard answered the load being watched (always on since the switch was removed).
        assertTrue(ReachPolicy.answerDisarms(true, false, true));
        assertFalse(ReachPolicy.answerDisarms(false, false, true));  // about:blank, data: and file pages are not answers
        assertFalse(ReachPolicy.answerDisarms(true, true, true));    // this load already failed (5xx or error)
        assertFalse(ReachPolicy.answerDisarms(true, false, false));  // a late answer from another Wizard's address
    }

    @Test
    public void anAnswerHidesConnectingButNeverTheOfflineScreen() {
        assertTrue(ReachPolicy.answerHides(true, false));   // Connecting… up: it leaves
        assertFalse(ReachPolicy.answerHides(true, true));   // Can't reach / Retry: stays until a page paints
        assertFalse(ReachPolicy.answerHides(false, false));
    }

    @Test
    public void theGiveUpMarkStillEndsAnOpenThatNeverPaints() {
        // The answer only stops the connecting mark; GIVE_UP_MS is still the offline screen's time (MainActivity.answered).
        assertTrue(ReachPolicy.CONNECTING_MS < ReachPolicy.GIVE_UP_MS);
        assertEquals(10_000L, ReachPolicy.GIVE_UP_MS);
        assertEquals(1_200L, ReachPolicy.CONNECTING_MS);
    }
}
