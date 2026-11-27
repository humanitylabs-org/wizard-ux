package ai.wizards.os.audio;

import org.junit.Test;
import static org.junit.Assert.*;
import static ai.wizards.os.audio.CallHold.*;

/** Calls come first on the phone's media player (wizard-ux issue 1976). */
public class CallHoldTest {
    private static final int USER = 1; // Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST

    @Test public void reasonsMatchMedia3() {
        assertEquals(androidx.media3.common.Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS, REASON_FOCUS_LOSS);
        assertEquals(androidx.media3.common.Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY, REASON_NOISY);
        assertEquals(androidx.media3.common.Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST, USER);
        assertEquals(android.media.AudioManager.MODE_NORMAL, MODE_NORMAL);
        assertEquals(android.media.AudioManager.MODE_RINGTONE, MODE_RINGTONE);
        assertEquals(android.media.AudioManager.MODE_IN_CALL, MODE_IN_CALL);
        assertEquals(android.media.AudioManager.MODE_IN_COMMUNICATION, MODE_IN_COMMUNICATION);
        assertEquals(android.media.AudioManager.MODE_CALL_SCREENING, MODE_CALL_SCREENING);
        assertEquals(android.media.AudioManager.MODE_CALL_REDIRECT, MODE_CALL_REDIRECT);
        assertEquals(android.media.AudioManager.MODE_COMMUNICATION_REDIRECT, MODE_COMMUNICATION_REDIRECT);
    }

    @Test public void focusLossOrNoisyDuringACallKeepsTheIntention() {
        for (int mode : new int[]{MODE_RINGTONE, MODE_IN_CALL, MODE_IN_COMMUNICATION, MODE_CALL_SCREENING, MODE_CALL_REDIRECT, MODE_COMMUNICATION_REDIRECT}) {
            assertTrue("focus in mode " + mode, callCaused(REASON_FOCUS_LOSS, mode, 10_000, 0));
            assertTrue("noisy in mode " + mode, callCaused(REASON_NOISY, mode, 10_000, 0));
        }
    }

    @Test public void focusLossOrUnplugOutsideACallIsARealPause() {
        assertFalse(callCaused(REASON_NOISY, MODE_NORMAL, 10_000, 0));
        assertFalse(callCaused(REASON_FOCUS_LOSS, MODE_NORMAL, 10_000, 0));
        assertFalse("long after a call", callCaused(REASON_NOISY, MODE_NORMAL, 10_000, 10_000 - SETTLE_MS - 1));
        assertFalse("the person's own pause is never the call's", callCaused(USER, MODE_IN_COMMUNICATION, 10_000, 0));
    }

    @Test public void noisyRightAfterTheCallIsTheEarphonesSwitchingBack() {
        assertTrue(callCaused(REASON_NOISY, MODE_NORMAL, 10_000, 9_000));
        assertTrue(callCaused(REASON_NOISY, MODE_NORMAL, 10_000, 10_000 - SETTLE_MS));
    }

    @Test public void aRingThatTookTheFocusJustBeforeTheCallIsTheCalls() {
        assertTrue(ringPause(1_000, 1_000));
        assertTrue(ringPause(1_000, 1_000 + RING_WINDOW_MS));
        assertFalse(ringPause(1_000, 1_000 + RING_WINDOW_MS + 1));
        assertFalse(ringPause(0, 5_000));
    }

    @Test public void resumesOnlyWhenThePersonChangedNothingDuringTheCall() {
        assertTrue(resume(true, true, 4, 4, "ep:1", "ep:1"));
        assertFalse("paused during the call", resume(true, false, 4, 4, "ep:1", "ep:1"));
        assertFalse("stopped or loaded something else", resume(true, true, 4, 5, "ep:1", "ep:1"));
        assertFalse("moved to another item", resume(true, true, 4, 4, "ep:1", "ep:2"));
        assertFalse("nothing was playing when the call came", resume(false, true, 4, 4, "ep:1", "ep:1"));
    }

    @Test public void phoneCallRingingStopsAtOnce() {
        CallHold c = new CallHold();
        assertEquals(START, c.mode(MODE_RINGTONE, false, 1_000));
        assertTrue(c.inCall());
        assertEquals(NONE, c.mode(MODE_IN_CALL, false, 5_000));
        assertEquals(END, c.mode(MODE_NORMAL, false, 30_000));
        assertFalse(c.inCall());
        assertEquals(30_000, c.callEndedAt());
    }

