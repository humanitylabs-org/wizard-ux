package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SideButtonTest {
    @Test
    public void stepsGoMicThenAssistantThenPressThenReady() {
        assertEquals(SideButton.STEP_MIC, SideButton.step(false, false, false));
        assertEquals(SideButton.STEP_MIC, SideButton.step(false, true, true));
        assertEquals(SideButton.STEP_ASSISTANT, SideButton.step(true, false, false));
        assertEquals(SideButton.STEP_ASSISTANT, SideButton.step(true, false, true));
        assertEquals(SideButton.STEP_PRESS, SideButton.step(true, true, false));
        assertEquals(SideButton.STEP_READY, SideButton.step(true, true, true));
    }

    @Test
    public void jsonIsAPlainObjectTheShellCanRead() {
        String j = SideButton.json(true, false, false, true);
        assertEquals("{\"mic\":true,\"assistant\":false,\"used\":false,\"samsung\":true,\"step\":\"assistant\"}", j);
        assertTrue(SideButton.json(true, true, true, false).endsWith("\"step\":\"ready\"}"));
    }
}
