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
        assertArrayEquals(new Step[]{ Step.NOW, Step.TODO, Step.TODO }, TailscaleGuide.steps(false, null, false));
        // Installed but off: open it (sign in, allow the VPN).
        assertArrayEquals(new Step[]{ Step.DONE, Step.NOW, Step.TODO }, TailscaleGuide.steps(false, null, true));
        // On, still checking the phone's network: step 2 spins, step 3 waits.
        assertArrayEquals(new Step[]{ Step.DONE, Step.CHECKING, Step.TODO }, TailscaleGuide.steps(true, null, true));
        // On, and the Wizard's name doesn't exist from here: another account, or this phone was removed.
        assertArrayEquals(new Step[]{ Step.DONE, Step.NOW, Step.TODO }, TailscaleGuide.steps(true, true, true));
        // On, the name exists, nothing answers: the Wizard's computer is off or asleep. Step 3 spins.
        assertArrayEquals(new Step[]{ Step.DONE, Step.DONE, Step.CHECKING }, TailscaleGuide.steps(true, false, true));
        for (boolean on : new boolean[]{ false, true }) for (Boolean missing : new Boolean[]{ null, true, false }) for (boolean inst : new boolean[]{ false, true }) {
            Step[] s = TailscaleGuide.steps(on, missing, inst);
            assertEquals(3, s.length);
            for (int i = 1; i < s.length; i++) if (s[i] == Step.DONE) assertEquals("done in order", Step.DONE, s[i - 1]);
        }
        assertEquals(TailscaleGuide.OFF, TailscaleGuide.status(false, true));
        assertEquals(TailscaleGuide.WRONG, TailscaleGuide.status(true, true));
        assertEquals(TailscaleGuide.QUIET, TailscaleGuide.status(true, false));
        assertEquals(TailscaleGuide.UNSURE, TailscaleGuide.status(true, null));
        assertEquals(TailscaleGuide.TITLE_AWAY, TailscaleGuide.headline(true, false));
        assertEquals(TailscaleGuide.TITLE, TailscaleGuide.headline(true, true));
        assertEquals(TailscaleGuide.TITLE_CHECKING, TailscaleGuide.headline(true, null));
        assertEquals(TailscaleGuide.TITLE, TailscaleGuide.headline(false, null));
        assertEquals(TailscaleGuide.WAKE, TailscaleGuide.title(3, true, false));
        assertEquals(TailscaleGuide.BACK, TailscaleGuide.title(3, true, true));
        assertTrue(TailscaleGuide.removed(true, true));
        assertFalse(TailscaleGuide.removed(true, false));
    }

    @Test
    public void oneButtonOnTheStepNeededNow() {
        assertEquals("Get Tailscale", TailscaleGuide.button(false, false));
        assertEquals("Opens Google Play.", TailscaleGuide.hint(false, false));
        assertEquals("Open Tailscale", TailscaleGuide.button(false, true));
        assertEquals("Open Tailscale", TailscaleGuide.button(true, true));
        assertTrue(TailscaleGuide.hasButton(1, false, null, false));
        assertTrue(TailscaleGuide.hasButton(2, false, null, true));
        assertTrue(TailscaleGuide.hasButton(2, true, true, true));
        assertFalse(TailscaleGuide.hasButton(1, true, true, true));
        for (int n = 1; n <= 3; n++) assertFalse("Wizard off: nothing to open on the phone", TailscaleGuide.hasButton(n, true, false, true));
        for (int n = 1; n <= 3; n++) assertFalse("checking: no button", TailscaleGuide.hasButton(n, true, null, true));
    }

    @Test
    public void stepTwoNamesTheNetworkAndTheVpnTipUntilItIsDone() {
        assertEquals(TailscaleGuide.SAME + " " + TailscaleGuide.NETWORK, TailscaleGuide.body(2, false, null, false, "tail1234.ts.net"));
        assertEquals(TailscaleGuide.SAME, TailscaleGuide.body(2, false, null, false, ""));
        assertEquals(TailscaleGuide.INSTALLED, TailscaleGuide.body(1, true, true, true, ""));
        assertEquals(TailscaleGuide.FREE, TailscaleGuide.body(1, false, null, false, ""));
        assertEquals(TailscaleGuide.WAKE_BODY, TailscaleGuide.body(3, true, false, true, ""));
        assertTrue(TailscaleGuide.vpnTip(false, null, true));
        assertTrue(TailscaleGuide.vpnTip(true, null, true));
        assertFalse(TailscaleGuide.vpnTip(true, false, true));
    }

    @Test
    public void aNameThatDoesNotResolveMeansAnotherNetworkAndAHangMeansTheWizardIsOff() {
        assertTrue(TailscaleGuide.missingFrom("net::ERR_NAME_NOT_RESOLVED"));
        assertFalse(TailscaleGuide.missingFrom("net::ERR_CONNECTION_TIMED_OUT"));
        assertFalse(TailscaleGuide.missingFrom(null)); // the give-up mark: the load hung, so the name resolved
    }
}
