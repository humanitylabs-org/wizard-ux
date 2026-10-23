package ai.wizards.os.device;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class DeviceMessageProtocolTest {
    private JSONObject request() throws JSONException {
        return new JSONObject().put("v", 1).put("id", "r1").put("method", "device.packages.list");
    }

    private void refused(JSONObject value) {
        try { DeviceMessageProtocol.parse(value); fail("accepted invalid request: " + value); }
        catch (JSONException expected) { }
    }

    @Test public void parsesVersionedRequestWithoutChangingParams() throws Exception {
        JSONObject params = new JSONObject().put("package", "example.app").put("sha256", "not-a-valid-hash");
        DeviceMessageProtocol.Request parsed = DeviceMessageProtocol.parse(request().put("params", params));
        assertEquals("r1", parsed.id);
        assertEquals("device.packages.list", parsed.method);
        assertSame(params, parsed.params); // the native adapter, not the transport, validates install authority
        assertEquals(0, DeviceMessageProtocol.parse(request()).params.length());
    }

    @Test public void rejectsMissingCoercedAndUnsupportedVersions() throws Exception {
        JSONObject missing = request(); missing.remove("v"); refused(missing);
        for (Object v : new Object[]{0, 2, 1.5, "1", true, JSONObject.NULL}) refused(request().put("v", v));
    }

    @Test public void rejectsMalformedIdsMethodsAndParams() throws Exception {
        for (Object id : new Object[]{"", "x".repeat(65), 3, false, JSONObject.NULL}) refused(request().put("id", id));
        JSONObject missing = request(); missing.remove("id"); refused(missing);
        refused(request().put("method", 3));
        for (Object params : new Object[]{new JSONArray(), "{}", 7, false, JSONObject.NULL}) refused(request().put("params", params));
    }

    @Test public void discoveryExactlyMatchesDispatchAllowlist() throws Exception {
        JSONObject caps = DeviceMessageProtocol.capabilities();
        assertEquals(1, caps.getInt("v"));
        JSONObject packages = caps.getJSONObject("capabilities").getJSONObject("device.packages");
        assertEquals(1, packages.getInt("v"));
        JSONArray methods = packages.getJSONArray("methods");
        assertEquals(8, methods.length());
        for (int i = 0; i < methods.length(); i++) {
            String name = methods.getString(i);
            assertEquals(name.substring("device.packages.".length()), DeviceMessageProtocol.packageMethod(name));
        }
        for (String name : new String[]{"list", "device.packages.scheduleUpdates", "device.packages.install.extra", "device.packages", "device.photos.list", "usualsTeach", "DEVICE.packages.list"}) {
            assertNull(name, DeviceMessageProtocol.packageMethod(name));
        }
    }

    @Test public void responsesAreVersionedAndPreserveLegacyPayloads() throws Exception {
        JSONObject payload = new JSONObject().put("apps", new JSONArray());
        JSONObject ok = DeviceMessageProtocol.answer("r1", payload, null);
        assertEquals(1, ok.getInt("v")); assertEquals("r1", ok.getString("id"));
        assertTrue(ok.getBoolean("ok")); assertSame(payload, ok.getJSONObject("result"));
        assertFalse(ok.has("error"));
        JSONObject error = DeviceMessageProtocol.answer("r2", null, "unknown method");
        assertFalse(error.getBoolean("ok")); assertEquals("unknown method", error.getString("error"));
        assertFalse(error.has("result"));
        assertTrue(DeviceMessageProtocol.answer("r3", null, null).isNull("result"));
    }
}
