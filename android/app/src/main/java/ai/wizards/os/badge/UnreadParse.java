package ai.wizards.os.badge;

import org.json.JSONObject;

/**
 * Reads the proposed Messenger unread-total reply: {"ok":true,"result":{"unread_total":N}} (the service's
 * usual envelope) or the bare {"unread_total":N}. Only a number is read: no names, ids or message text.
 */
public final class UnreadParse {
    private UnreadParse() {}
    /** @return the clamped count, or -1 when the reply has no usable number. */
    public static int total(JSONObject reply) {
        if (reply == null) return -1;
        JSONObject body = reply.optJSONObject("result");
        if (body == null) body = reply;
        if (!body.has("unread_total")) return -1;
        Object v = body.opt("unread_total");
        if (!(v instanceof Number)) return -1;
        double d = ((Number) v).doubleValue();
        if (Double.isNaN(d) || d < 0) return -1;
        return BadgeText.clamp((int) Math.min(d, BadgeText.MAX_STORED));
    }

    /**
     * A failed read. 404 clears the badge (0) only when it is Messenger's own JSON "not_found" (its {@code unread-count}
     * switch is off). Any other 404, such as a proxy or directory answering the wrong path in plain text, is unknown (-1):
     * it must not look like "nothing unread". Offline, 5xx and locked are unknown too and leave the badge as it is.
     */
    public static int forStatus(int status, String body) { return status == 404 && switchOff(body) ? 0 : -1; }

    private static boolean switchOff(String body) {
        if (body == null || body.isEmpty()) return false;
        try {
            JSONObject o = new JSONObject(body);
            JSONObject err = o.optJSONObject("error");
            return "not_found".equals(err != null ? err.optString("code") : o.optString("code"));
        } catch (org.json.JSONException e) { return false; }
    }
}