    @Test public void whatsAppCallWithTransientFocusThenAnsweredAndHungUpResumes() {
        CallHold c = new CallHold();
        // Ringing: WhatsApp takes the focus for a while (the player is suppressed), the mode is still normal.
        assertEquals(NONE, c.mode(MODE_NORMAL, true, 1_000));
        // Answered: voice-chat mode while the focus is taken = a call.
        assertEquals(START, c.mode(MODE_IN_COMMUNICATION, true, 8_000));
        c.hold(3, "ep:11139");
        assertTrue(c.holding());
        assertEquals(END, c.mode(MODE_NORMAL, false, 28_000));
        assertTrue(c.release(true, 3, "ep:11139"));
        assertFalse(c.holding());
    }

    @Test public void whatsAppRingThatTookTheFocusForGoodStillResumes() {
        CallHold c = new CallHold();
        // Ringing takes the focus for good: Media3 pauses with AUDIO_FOCUS_LOSS before any call mode.
        assertFalse(callCaused(REASON_FOCUS_LOSS, MODE_NORMAL, 1_000, 0));
        c.realPause(REASON_FOCUS_LOSS, 1_000, 3, "ep:11139");
        // Answered 20 s later: the voice-chat mode counts as a call because the focus went just before.
        assertEquals(START, c.mode(MODE_IN_COMMUNICATION, false, 21_000));
        assertTrue("the ring took it, not the person", c.ringTookIt(21_000, 3, "ep:11139"));
        c.hold(3, "ep:11139");
        assertEquals(END, c.mode(MODE_NORMAL, false, 60_000));
        assertTrue(c.release(true, 3, "ep:11139"));
    }

    @Test public void thePersonsPauseBeforeTheCallStaysAPause() {
        CallHold c = new CallHold();
        c.realPause(REASON_FOCUS_LOSS, 1_000, 3, "ep:1");
        c.personActed(); // pressed pause / play / loaded since
        assertEquals(START, c.mode(MODE_RINGTONE, false, 2_000));
        assertFalse(c.ringTookIt(2_000, 3, "ep:1"));
    }

    @Test public void anUnplugSecondsBeforeACallIsNotTheCalls() {
        CallHold c = new CallHold();
        c.realPause(REASON_NOISY, 1_000, 3, "ep:1");
        assertEquals(START, c.mode(MODE_RINGTONE, false, 1_000 + SETTLE_MS + 1));
        assertFalse(c.ringTookIt(1_000 + SETTLE_MS + 1, 3, "ep:1"));
        CallHold d = new CallHold();
        d.realPause(REASON_NOISY, 1_000, 3, "ep:1");
        assertEquals("an older unplug does not make Wizard's own voice-chat mode a call", NONE, d.mode(MODE_IN_COMMUNICATION, false, 1_000 + SETTLE_MS + 1));
    }

    @Test public void earphonesLeavingTheMediaProfileJustBeforeTheModeChangesIsTheCalls() {
        // Bluetooth sends "becoming noisy" as it moves to the call profile, a moment before WhatsApp sets voice-chat mode.
        assertTrue(ringPause(REASON_NOISY, 1_000, 1_000 + SETTLE_MS));
        assertFalse(ringPause(REASON_NOISY, 1_000, 1_000 + SETTLE_MS + 1));
        CallHold c = new CallHold();
        assertFalse(callCaused(REASON_NOISY, MODE_NORMAL, 1_000, 0));
        c.realPause(REASON_NOISY, 1_000, 3, "ep:11139");
        assertEquals(START, c.mode(MODE_IN_COMMUNICATION, false, 2_000));
        assertTrue(c.ringTookIt(2_000, 3, "ep:11139"));
        c.hold(3, "ep:11139");
        assertEquals(END, c.mode(MODE_NORMAL, false, 40_000));
        assertTrue(c.release(true, 3, "ep:11139"));
    }

    @Test public void wizardsOwnMicSettingVoiceChatModeIsNotACall() {
        // The web mic (getUserMedia) switches the phone to voice-chat mode but takes no audio focus: music keeps playing.
        CallHold c = new CallHold();
        assertEquals(NONE, c.mode(MODE_IN_COMMUNICATION, false, 1_000));
        assertFalse(c.inCall());
        assertEquals(NONE, c.mode(MODE_NORMAL, false, 9_000));
        assertFalse(c.inCall());
    }

    @Test public void thePersonPausingOrLoadingDuringTheCallIsKept() {
        CallHold c = new CallHold();
        c.mode(MODE_IN_CALL, false, 1_000); c.hold(3, "ep:1");
        c.mode(MODE_NORMAL, false, 9_000);
        assertFalse("paused on the lock screen during the call", c.release(false, 3, "ep:1"));
        c.mode(MODE_IN_CALL, false, 20_000); c.hold(3, "ep:1");
        c.mode(MODE_NORMAL, false, 29_000);
        assertFalse("loaded another episode during the call", c.release(true, 4, "ep:2"));
    }
}
