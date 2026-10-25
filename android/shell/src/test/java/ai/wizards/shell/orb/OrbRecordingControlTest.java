package ai.wizards.shell.orb;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class OrbRecordingControlTest {
    private static final String OWNER = "https://wizard.example:8444";
    private static final String PAGE = OrbPolicy.bundledUrl();

    private JSONObject request(String method, String id) throws Exception {
        return new JSONObject().put("v", 1).put("id", "request-1").put("method", method).put("params", new JSONObject().put("id", id).put("on", true));
    }

    @Test public void exactVirtualMainFrameAndSelectedOwnerAreRequired() {
        assertTrue(OrbRecordingControl.allowed(PAGE, OrbPolicy.VIRTUAL, true, OWNER, OWNER));
        assertTrue(OrbRecordingControl.allowed(PAGE, OrbPolicy.VIRTUAL + "/", true, OWNER, OWNER));
        assertFalse(OrbRecordingControl.allowed(PAGE, OrbPolicy.VIRTUAL, false, OWNER, OWNER));
        assertFalse(OrbRecordingControl.allowed(PAGE, OWNER, true, OWNER, OWNER));
        assertFalse(OrbRecordingControl.allowed(PAGE, OrbPolicy.VIRTUAL + ".evil", true, OWNER, OWNER));
        assertFalse(OrbRecordingControl.allowed(PAGE, OrbPolicy.VIRTUAL + ":8444", true, OWNER, OWNER));
        assertFalse(OrbRecordingControl.allowed(PAGE, "null", true, OWNER, OWNER));
        assertFalse(OrbRecordingControl.allowed(PAGE, null, true, OWNER, OWNER));
    }

    @Test public void noControlsForAnotherTopLevelPageOrUnboundOwner() {
        assertFalse(OrbRecordingControl.allowed(OrbPolicy.VIRTUAL + "/wizard-os-home/orb.js", OrbPolicy.VIRTUAL, true, OWNER, OWNER));
        assertFalse(OrbRecordingControl.allowed(PAGE + "?x=1", OrbPolicy.VIRTUAL, true, OWNER, OWNER));
        assertFalse(OrbRecordingControl.allowed(null, OrbPolicy.VIRTUAL, true, OWNER, OWNER));
        assertFalse(OrbRecordingControl.allowed(PAGE, OrbPolicy.VIRTUAL, true, OWNER, "https://other.example"));
        assertFalse(OrbRecordingControl.allowed(PAGE, OrbPolicy.VIRTUAL, true, null, null));
    }

    @Test public void onlyPauseResumeAndCancelForTheDisplayedTake() throws Exception {
        for (String method : new String[]{"device.recording.pause", "device.recording.cancel"}) {
            assertEquals(method, OrbRecordingControl.method(request(method, "take-A"), "take-A"));
            assertNull(OrbRecordingControl.method(request(method, "take-A"), "take-B"));
            assertNull(OrbRecordingControl.method(request(method, "take-A"), null));
        }
        JSONObject resume = request("device.recording.pause", "take-A");
        resume.getJSONObject("params").put("on", false);
        assertEquals("device.recording.pause", OrbRecordingControl.method(resume, "take-A"));
        resume.getJSONObject("params").remove("on");
        assertNull(OrbRecordingControl.method(resume, "take-A"));
        resume.getJSONObject("params").put("on", "false");
        assertNull(OrbRecordingControl.method(resume, "take-A"));
    }

    @Test public void cannotStartSendReadOrSwitchAnotherRecording() throws Exception {
        for (String method : new String[]{"device.recording.start", "device.recording.stop", "device.recording.read", "device.recording.ack", "device.recording.resume", "device.orb.disable", "cancel", ""})
            assertNull(OrbRecordingControl.method(request(method, "take-A"), "take-A"));
        assertNull(OrbRecordingControl.method(null, "take-A"));
        assertNull(OrbRecordingControl.method(new JSONObject(), "take-A"));
        assertNull(OrbRecordingControl.method(request("device.recording.cancel", "take-A").put("v", 2), "take-A"));
        assertNull(OrbRecordingControl.method(request("device.recording.cancel", "take-A").put("params", JSONObject.NULL), "take-A"));
    }
}
