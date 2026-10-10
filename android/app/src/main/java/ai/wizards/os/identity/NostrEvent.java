package ai.wizards.os.identity;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * A Nostr event the owner is asked to sign. Native rebuilds it from the request: the pubkey is always the owner's,
 * the id is recomputed here (NIP-01 serialization), and anything malformed is refused before the sheet opens.
 */
public final class NostrEvent {
    public static final int MAX_CONTENT = 64 * 1024;
    public static final int MAX_TAGS = 2000;

    public final int kind;
    public final long createdAt;
    public final JSONArray tags;
    public final String content;

    private NostrEvent(int kind, long createdAt, JSONArray tags, String content) {
        this.kind = kind; this.createdAt = createdAt; this.tags = tags; this.content = content;
    }

    /** Validates a request's unsigned event. {@code now} fills a missing created_at. Throws with a plain reason. */
    public static NostrEvent fromRequest(JSONObject e, String ownerPubkey, long now) {
        if (e == null) throw new IllegalArgumentException("No event to sign.");
        Object k = e.opt("kind");
        if (!(k instanceof Integer) || (Integer) k < 0 || (Integer) k > 65535) throw new IllegalArgumentException("The event kind is invalid.");
        long at = now;
        if (e.has("created_at")) {
            Object c = e.opt("created_at");
            if (!(c instanceof Integer || c instanceof Long)) throw new IllegalArgumentException("The event time is invalid.");
            at = ((Number) c).longValue();
            if (at < 0 || at > 4102444800L) throw new IllegalArgumentException("The event time is invalid.");
        }
        Object pk = e.opt("pubkey");
        if (pk != null && pk != JSONObject.NULL && !"".equals(pk) && !ownerPubkey.equals(pk))
            throw new IllegalArgumentException("This event names a different identity.");
        Object c = e.opt("content");
        String content = c == null || c == JSONObject.NULL ? "" : c instanceof String ? (String) c : null;
        if (content == null) throw new IllegalArgumentException("The event content must be text.");
        if (content.length() > MAX_CONTENT) throw new IllegalArgumentException("The event is too large.");
        JSONArray tags = new JSONArray();
        Object t = e.opt("tags");
        if (t != null && t != JSONObject.NULL) {
            if (!(t instanceof JSONArray)) throw new IllegalArgumentException("The event tags are invalid.");
            JSONArray in = (JSONArray) t;
            if (in.length() > MAX_TAGS) throw new IllegalArgumentException("The event has too many tags.");
            for (int i = 0; i < in.length(); i++) {
                Object row = in.opt(i);
                if (!(row instanceof JSONArray) || ((JSONArray) row).length() == 0) throw new IllegalArgumentException("The event tags are invalid.");
                JSONArray r = (JSONArray) row, copy = new JSONArray();
                for (int j = 0; j < r.length(); j++) {
                    Object v = r.opt(j);
                    if (!(v instanceof String)) throw new IllegalArgumentException("The event tags are invalid.");
                    copy.put(v);
                }
                tags.put(copy);
            }
        }
        return new NostrEvent((Integer) k, at, tags, content);
    }

    /** NIP-01: sha256 of [0, pubkey, created_at, kind, tags, content] with no extra whitespace. */
    public String serialize(String pubkey) {
        StringBuilder sb = new StringBuilder("[0,");
        quote(sb, pubkey);
        sb.append(',').append(createdAt).append(',').append(kind).append(",[");
        for (int i = 0; i < tags.length(); i++) {
            if (i > 0) sb.append(',');
            JSONArray r = tags.optJSONArray(i);
            sb.append('[');
            for (int j = 0; j < r.length(); j++) { if (j > 0) sb.append(','); quote(sb, r.optString(j)); }
            sb.append(']');
        }
        sb.append("],");
        quote(sb, content);
        return sb.append(']').toString();
    }

    public byte[] id(String pubkey) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(serialize(pubkey).getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    public JSONObject signed(String pubkey, String sigHex) throws JSONException {
        return new JSONObject()
                .put("id", Hex.of(id(pubkey)))
                .put("pubkey", pubkey)
                .put("created_at", createdAt)
                .put("kind", kind)
                .put("tags", tags)
                .put("content", content)
                .put("sig", sigHex);
    }

    public String tag(String name) {
        for (int i = 0; i < tags.length(); i++) {
            JSONArray r = tags.optJSONArray(i);
            if (r != null && r.length() > 1 && name.equals(r.optString(0))) return r.optString(1);
        }
        return null;
    }

    /** NIP-01 string escaping: only \n \" \\ \r \t \b \f and other control chars; everything else is raw UTF-8. */
    static void quote(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (ch < 0x20) sb.append(String.format("\\u%04x", (int) ch));
                    else sb.append(ch);
            }
        }
        sb.append('"');
    }
}
