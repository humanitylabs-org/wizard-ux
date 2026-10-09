package ai.wizards.os.everywhere;

import static ai.wizards.os.everywhere.AccessibilitySetup.GATE_NONE;
import static ai.wizards.os.everywhere.AccessibilitySetup.GATE_OFFERED;
import static ai.wizards.os.everywhere.AccessibilitySetup.GATE_UNTRIED;
import static org.junit.Assert.assertEquals;

import android.app.AppOpsManager;

import org.junit.Test;

public class AccessibilitySetupTest {
    @Test
    public void onIsDoneWhateverTheGateSays() {
        assertEquals(AccessibilitySetup.Step.DONE, AccessibilitySetup.decide(true, GATE_NONE));
        assertEquals(AccessibilitySetup.Step.DONE, AccessibilitySetup.decide(true, GATE_UNTRIED));
        assertEquals(AccessibilitySetup.Step.DONE, AccessibilitySetup.decide(true, GATE_OFFERED));
    }

    @Test
    public void stepsFollowTheGate() {
        assertEquals(AccessibilitySetup.Step.TURN_ON, AccessibilitySetup.decide(false, GATE_NONE));
        assertEquals(AccessibilitySetup.Step.TAP_ONCE, AccessibilitySetup.decide(false, GATE_UNTRIED));
        assertEquals(AccessibilitySetup.Step.ALLOW_RESTRICTED, AccessibilitySetup.decide(false, GATE_OFFERED));
    }

    @Test
    public void beforeAndroid13ThereIsNoGate() {
        assertEquals(GATE_NONE, AccessibilitySetup.gateFrom(32, AppOpsManager.MODE_ERRORED, true, true));
    }

    @Test
    public void theAppOpWinsWhenReadable() {
        assertEquals(GATE_NONE, AccessibilitySetup.gateFrom(34, AppOpsManager.MODE_ALLOWED, true, true));
        assertEquals(GATE_UNTRIED, AccessibilitySetup.gateFrom(34, AppOpsManager.MODE_ERRORED, false, true));
        assertEquals(GATE_OFFERED, AccessibilitySetup.gateFrom(34, AppOpsManager.MODE_IGNORED, false, false));
    }

    @Test
    public void unreadableOpFallsBackToInstallSourceAndWhetherHeTriedOnce() {
        assertEquals(GATE_NONE, AccessibilitySetup.gateFrom(34, -1, false, true));      // Play Store install
        assertEquals(GATE_UNTRIED, AccessibilitySetup.gateFrom(34, -1, true, false));   // sideloaded, first ask
        assertEquals(GATE_OFFERED, AccessibilitySetup.gateFrom(34, -1, true, true));    // came back still off
    }
}
