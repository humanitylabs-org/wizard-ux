package ai.wizards.os.assist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TakeRecoveryTest {
    @Test
    public void crashProofTakesKeepTheirAdtsContainer() {
        assertEquals(".aac", TakeRecovery.ext("/data/files/side-takes/side-1.aac"));
        assertEquals("audio/aac", TakeRecovery.mime("wos-side-x.aac"));
        assertEquals(".m4a", TakeRecovery.ext("everywhere-12.m4a"));
        assertEquals("audio/mp4", TakeRecovery.mime("wos-ev-x.m4a"));
        assertEquals(".m4a", TakeRecovery.ext(null));
    }

    @Test
    public void onlyTakesWithAudioInThemAreRecovered() {
        assertFalse(TakeRecovery.worthSending(0));
        assertFalse(TakeRecovery.worthSending(600));
        assertTrue(TakeRecovery.worthSending(2048));
        assertTrue(TakeRecovery.worthSending(80_000));
    }
}
