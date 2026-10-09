package ai.wizards.os.everywhere;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AccessibilitySetupTest {
    @Test
    public void onIsDoneWhateverTheGateSays() {
        assertEquals(AccessibilitySetup.Step.DONE, AccessibilitySetup.decide(true, AccessibilitySetup.GATE_NONE));
        assertEquals(AccessibilitySetup.Step.DONE, AccessibilitySetup.decide(true, AccessibilitySetup.GATE_UNTRIED));
        assertEquals(AccessibilitySetup.Step.DONE, AccessibilitySetup.decide(true, AccessibilitySetup.GATE_OFFERED));
    }

    @Test
    public void offAndUnrestrictedGoesStraightToTheSwitch() {
        assertEquals(AccessibilitySetup.Step.TURN_ON, AccessibilitySetup.decide(false, AccessibilitySetup.GATE_NONE));
    }

    @Test
    public void sideloadedNeverTriedTapsTheGreyRowOnceFirst() {
        assertEquals(AccessibilitySetup.Step.TAP_ONCE, AccessibilitySetup.decide(false, AccessibilitySetup.GATE_UNTRIED));
    }

    @Test
    public void sideloadedAfterOneTapAllowsRestrictedSettingsInAppInfo() {
        assertEquals(AccessibilitySetup.Step.ALLOW_RESTRICTED, AccessibilitySetup.decide(false, AccessibilitySetup.GATE_OFFERED));
    }
}
