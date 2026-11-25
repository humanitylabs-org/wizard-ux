package ai.wizards.os.assist;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Side button opens the Agent chat (wizard-ux issue 1528, switch wizard/assist-agent-note, off by default). */
public class AssistNoteTest {
    @Test public void switchOffKeepsTheOrbForEveryPress() {
        for (boolean locked : new boolean[]{false, true})
            for (boolean handoff : new boolean[]{false, true})
                for (boolean listening : new boolean[]{false, true})
                    assertFalse(AssistNote.opensAgentChat(false, locked, handoff, listening));
    }

    @Test public void switchOnAFreshPressOnAnUnlockedPhoneOpensTheAgentChat() {
        assertTrue(AssistNote.opensAgentChat(true, false, false, false));
    }

    @Test public void theLockScreenKeepsItsOwnSurface() {
        assertFalse(AssistNote.opensAgentChat(true, true, false, false));
    }

    @Test public void aHandOverFromTheLockScreenOrCameraIsNeverReplaced() {
        assertFalse(AssistNote.opensAgentChat(true, false, true, false));
        assertFalse(AssistNote.opensAgentChat(true, false, true, true));
    }

    @Test public void aPressDuringAnOpenTakeStillSendsIt() {
        assertFalse(AssistNote.opensAgentChat(true, false, false, true));
    }

    @Test public void theActionIsWizardOSOwn() {
        assertEquals("ai.wizards.os.action.AGENT_NOTE", AssistNote.ACTION);
    }
}
