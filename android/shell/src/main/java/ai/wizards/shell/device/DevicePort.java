package ai.wizards.shell.device;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * wizardDevicePort v1, the shell's one device-capability protocol (same envelope as android/app's
 * DeviceMessageProtocol, docs/android-device-message-port.md). No Android dependencies; JVM-tested.
 *
 * Page → native: {v:1, id, method, params?}. Native → page: {v:1, id, ok, result | error}.
 * "device.capabilities" lists every registered adapter and its exact methods. Dispatch is an exact allowlist:
 * a method is answered only if its adapter is registered and advertises that exact name.
 */
public final class DevicePort {
    public static final String NAME = "wizardDevicePort";
    public static final int VERSION = 1;
    public static final String DISCOVERY = "device.capabilities";

    private DevicePort() { }

    /** One optional device capability, e.g. "device.recording". Calls arrive on a background thread. */
    public interface Adapter {
        String name();
        int version();
        String[] methods(); // short names, e.g. "start"; advertised as name + "." + method
        void call(String method, JSONObject params, Reply reply);
    }

    public interface Reply {
        void ok(Object result);
        void error(String message);
    }

    public static final class Request {
        public final String id, method;
        public final JSONObject params;
        private Request(String id, String method, JSONObject params) { this.id = id; this.method = method; this.params = params; }
    }

    public static Request parse(String data) throws JSONException {
        if (data == null) throw new JSONException("not a string message");
        return parse(new JSONObject(data));
    }

    public static Request parse(JSONObject message) throws JSONException {
        Object version = message.opt("v");
        if (!(version instanceof Number) || ((Number) version).doubleValue() != VERSION) throw new JSONException("unsupported version");
        Object id = message.opt("id"), method = message.opt("method"), params = message.opt("params");
        if (!(id instanceof String) || ((String) id).isEmpty() || ((String) id).length() > 64) throw new JSONException("invalid id");
        if (!(method instanceof String)) throw new JSONException("invalid method");
        if (message.has("params") && !(params instanceof JSONObject)) throw new JSONException("invalid params");
        return new Request((String) id, (String) method, params instanceof JSONObject ? (JSONObject) params : new JSONObject());
    }

    /** Registered adapters by name, in registration order. */
    public static final class Registry {
        private final Map<String, Adapter> adapters = new LinkedHashMap<>();

        public Registry add(Adapter a) {
            if (a == null || !a.name().matches("device\\.[a-z][a-zA-Z]*") || adapters.containsKey(a.name()))
                throw new IllegalArgumentException("bad adapter");
            adapters.put(a.name(), a);
            return this;
        }

        /** The adapter and short method for an exact advertised full name, or null. */
        public Target target(String full) {
            if (full == null) return null;
            int dot = full.lastIndexOf('.');
            if (dot <= 0) return null;
            Adapter a = adapters.get(full.substring(0, dot));
            if (a == null) return null;
            String m = full.substring(dot + 1);
            for (String x : a.methods()) if (x.equals(m)) return new Target(a, m);
            return null;
        }

        public JSONObject capabilities() throws JSONException {
            JSONObject caps = new JSONObject();
            for (Adapter a : adapters.values()) {
                JSONArray methods = new JSONArray();
                for (String m : a.methods()) methods.put(a.name() + "." + m);
                caps.put(a.name(), new JSONObject().put("v", a.version()).put("methods", methods));
            }
            return new JSONObject().put("v", VERSION).put("capabilities", caps);
        }
    }

    public static final class Target {
        public final Adapter adapter;
        public final String method;
        Target(Adapter adapter, String method) { this.adapter = adapter; this.method = method; }
    }

    public static JSONObject answer(String id, Object result, String error) throws JSONException {
        JSONObject r = new JSONObject().put("v", VERSION).put("id", id).put("ok", error == null);
        return error == null ? r.put("result", result == null ? JSONObject.NULL : result) : r.put("error", error);
    }

    /** Only the Wizard shell itself: the selected origin's top-level /wizard-os-home page. */
    public static boolean shellPath(String path) {
        return path != null && (path.equals("/wizard-os-home") || path.startsWith("/wizard-os-home/"));
    }
}
