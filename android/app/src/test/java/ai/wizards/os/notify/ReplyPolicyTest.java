package ai.wizards.os.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ReplyPolicyTest {
    @Test
    public void settledStates() {
        for (String s : new String[]{"completed", "failed", "cancelled", "stopped", "interrupted"}) assertTrue(s, ReplyPolicy.settled(s));
        for (String s : new String[]{"queued", "running", "waiting_for_approval", "", null}) assertFalse(String.valueOf(s), ReplyPolicy.settled(s));
    }

    /* wizard-os#648: every watch was read every 5 s in the background, a Snooze for up to 400 days. */
    @Test
    public void snoozeIsNotReadBeforeItsReturnTime() {
        long now = 1_000_000_000L, due = now + 3 * 86_400_000L;
        assertEquals(due - now, ReplyPolicy.waitMs(true, false, now, due, 0, now, false));
        assertEquals(due - now, ReplyPolicy.waitMs(true, false, now, due, now - 1, now, false));
        // Once due it is read now, then every 15 s while the scheduler catches up, then every 5 minutes.
        assertEquals(0, ReplyPolicy.waitMs(true, false, now, now, 0, now, false));
        assertEquals(15_000, ReplyPolicy.waitMs(true, false, now, now, now, now, false));
        assertEquals(5 * 60_000L, ReplyPolicy.interval(true, false, 0, now - 31 * 60_000L, now, false));
        // A Snooze from a page that did not say when: every 5 minutes, never every 5 s.
        assertEquals(5 * 60_000L, ReplyPolicy.waitMs(true, false, now, 0, now, now, false));
    }

    @Test
    public void replyInFlightBacksOffWithAge() {
        long now = 1_000_000_000L;
        assertEquals(0, ReplyPolicy.waitMs(false, false, now, 0, 0, now, false));
        assertEquals(5_000, ReplyPolicy.interval(false, false, now - 60_000, 0, now, false));
        assertEquals(8_000, ReplyPolicy.interval(false, false, now - 60_000, 0, now, true));
        assertEquals(30_000, ReplyPolicy.interval(false, false, now - 20 * 60_000L, 0, now, false));
        assertEquals(120_000, ReplyPolicy.interval(false, false, now - 2 * 3_600_000L, 0, now, false));
        assertEquals(60_000, ReplyPolicy.interval(false, true, now - 60_000, 0, now, false));
        assertEquals(2_000, ReplyPolicy.waitMs(false, false, now - 60_000, 0, now - 3_000, now, false));
    }

    @Test
    public void loopDelayIsBounded() {
        assertEquals(5_000, ReplyPolicy.nextDelay(0));
        assertEquals(30_000, ReplyPolicy.nextDelay(30_000));
        assertEquals(3_600_000L, ReplyPolicy.nextDelay(3 * 86_400_000L));
    }

    @Test
    public void excerptStripsMarkdownAndClips() {
        assertEquals("Done. See the report and the list item", ReplyPolicy.excerpt("## Done.\n\nSee **the** [report](https://x) and\n- the list item"));
        String long_ = "word ".repeat(100);
        String e = ReplyPolicy.excerpt(long_);
        assertTrue(e.length() <= 281);
        assertTrue(e.endsWith("…"));
        assertEquals("", ReplyPolicy.excerpt(null));
    }
}
