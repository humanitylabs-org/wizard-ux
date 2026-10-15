package ai.wizards.os.everywhere;

import static org.junit.Assert.assertEquals;
import org.junit.Test;

/** James: Send must stay animated and reject another take until insertion finishes. */
public class EverywhereProcessingTest {
    @Test public void stoppedDictationStaysBusyWhileQueuedOrTranscribing() {
        assertEquals("transcribe", EverywherePolicy.processingMode("dictation", "waiting", "", false));
        assertEquals("transcribe", EverywherePolicy.processingMode("dictation", "sending", "", false));
    }
    @Test public void wordsReadyStillOwnTheLockThroughInsertion() {
        assertEquals("sending", EverywherePolicy.processingMode("dictation", "sending", "words", false));
    }
    @Test public void retryBackoffRemainsVisiblyPending() {
        assertEquals("retry", EverywherePolicy.processingMode("dictation", "waiting", "", true));
        assertEquals("retry", EverywherePolicy.processingMode("everywhere", "waiting", "words", true));
    }
    @Test public void terminalSuccessEmptyFailureReleaseTheOrb() {
        for (String state : new String[]{"sent", "empty", "failed"})
            assertEquals("", EverywherePolicy.processingMode("dictation", state, "words", false));
    }
    @Test public void sideButtonWorkDoesNotOwnTheFloatingOrb() {
        assertEquals("", EverywherePolicy.processingMode("side", "sending", "", false));
    }
    @Test public void ordinaryFloatingSendAlsoStaysBusyUntilAdmission() {
        assertEquals("transcribe", EverywherePolicy.processingMode("everywhere", "sending", "", false));
        assertEquals("sending", EverywherePolicy.processingMode("everywhere", "sending", "words", false));
    }
}
