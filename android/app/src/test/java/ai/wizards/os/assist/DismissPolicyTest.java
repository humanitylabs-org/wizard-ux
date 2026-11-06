package ai.wizards.os.assist;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Back/Home on the side-button surface never loses what was said (James, 10 Oct 2026). */
public class DismissPolicyTest {
    @Test public void backMidTakeWithSpeechSends() {
        assertEquals(DismissPolicy.Action.SEND, DismissPolicy.onDismiss(true, true, false));
    }

    @Test public void backMidTakeWithNothingSaidDrops() {
        assertEquals(DismissPolicy.Action.DROP, DismissPolicy.onDismiss(true, false, false));
    }

    @Test public void backWhileAlreadySendingLeavesItAlone() {
        // Not listening any more: the outbox owns the message and finishes it; dismissing must not touch it.
        assertEquals(DismissPolicy.Action.NONE, DismissPolicy.onDismiss(false, true, false));
        assertEquals(DismissPolicy.Action.NONE, DismissPolicy.onDismiss(false, false, false));
    }

    @Test public void qaCannedAudioCountsAsSpeech() {
        assertEquals(DismissPolicy.Action.SEND, DismissPolicy.onDismiss(true, false, true));
    }
}
