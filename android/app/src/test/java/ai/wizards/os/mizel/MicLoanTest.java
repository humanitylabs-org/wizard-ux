package ai.wizards.os.mizel;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

import ai.wizards.os.MicOwner;

/** The floating orb / side button borrowing the one microphone from a recording meeting, and giving it back. */
public class MicLoanTest {
    /** Mirrors MeetingRecorderService's loan semantics with the real MeetingBorrow policy. */
    static final class FakeMeeting implements MicLoan.Meeting {
        String id = "mt_qa";
        boolean recording = true, paused, stopped, refuseBegin, refuseBind;
        MeetingBorrow borrow;
        final List<String> ends = new ArrayList<>();

        FakeMeeting start() { assertTrue(MicOwner.tryAcquire(MicOwner.MEETING)); return this; }
        void userPause() { if (borrow != null && borrow.open()) borrow.userPause(); if (!paused) { paused = true; MicOwner.release(MicOwner.MEETING); } }
        void stop() { stopped = true; recording = false; if (borrow != null && borrow.open()) borrow.close(borrow.eventId); MicOwner.release(MicOwner.MEETING); }

        @Override public String liveMeetingId() { return stopped ? null : id; }
        @Override public boolean begin(String eventId, String meetingId) {
            if (refuseBegin || stopped || !id.equals(meetingId) || (borrow != null && borrow.open())) return false;
            boolean was = paused;
            paused = true; MicOwner.release(MicOwner.MEETING); // capture joined, chunk flushed, AudioRecord released
            borrow = new MeetingBorrow(eventId, meetingId, was, 1234, 1);
            return borrow.permits(eventId, meetingId, true, MicOwner.holder() == null);
        }
        @Override public boolean bind(String eventId, String takeId) { return !refuseBind && borrow.bind(eventId, takeId); }
        @Override public String end(String eventId, String outcome) {
            ends.add(outcome);
            if (borrow == null || !borrow.eventId.equals(eventId)) return null;
            if (borrow.open()) {
                if (MicOwner.holder() != null) return null; // the borrower must have let go first
                borrow.close(eventId);
                if (borrow.shouldResume() && !stopped && paused && MicOwner.tryAcquire(MicOwner.MEETING)) paused = false;
            }
            return stopped ? "stopped" : paused ? "paused" : "recording";
        }
    }

    @Before
    public void reset() {
        for (String w : new String[]{MicOwner.MEETING, MicOwner.EVERYWHERE, MicOwner.SIDE, MicOwner.ORB}) MicOwner.release(w);
        MicLoan.resetForTest();
    }

    @Test
    public void meetingLendsTheMicToTheFloatingOrbAndGetsItBack() {
        FakeMeeting m = new FakeMeeting().start();
        MicLoan l = MicLoan.acquire(m, MicOwner.EVERYWHERE, "wos-dict-1", "orb-event-1");
        assertNotNull(l);
        assertTrue(l.borrowed);
        assertEquals("one physical owner: the orb now holds it", MicOwner.EVERYWHERE, MicOwner.holder());
        assertTrue("meeting paused while the orb records", m.paused);
        assertEquals("wos-dict-1", m.borrow.take());
        assertFalse("the meeting cannot resume while the orb holds the mic", MicOwner.tryAcquire(MicOwner.MEETING));
        assertEquals("recording", l.release(m, "stopped"));
        assertEquals("mic back with the meeting", MicOwner.MEETING, MicOwner.holder());
        assertFalse(m.paused);
    }

    @Test
    public void noteEngineCanReleaseHardwareBeforeReturningTheMeeting() {
        FakeMeeting m = new FakeMeeting().start();
        MicLoan l = MicLoan.acquire(m, MicOwner.EVERYWHERE, "take", "note-event");
        l.releaseMic(); l.releaseMic();
        assertNull(MicOwner.holder());
        assertTrue("the controller still owns the meeting loan", m.paused);
        assertEquals("recording", l.release(m, "stopped"));
        assertEquals(MicOwner.MEETING, MicOwner.holder());
        assertEquals(1, m.ends.size());
    }

