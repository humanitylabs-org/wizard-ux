package ai.wizards.os.audio;
import org.junit.Test;
import static org.junit.Assert.*;
public class AudioRecordingGateTest {
    @Test public void recordingStartsSynchronouslyAndDistinctOwnersRetainHold() {
        AudioRecordingGate.set("mic",false);AudioRecordingGate.set("recorder",false);AudioRecordingGate.set("appVoice",false);
        final boolean[] state={false}; final int[] count={0};
        AudioRecordingGate.observe(held -> {state[0]=held;count[0]++;});
        AudioRecordingGate.set("recorder",true);assertTrue(state[0]);assertTrue(AudioRecordingGate.held());
        AudioRecordingGate.set("mic",true);AudioRecordingGate.set("recorder",false);assertTrue(state[0]);
        AudioRecordingGate.set("mic",false);assertFalse(state[0]);assertFalse(AudioRecordingGate.held());assertEquals(3,count[0]);
        AudioRecordingGate.observe(null);
    }
}
