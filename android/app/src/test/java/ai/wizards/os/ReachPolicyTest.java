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

    /** Replays one load's timeline the way MainActivity runs it: each entry is a try that fails fast at its time (ms
     *  since the load began) or, the last one, succeeds; returns when the offline screen showed (-1: never). */
    private static long offlineAt(Why why, long[] failAt, long okAt) {
        long t = 0; int tries = 0;
        for (long f : failAt) {
            t = Math.max(t, f);
            if (t >= ReachPolicy.GIVE_UP_MS) return ReachPolicy.GIVE_UP_MS; // the give-up mark came first
            if (!ReachPolicy.retryQuietly(why, t, false)) return t;
            t += ReachPolicy.quietRetryDelay(tries++);
        }
        return okAt >= 0 && Math.max(t, okAt) < ReachPolicy.GIVE_UP_MS ? -1 : ReachPolicy.GIVE_UP_MS;
    }

    @Test
    public void aFastFailureWithTailscaleOnRetriesQuietlyAndNeverFlashesTheGuide() {
        // wizard-ux issue 2008 (James, Android): Tailscale on, the tunnel still waking after resume. The first try fails
        // in 300 ms, the next one reaches the Wizard: no guide at all, Connecting at most.
        assertEquals(-1, offlineAt(Why.NOT_ANSWERING, new long[]{ 300 }, 1_800));
        assertEquals(-1, offlineAt(Why.NOT_ANSWERING, new long[]{ 300, 800, 1_700 }, 4_000));
        // A 502 while the Wizard restarts is the same: quiet tries until it answers.
        assertTrue(ReachPolicy.retryQuietly(Why.NOT_ANSWERING, 50, false));
    }

    @Test
    public void aWizardThatNeverAnswersStillShowsTheGuideAtTheGiveUpMark() {
        long[] fails = new long[40];
        for (int i = 0; i < fails.length; i++) fails[i] = 100L + i * 10L;
        assertEquals(ReachPolicy.GIVE_UP_MS, offlineAt(Why.NOT_ANSWERING, fails, -1));
        assertFalse("past the give-up mark: show it", ReachPolicy.retryQuietly(Why.NOT_ANSWERING, ReachPolicy.GIVE_UP_MS, false));
        assertFalse("no known start: as before", ReachPolicy.retryQuietly(Why.NOT_ANSWERING, -5, false));
        // The waits back off and never pass the give-up mark on their own.
        long sum = 0;
        for (int i = 0; i < ReachPolicy.QUIET_RETRY_MS.length; i++) {
            assertTrue(ReachPolicy.quietRetryDelay(i) >= ReachPolicy.quietRetryDelay(Math.max(0, i - 1)));
            sum += ReachPolicy.quietRetryDelay(i);
        }
        assertTrue(sum < ReachPolicy.GIVE_UP_MS);
        assertEquals(ReachPolicy.QUIET_RETRY_MS[ReachPolicy.QUIET_RETRY_MS.length - 1], ReachPolicy.quietRetryDelay(99));
    }

    @Test
    public void noNetworkTailscaleOffOrTheScreenAlreadyUpStillSayItAtOnce() {
        assertEquals(300, offlineAt(Why.TAILSCALE_OFF, new long[]{ 300 }, 1_800));
        assertEquals(300, offlineAt(Why.NO_NETWORK, new long[]{ 300 }, 1_800));
        assertFalse("the offline screen's own retries keep it up", ReachPolicy.retryQuietly(Why.NOT_ANSWERING, 300, true));
    }
}