    @Test
    public void sideButtonGetsTheSameContract() {
        FakeMeeting m = new FakeMeeting().start();
        MicLoan l = MicLoan.acquire(m, MicOwner.SIDE, "wos-side-1", "orb-event-side");
        assertNotNull(l);
        assertEquals(MicOwner.SIDE, MicOwner.holder());
        l.release(m, "cancelled");
        assertEquals(MicOwner.MEETING, MicOwner.holder());
        assertEquals("cancel resumes too", false, m.paused);
    }

    @Test
    public void meetingPausedBeforeTheLoanStaysPaused() {
        FakeMeeting m = new FakeMeeting().start();
        m.userPause();
        MicLoan l = MicLoan.acquire(m, MicOwner.EVERYWHERE, "wos-ev-1", "orb-event-2");
        assertTrue("still a marked interruption", l.borrowed);
        assertEquals("paused", l.release(m, "stopped"));
        assertTrue(m.paused);
        assertNull("nobody holds the mic", MicOwner.holder());
    }

    @Test
    public void pauseDuringTheLoanWins() {
        FakeMeeting m = new FakeMeeting().start();
        MicLoan l = MicLoan.acquire(m, MicOwner.EVERYWHERE, "wos-ev-2", "orb-event-3");
        m.userPause();
        assertEquals("paused", l.release(m, "stopped"));
        assertNull(MicOwner.holder());
    }

    @Test
    public void meetingStoppedDuringTheLoanIsNeverRestarted() {
        FakeMeeting m = new FakeMeeting().start();
        MicLoan l = MicLoan.acquire(m, MicOwner.EVERYWHERE, "wos-ev-3", "orb-event-4");
        m.stop();
        assertEquals("stopped", l.release(m, "stopped"));
        assertNull("nothing reopened the mic", MicOwner.holder());
        assertFalse(m.recording);
    }

    @Test
    public void releaseIsIdempotentAndEndsTheLoanOnce() {
        FakeMeeting m = new FakeMeeting().start();
        MicLoan l = MicLoan.acquire(m, MicOwner.EVERYWHERE, "wos-ev-4", "orb-event-5");
        l.release(m, "mic_lost");
        l.release(m, "stopped");
        assertEquals(1, m.ends.size());
        assertEquals("mic_lost", m.ends.get(0));
        assertTrue(l.ended());
    }

    @Test
    public void refusedLoanLeavesTheMeetingRecording() {
        FakeMeeting m = new FakeMeeting().start();
        m.refuseBegin = true;
        assertNull(MicLoan.acquire(m, MicOwner.EVERYWHERE, "wos-ev-5", "orb-event-6"));
        assertTrue(MicLoan.refusal().contains("couldn’t pause"));
        assertEquals(MicOwner.MEETING, MicOwner.holder());
        assertFalse(m.paused);
    }

    @Test
    public void failedBindGivesTheMicStraightBack() {
        FakeMeeting m = new FakeMeeting().start();
        m.refuseBind = true;
        assertNull(MicLoan.acquire(m, MicOwner.EVERYWHERE, "wos-ev-6", "orb-event-7"));
        assertEquals(MicOwner.MEETING, MicOwner.holder());
        assertFalse(m.paused);
        assertEquals("start_failed", m.ends.get(0));
    }

    @Test
    public void noMeetingMeansAPlainTake() {
        FakeMeeting m = new FakeMeeting();
        m.stopped = true;
        MicLoan l = MicLoan.acquire(m, MicOwner.EVERYWHERE, "wos-ev-7", "orb-event-8");
        assertNotNull(l);
        assertFalse(l.borrowed);
        assertEquals(MicOwner.EVERYWHERE, MicOwner.holder());
        assertNull(l.release(m, "stopped"));
        assertTrue("no meeting call without a loan", m.ends.isEmpty());
        assertNull(MicOwner.holder());
    }

    @Test
    public void secondBorrowerIsRefusedWhileTheFirstHoldsTheMic() {
        FakeMeeting m = new FakeMeeting().start();
        MicLoan a = MicLoan.acquire(m, MicOwner.EVERYWHERE, "wos-ev-8", "orb-event-9");
        assertNotNull(a);
        assertNull(MicLoan.acquire(m, MicOwner.SIDE, "wos-side-2", "orb-event-10"));
        assertEquals(MicOwner.EVERYWHERE, MicOwner.holder());
        a.release(m, "stopped");
        assertEquals(MicOwner.MEETING, MicOwner.holder());
    }
}
