package ai.wizards.os.mizel;

import org.junit.Test;
import static org.junit.Assert.*;

public class MeetingBorrowTest {
    @Test public void userPauseDuringLoanOverridesAutomaticResume() {
        MeetingBorrow b = new MeetingBorrow("event-123", "meeting-1", false, 1200, 100);
        assertTrue(b.shouldResume());
        b.userPause();
        assertTrue(b.userPaused());
        assertFalse(b.shouldResume());
        assertTrue(b.close("event-123"));
        assertFalse(b.shouldResume());
    }
    @Test public void requiresExactIdentityAndReleasedMic() {
        MeetingBorrow b = new MeetingBorrow("event-123", "meeting-1", false, 1200, 100);
        assertFalse(b.permits("other", "meeting-1", true, true));
        assertFalse(b.permits("event-123", "meeting-2", true, true));
        assertFalse(b.permits("event-123", "meeting-1", false, true));
        assertFalse(b.permits("event-123", "meeting-1", true, false));
        assertTrue(b.permits("event-123", "meeting-1", true, true));
    }
    @Test public void takeIsBoundExactlyOnce() {
        MeetingBorrow b = new MeetingBorrow("event-123", "meeting-1", false, 1200, 100);
        assertFalse(b.bind("wrong", "voice-1"));
        assertTrue(b.bind("event-123", "voice-1"));
        assertFalse(b.bind("event-123", "voice-2"));
        assertFalse(b.permits("event-123", "meeting-1", true, true));
        assertEquals("voice-1", b.take());
    }
    @Test public void manualPauseDoesNotGainAutoResume() {
        assertFalse(new MeetingBorrow("event-123", "meeting-1", true, 1200, 100).resumeAfter);
        assertTrue(new MeetingBorrow("event-123", "meeting-1", false, 1200, 100).resumeAfter);
    }
    @Test public void closedAuthorityCannotBeReplayed() {
        MeetingBorrow b = new MeetingBorrow("event-123", "meeting-1", false, 1200, 100);
        assertFalse(b.close("wrong"));
        assertTrue(b.close("event-123"));
        assertFalse(b.close("event-123"));
        assertFalse(b.open());
        assertFalse(b.bind("event-123", "voice-1"));
        assertFalse(b.permits("event-123", "meeting-1", true, true));
    }
}
