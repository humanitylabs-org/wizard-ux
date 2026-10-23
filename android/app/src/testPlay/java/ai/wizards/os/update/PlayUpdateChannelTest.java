package ai.wizards.os.update;

import org.junit.Test;
import static org.junit.Assert.*;

/** Play bridge entry points are inert, even with no Android context. */
public class PlayUpdateChannelTest {
    @Test public void cannotStartAnApkUpdate() {
        UpdateChannel.attach(null, null);
        UpdateChannel.detach(null);
        UpdateChannel.onIntent(null, null);
        UpdateChannel.onResume(null);
        UpdateChannel.onStop(null);
        UpdateChannel.check(null);
        UpdateChannel.install(null);
        assertTrue(UpdateChannel.state().contains("\"distribution\":\"play\""));
        assertFalse(UpdateChannel.state().contains("ready"));
    }
}
