package ai.wizards.shell.orb;

import org.json.JSONObject;
import ai.wizards.shell.device.DevicePort;

/** Narrow overlay-only recording control, never a general device port or microphone-start authority. */
final class OrbRecordingControl {
    private OrbRecordingControl() { }

    static boolean allowed(String page, String source, boolean mainFrame, String loadedOwner, String selectedOwner) {
        return mainFrame && (OrbPolicy.VIRTUAL.equals(source) || (OrbPolicy.VIRTUAL + "/").equals(source))
                && OrbPolicy.samePage(OrbPolicy.bundledUrl(), page)
                && loadedOwner != null && loadedOwner.equals(selectedOwner);
    }

    static String method(JSONObject request, String activeId) {
        if (request == null || activeId == null) return null;
        try { DevicePort.parse(request); } catch (org.json.JSONException e) { return null; }
        JSONObject params = request.optJSONObject("params");
        if (params == null || !activeId.equals(params.optString("id"))) return null;
        String method = request.optString("method");
        return method.equals("device.recording.cancel") || (method.equals("device.recording.pause")
                && params.opt("on") instanceof Boolean) ? method : null;
    }
}
