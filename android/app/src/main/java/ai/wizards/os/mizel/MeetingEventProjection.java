package ai.wizards.os.mizel;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Turns a native meeting-loan receipt (SharedPreferences "meeting-handoffs-v1") into the Mizel orb-events row the
 * meeting transcript shows ("Voice typing · …", "Asked Archimedes"). Only receipts written by a NATIVE borrower
 * (floating orb, side button) carry {@code source}; the in-app orb's receipts are projected by the shell's journal
 * (web/core/orb-handoff.js) and are skipped here so the same interruption is never posted twice.
 * Pure Java (org.json) so it is unit-tested off-device.
 */
public final class MeetingEventProjection {
    private MeetingEventProjection() {}

    static final String[] STATUSES = {"paused", "captured", "queued", "failed", "unconfirmed", "sent", "cancelled", "local"};
    private static final String ID = "[A-Za-z0-9_-]{1,160}";

    /** Due for upload: a native receipt whose latest revision the server has not confirmed yet. */
    public static boolean pending(JSONObject r) {
        return body(r) != null && r.optLong("acked", -1) != r.optLong("rev", 0);
    }

    /** The PUT /mizel-live/orb-events body, or null when this receipt is not a projectable native event. */
    public static JSONObject body(JSONObject r) {
        if (r == null) return null;
        String source = r.optString("source"), id = r.optString("id"), mid = r.optString("meetingId"), status = r.optString("event");
        if (source.isEmpty() || !id.matches(ID) || !mid.matches(ID) || !valid(status)) return null;
        long rev = r.optLong("rev", 0), at = r.optLong("atMediaMs", -1);
        if (rev < 1 || at < 0) return null;
        try {
            JSONObject b = new JSONObject()
                    .put("id", id).put("meetingId", mid).put("captureId", captureId(mid))
                    .put("atMediaMs", at).put("clientRevision", rev).put("status", status)
                    .put("kind", "dictation".equals(r.optString("kind")) ? "dictation" : "ask")
                    .put("source", source)
                    .put("question", question(r))
                    .put("pausedByHandoff", r.optBoolean("pausedByHandoff"))
                    .put("steered", false).put("agent", "");
            String target = r.optString("target").trim();
            if (!target.isEmpty()) b.put("target", target.length() > 80 ? target.substring(0, 80) : target);
            for (String k : new String[]{"voiceTakeId", "deliveryKey", "threadId", "runId", "audioFileId"}) {
                String v = r.optString(k);
                if (v.matches(ID)) b.put(k, v);
            }
            for (String k : new String[]{"pausedAt", "endedAt"}) if (r.optLong(k, 0) > 0) b.put(k, r.optLong(k));
            String err = r.optString("error");
            if (!err.isEmpty()) b.put("error", err.length() > 300 ? err.substring(0, 300) : err);
            return b;
        } catch (JSONException e) { return null; }
    }

    /**
     * What the meeting card says. The live Mizel card shows status as the heading ("Asked Archimedes" when sent,
     * "On-device operation" when local) and this line under it, so voice typing reads
     * "Voice typing into Messages · see you at five" and an ask reads as the words asked.
     */
    public static String question(JSONObject r) {
        String text = r.optString("text").trim();
        if (!"dictation".equals(r.optString("kind"))) return text;
        String target = r.optString("target").trim();
        if (target.length() > 80) target = target.substring(0, 80);
        StringBuilder q = new StringBuilder("Voice typing");
        if (!target.isEmpty()) q.append(" into ").append(target);
        if ("copied".equals(r.optString("inserted"))) q.append(" (copied)");
        if (!text.isEmpty()) q.append(" · ").append(text);
        return q.toString();
    }

    /** The native recorder has no shell capture row: its capture is the meeting itself. */
    public static String captureId(String meetingId) { return "native-" + meetingId; }

    /** Did the server store at least this revision of exactly this event? */
    public static boolean confirms(JSONObject saved, JSONObject sent) {
        return saved != null && sent != null && sent.optString("id").equals(saved.optString("id"))
                && sent.optString("meetingId").equals(saved.optString("meetingId"))
                && sent.optString("captureId").equals(saved.optString("captureId"))
                && saved.optLong("clientRevision", 0) >= sent.optLong("clientRevision", 1);
    }

    static boolean valid(String status) {
        for (String s : STATUSES) if (s.equals(status)) return true;
        return false;
    }

    /** Shallow merge: patch keys win, JSONObject.NULL deletes. */
    public static JSONObject merge(JSONObject base, JSONObject patch) {
        JSONObject out;
        try { out = base == null ? new JSONObject() : new JSONObject(base.toString()); } catch (JSONException e) { out = new JSONObject(); }
        if (patch == null) return out;
        java.util.Iterator<String> keys = patch.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            Object v = patch.opt(k);
            try { if (v == null || v == JSONObject.NULL) out.remove(k); else out.put(k, v); } catch (JSONException ignored) { }
        }
        return out;
    }
}
