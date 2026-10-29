package ai.wizards.os.mizel;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

/**
 * The page ⇄ native protocol on window.wizardMizelPort (see android/MIZEL_RECORDER.md). Pure Java + org.json so
 * every message shape is unit-tested off-device.
 */
public final class MizelProtocol {
    public static final String START = "start", PAUSE = "pause", RESUME = "resume", STOP = "stop", STATUS = "status", PCM = "pcm";

    public static final String E_BAD_REQUEST = "bad_request", E_UNKNOWN_CMD = "unknown_cmd", E_BAD_MEETING_ID = "bad_meeting_id",
            E_MIC_PERMISSION = "mic_permission", E_MIC_BUSY = "mic_busy", E_BUSY_OTHER = "busy_other_meeting",
            E_NOT_RECORDING = "not_recording", E_WRONG_MEETING = "wrong_meeting", E_START_FAILED = "start_failed";

    private MizelProtocol() {}

    public static final class Cmd {
        /** The page's id, echoed back unchanged (string or number); JSONObject.NULL when absent. */
        public Object id = JSONObject.NULL;
        public String cmd, meetingId, error;
        public boolean enabled;
    }

    public static Cmd parse(String data) {
        Cmd c = new Cmd();
        JSONObject o;
        try { o = new JSONObject(data == null ? "" : data); }
        catch (JSONException e) { c.error = E_BAD_REQUEST; return c; }
        Object id = o.opt("id");
        if (id instanceof String || id instanceof Number) c.id = id;
        c.cmd = o.optString("cmd", "");
        c.enabled = o.optBoolean("enabled", false);
        String mid = o.isNull("meetingId") ? null : o.optString("meetingId", null);
        c.meetingId = mid == null || mid.isEmpty() ? null : mid;
        switch (c.cmd) {
            case START: case PCM:
                if (c.meetingId == null || !MizelPolicy.validMeetingId(c.meetingId)) c.error = E_BAD_MEETING_ID;
                break;
            case PAUSE: case RESUME: case STOP: case STATUS:
                if (c.meetingId != null && !MizelPolicy.validMeetingId(c.meetingId)) c.error = E_BAD_MEETING_ID;
                break;
            default:
                c.error = c.cmd.isEmpty() ? E_BAD_REQUEST : E_UNKNOWN_CMD;
        }
        return c;
    }

    /** {id, ok, error?, status?}; status is the state object (without "type"). */
    public static String reply(Object id, boolean ok, String error, JSONObject status) {
        try {
            JSONObject r = new JSONObject().put("id", id == null ? JSONObject.NULL : id).put("ok", ok);
            if (error != null) r.put("error", error);
            if (status != null) r.put("status", status);
            return r.toString();
        } catch (JSONException e) { return "{\"ok\":false,\"error\":\"internal\"}"; }
    }

    /** The state object shared by replies (status) and pushes ({type:'state', …}). */
    public static JSONObject state(boolean recording, boolean paused, String meetingId, long mediaMs, int pendingChunks,
                                   long pausedMs, String phase, long pauseTimeoutMs) {
        try {
            return new JSONObject().put("recording", recording).put("paused", paused)
                    .put("meetingId", meetingId == null ? JSONObject.NULL : meetingId).put("mediaMs", mediaMs)
                    .put("pendingChunks", pendingChunks).put("pausedMs", pausedMs)
                    .put("phase", phase).put("pauseTimeoutMs", pauseTimeoutMs).put("livePcm", true);
        } catch (JSONException e) { return new JSONObject(); }
    }

    public static String statePush(JSONObject state) {
        try { return new JSONObject(state.toString()).put("type", "state").toString(); }
        catch (JSONException e) { return "{\"type\":\"state\"}"; }
    }

    public static String pcmPush(String meetingId, byte[] pcm, long startMs) {
        try { return new JSONObject().put("type", "pcm").put("meetingId", meetingId).put("startMs", startMs)
                .put("pcm", java.util.Base64.getEncoder().encodeToString(pcm)).toString(); }
        catch (JSONException e) { return "{}"; }
    }

    public static String levelPush(float me) {
        return String.format(Locale.US, "{\"type\":\"level\",\"me\":%.3f}", Math.max(0f, Math.min(1f, me)));
    }
}
