package ai.wizards.os;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import ai.wizards.os.TailscaleGuide.Step;
import org.junit.Test;

public class TailscaleGuideTest {
    @Test
    public void onlyTailscaleAddressesGetTheGuide() {
        assertEquals("tail1234.ts.net", TailscaleGuide.tailnet("https://wizard.tail1234.ts.net"));
        assertEquals("tail1234.ts.net", TailscaleGuide.tailnet("https://Wizard.Tail1234.ts.net:8443/"));
        assertEquals("", TailscaleGuide.tailnet("https://ts.net"));
        assertEquals("", TailscaleGuide.tailnet("https://wizard.example.com"));
        assertEquals("", TailscaleGuide.tailnet("https://wizard.ts.net.evil.example"));
        assertEquals("", TailscaleGuide.tailnet(null));
        assertTrue(TailscaleGuide.applies("https://wizard.tail1234.ts.net"));
        assertFalse(TailscaleGuide.applies("https://wizard.example.com"));
    }

    @Test
    public void theStepNeededNowFollowsWhatThePhoneShows() {
        // Not installed: get it.
        assertArrayEquals(new Step[]{ Step.NOW, Step.TODO, Step.TODO, Step.TODO }, TailscaleGuide.steps(false, false));
        // Installed but off: turn it on.
        assertArrayEquals(new Step[]{ Step.DONE, Step.TODO, Step.NOW, Step.TODO }, TailscaleGuide.steps(false, true));
        // On, yet the Wizard doesn't answer: wrong account, or this phone was removed from the network.
        assertArrayEquals(new Step[]{ Step.DONE, Step.NOW, Step.DONE, Step.TODO }, TailscaleGuide.steps(true, true));
        assertEquals(TailscaleGuide.OFF, TailscaleGuide.status(false));
        assertEquals(TailscaleGuide.WRONG, TailscaleGuide.status(true));
    }

    @Test
    public void oneButtonOnTheStepNeededNow() {
        assertEquals("Get Tailscale", TailscaleGuide.button(false, false));
        assertEquals("Opens Google Play.", TailscaleGuide.hint(false, false));
        assertEquals("Open Tailscale", TailscaleGuide.button(false, true));
        assertEquals("Open Tailscale", TailscaleGuide.button(true, true));
        assertTrue(TailscaleGuide.hasButton(1, false, false));
        assertTrue(TailscaleGuide.hasButton(3, false, true));
        assertTrue(TailscaleGuide.hasButton(2, true, true));
        assertFalse(TailscaleGuide.hasButton(1, true, true));
        for (int s = 1; s <= 4; s++) assertFalse(TailscaleGuide.hasButton(4, s % 2 == 0, s > 2));
    }

    @Test
    public void stepTwoNamesTheNetworkWhenThereIsOne() {
        assertEquals(TailscaleGuide.SAME + " " + TailscaleGuide.NETWORK, TailscaleGuide.body(2, false, false, "tail1234.ts.net"));
        assertEquals(TailscaleGuide.SAME, TailscaleGuide.body(2, false, false, ""));
        assertEquals(TailscaleGuide.INSTALLED_ON, TailscaleGuide.body(1, true, true, ""));
        assertEquals(TailscaleGuide.VPN, TailscaleGuide.body(3, false, true, ""));
    }
}
