package ai.wizards.os.audio;

import static org.junit.Assert.*;
import org.junit.Test;

/** Every background-audio request is answered (issue 115): refusals answer instead of dropping, and only once. */
public class AudioReplyTest {
    private static final String O="https://wizard.example";

    @Test public void aGoodRequestFromTheShellGoesOn() {
        assertNull(AudioReply.refusal(true,false,true,O,O,true));
    }

    @Test public void everyRefusalIsAnAnswerNotSilence() {
        assertEquals(AudioReply.REFUSED,AudioReply.refusal(false,false,true,O,O,true)); // oversized or bad JSON
        assertEquals(AudioReply.REFUSED,AudioReply.refusal(true,true,true,O,O,true)); // view detached
        assertEquals(AudioReply.REFUSED,AudioReply.refusal(true,false,false,O,O,true)); // not the main frame
        assertEquals(AudioReply.REFUSED,AudioReply.refusal(true,false,true,null,O,true)); // no source
        assertEquals(AudioReply.REFUSED,AudioReply.refusal(true,false,true,"https://other.example",O,true)); // other origin
        assertEquals(AudioReply.REFUSED,AudioReply.refusal(true,false,true,O,O,false)); // not the shell page
    }

    @Test public void theReplyOrTheTimeoutAnswersOnceAndTheTimeoutIsAFewSeconds() {
        AudioReply once=new AudioReply();
        assertTrue(once.claim());
        assertFalse(once.claim());
        assertTrue(AudioReply.TIMEOUT_MS>0 && AudioReply.TIMEOUT_MS<=5000);
    }
}
