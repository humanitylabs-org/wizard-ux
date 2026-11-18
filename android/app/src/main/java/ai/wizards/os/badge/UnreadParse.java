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
     * A failed read. 404 means Messenger answers but its {@code unread-count} switch is off (or the endpoint is
     * gone): nothing to show, so the badge clears (0). Anything else (offline, 5xx, locked) is unknown (-1) and
     * leaves the badge as it is.
     */
    public static int forStatus(int status) { return status == 404 ? 0 : -1; }
}
