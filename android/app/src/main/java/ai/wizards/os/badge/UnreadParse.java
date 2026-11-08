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
}
