package ai.wizards.shell.device;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

import ai.wizards.shell.recorder.RecordingMethods;

import static org.junit.Assert.*;

/** wizardDevicePort v1 in the shell: same envelope as android/app's DeviceMessageProtocol, exact allowlist dispatch. */
public class DevicePortTest {
    static DevicePort.Adapter fake(String name, String... methods) {
        return new DevicePort.Adapter() {
            public String name() { return name; }
            public int version() { return 1; }
            public String[] methods() { return methods; }
            public void call(String m, JSONObject p, DevicePort.Reply r) { r.ok(m); }
        };
    }

    private JSONObject request() throws JSONException {
        return new JSONObject().put("v", 1).put("id", "r1").put("method", "device.recording.status");
    }

    private void refused(Object value) {
        try {
            if (value instanceof String || value == null) DevicePort.parse((String) value);
            else DevicePort.parse((JSONObject) value);
            fail("accepted invalid request: " + value);
        } catch (JSONException expected) { }
    }

    @Test public void parsesTheSameEnvelopeAsTheAppPort() throws Exception {
        JSONObject params = new JSONObject().put("id", "take-1-abcdef01");
        DevicePort.Request r = DevicePort.parse(request().put("params", params).toString());
        assertEquals("r1", r.id);
        assertEquals("device.recording.status", r.method);
        assertEquals("take-1-abcdef01", r.params.getString("id"));
        assertEquals(0, DevicePort.parse(request()).params.length());
    }

    @Test public void rejectsBadVersionsIdsMethodsParamsAndBinary() throws Exception {
        JSONObject missing = request(); missing.remove("v"); refused(missing);
        for (Object v : new Object[]{0, 2, 1.5, "1", true, JSONObject.NULL}) refused(request().put("v", v));
        for (Object id : new Object[]{"", "x".repeat(65), 3, JSONObject.NULL}) refused(request().put("id", id));
        refused(request().put("method", 3));
        for (Object p : new Object[]{new JSONArray(), "{}", 7, JSONObject.NULL}) refused(request().put("params", p));
        refused((String) null); // an ArrayBuffer message arrives as null text
        refused("not json");
    }

    @Test public void discoveryListsExactlyWhatDispatchAccepts() throws Exception {
        DevicePort.Registry reg = new DevicePort.Registry().add(fake("device.recording", RecordingMethods.ALL));
        JSONObject caps = reg.capabilities();
        assertEquals(1, caps.getInt("v"));
        JSONObject rec = caps.getJSONObject("capabilities").getJSONObject("device.recording");
        assertEquals(1, rec.getInt("v"));
        JSONArray methods = rec.getJSONArray("methods");
        assertEquals(RecordingMethods.ALL.length, methods.length());
        for (int i = 0; i < methods.length(); i++) {
            DevicePort.Target t = reg.target(methods.getString(i));
            assertNotNull(methods.getString(i), t);
            assertEquals(RecordingMethods.ALL[i], t.method);
        }
        for (String bad : new String[]{"status", "device.recording", "device.recording.", "device.recording.delete",
                "device.recording.status.x", "DEVICE.recording.status", "device.packages.list", "device.capabilities.status", null})
            assertNull(bad, reg.target(bad));
    }

    @Test public void noAdaptersMeansOnlyEmptyDiscovery() throws Exception {
        DevicePort.Registry reg = new DevicePort.Registry();
        assertEquals(0, reg.capabilities().getJSONObject("capabilities").length());
        assertNull(reg.target("device.recording.start"));
    }

    @Test public void adaptersAreNamedAndUnique() {
        DevicePort.Registry reg = new DevicePort.Registry().add(fake("device.recording", "status"));
        for (String bad : new String[]{"device.recording", "recording", "device.", "device.Recording", "device.rec.x"}) {
            try { reg.add(fake(bad, "status")); fail(bad); } catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void answersAreVersionedAndCorrelated() throws Exception {
        JSONObject ok = DevicePort.answer("r1", new JSONObject().put("a", 1), null);
        assertEquals(1, ok.getInt("v")); assertEquals("r1", ok.getString("id")); assertTrue(ok.getBoolean("ok"));
        assertFalse(ok.has("error"));
        JSONObject err = DevicePort.answer("r2", null, "unknown method");
        assertFalse(err.getBoolean("ok")); assertEquals("unknown method", err.getString("error")); assertFalse(err.has("result"));
        assertTrue(DevicePort.answer("r3", null, null).isNull("result"));
    }

    @Test public void onlyTheShellPathIsAnswered() {
        assertTrue(DevicePort.shellPath("/wizard-os-home"));
        assertTrue(DevicePort.shellPath("/wizard-os-home/"));
        assertTrue(DevicePort.shellPath("/wizard-os-home/index.html"));
        for (String p : new String[]{null, "", "/", "/wizard-os-home-preview/", "/apps/x/wizard-os-home/", "/wizard/api"})
            assertFalse(String.valueOf(p), DevicePort.shellPath(p));
    }
}
