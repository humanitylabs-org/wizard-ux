package ai.wizards.os.device;

import org.json.JSONException;
import org.json.JSONObject;

/** Versioned capability envelope. No Android dependencies; authority stays in the device adapters. */
public final class DeviceMessageProtocol {
    public static final String NAME = "wizardDevicePort";
    public static final int VERSION = 1;
    private static final String PREFIX = "device.packages.";
    private static final String[] PACKAGE_METHODS = {
        "status", "list", "icon", "launch", "openPlay", "appInfo", "uninstall", "install"
    };

    private DeviceMessageProtocol() { }

    /** Independent capability group; keep the base adapter discovery composable with Wizard ID. */
    public static JSONObject capabilities() throws JSONException {
        JSONObject result = baseCapabilities();
        result.getJSONObject("capabilities").put("vault", ai.wizards.os.vault.VaultPolicy.capability());
        return result;
    }

    public static final class Request {
        public final String id;
        public final String method;
        public final JSONObject params;
        private Request(String id, String method, JSONObject params) {
            this.id = id; this.method = method; this.params = params;
        }
    }

    public static Request parse(JSONObject message) throws JSONException {
        Object version = message.opt("v");
        if (!(version instanceof Number) || ((Number) version).doubleValue() != VERSION) {
            throw new JSONException("unsupported version");
        }
        Object id = message.opt("id"), method = message.opt("method"), params = message.opt("params");
        if (!(id instanceof String) || ((String) id).isEmpty() || ((String) id).length() > 64) {
            throw new JSONException("invalid id");
        }
        if (!(method instanceof String)) throw new JSONException("invalid method");
        if (message.has("params") && !(params instanceof JSONObject)) throw new JSONException("invalid params");
        return new Request((String) id, (String) method, params instanceof JSONObject ? (JSONObject) params : new JSONObject());
    }

    /** Exact allowlist, not arbitrary reflection or feature-method forwarding. */
    public static String packageMethod(String method) {
        for (String name : PACKAGE_METHODS) if ((PREFIX + name).equals(method)) return name;
        return null;
    }

    private static JSONObject baseCapabilities() throws JSONException {
        org.json.JSONArray methods = new org.json.JSONArray();
        for (String name : PACKAGE_METHODS) methods.put(PREFIX + name);
        return new JSONObject().put("v", VERSION).put("capabilities", new JSONObject()
                .put("device.packages", new JSONObject().put("v", VERSION).put("methods", methods))
                .put("identity", new JSONObject().put("v", VERSION).put("methods", new org.json.JSONArray()
                    .put("identity.info").put("identity.setup").put("identity.sign").put("identity.nip44_encrypt").put("identity.nip44_decrypt")))
                .put("view.capture", new JSONObject().put("v", VERSION)));
    }

    public static JSONObject answer(String id, Object result, String error) throws JSONException {
        JSONObject response = new JSONObject().put("v", VERSION).put("id", id).put("ok", error == null);
        return error == null ? response.put("result", result == null ? JSONObject.NULL : result) : response.put("error", error);
    }
}
