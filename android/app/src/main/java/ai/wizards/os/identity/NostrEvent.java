package ai.wizards.os.identity;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/** NIP-01 bytes, not Android JSONObject's slash-escaped serialization. Port of 975c253. */
public final class NostrEvent {
    private NostrEvent() { }
    private static void require(boolean condition) {
        if (!condition) throw new IllegalArgumentException("Invalid event");
    }
    private static long integer(Object value) {
        require(value instanceof Integer || value instanceof Long);
        return ((Number) value).longValue();
    }
    public static JSONObject normalize(JSONObject input, String pubkey, long now) throws JSONException {
        require(input.toString().getBytes(StandardCharsets.UTF_8).length <= 131072);
        if (input.has("pubkey")) require(pubkey.equals(input.get("pubkey")));
        long kind = integer(input.get("kind"));
        require(kind >= 0 && kind <= 65535);
        long created = input.has("created_at") ? integer(input.get("created_at")) : now;
        require(created >= 0 && created <= 9007199254740991L);
        JSONArray tags = input.getJSONArray("tags");
        for (int i = 0; i < tags.length(); i++) {
            JSONArray tag = tags.getJSONArray(i);
            for (int j = 0; j < tag.length(); j++) require(tag.get(j) instanceof String);
        }
        require(input.get("content") instanceof String);
        return new JSONObject().put("pubkey", pubkey).put("created_at", created).put("kind", kind)
                .put("tags", new JSONArray(tags.toString())).put("content", input.getString("content"));
    }
    public static String canonical(JSONObject e) throws JSONException {
        JSONArray tags = e.getJSONArray("tags");
        StringBuilder b = new StringBuilder("[0,").append(quote(e.getString("pubkey"))).append(',')
                .append(e.getLong("created_at")).append(',').append(e.getInt("kind")).append(",[");
        for (int i = 0; i < tags.length(); i++) {
            if (i > 0) b.append(',');
            b.append('['); JSONArray tag = tags.getJSONArray(i);
            for (int j = 0; j < tag.length(); j++) { if (j > 0) b.append(','); b.append(quote(tag.getString(j))); }
            b.append(']');
        }
        return b.append("],").append(quote(e.getString("content"))).append(']').toString();
    }
    private static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    boolean high = Character.isHighSurrogate(c) && (i + 1 == s.length() || !Character.isLowSurrogate(s.charAt(i + 1)));
                    boolean low = Character.isLowSurrogate(c) && (i == 0 || !Character.isHighSurrogate(s.charAt(i - 1)));
                    if (c < 32 || high || low) b.append(String.format(Locale.ROOT, "\\u%04x", (int)c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }
    public static byte[] digest(JSONObject e) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(canonical(e).getBytes(StandardCharsets.UTF_8));
    }
    public static String sentence(JSONObject e) throws JSONException {
        switch (e.getInt("kind")) {
            case 0: return "Update your profile";
            case 1: return "Post publicly";
            case 3: return "Change who you follow";
            case 13: return "Send a sealed friend request";
            case 30078:
                if (deviceEvent(e)) return hasTag(e, "revoked") ? "Remove a Wizard from your Wizard ID" : "Let this Wizard receive for you";
                return "Unfamiliar request";
            case 1078:
                if (friendEvent(e)) return "Add " + shortNpub(tag(e, "p")) + " as a friend";
                return "Unfamiliar request";
            case 30117: return "Publish " + name(e) + " as your skin";
            case 30617: return "Publish " + name(e) + " as your app";
            default: return "Unfamiliar request";
        }
    }
    private static final String KEY = "[0-9a-f]{64}";
    /** A friendly label hides the raw event, so every tag must be one the label describes (partial matches stay Unfamiliar). */
    private static boolean deviceEvent(JSONObject e) throws JSONException {
        JSONArray tags = e.getJSONArray("tags"); int d = 0, keys = 0;
        for (int i = 0; i < tags.length(); i++) {
            JSONArray t = tags.getJSONArray(i); String key = t.optString(0);
            if ("d".equals(key) && t.length() == 2 && "wizard-devices".equals(t.optString(1))) d++;
            else if ("p".equals(key) && t.length() <= 4 && t.optString(1).matches(KEY)) keys++;
            else if ("revoked".equals(key) && t.length() <= 3 && t.optString(1).matches(KEY)) keys++;
            else return false;
        }
        return d == 1 && keys > 0;
    }
    private static boolean friendEvent(JSONObject e) throws JSONException {
        JSONArray tags = e.getJSONArray("tags"); int p = 0;
        for (int i = 0; i < tags.length(); i++) {
            JSONArray t = tags.getJSONArray(i); String key = t.optString(0);
            if ("p".equals(key) && t.length() == 2 && t.optString(1).matches(KEY)) p++;
            else if (!"t".equals(key) || t.length() != 2) return false;
        }
        return p == 1 && hasTagValue(e, "t", "wizard-profile");
    }
    public static String tag(JSONObject e, String key) throws JSONException {
        JSONArray tags = e.getJSONArray("tags");
        for (int i = 0; i < tags.length(); i++) { JSONArray t = tags.getJSONArray(i); if (key.equals(t.optString(0))) return t.optString(1); }
        return "";
    }
    private static boolean hasTag(JSONObject e, String key) throws JSONException {
        JSONArray tags = e.getJSONArray("tags");
        for (int i = 0; i < tags.length(); i++) if (key.equals(tags.getJSONArray(i).optString(0))) return true;
        return false;
    }
    private static boolean hasTagValue(JSONObject e, String key, String value) throws JSONException {
        JSONArray tags = e.getJSONArray("tags");
        for (int i = 0; i < tags.length(); i++) { JSONArray t = tags.getJSONArray(i); if (key.equals(t.optString(0)) && value.equals(t.optString(1))) return true; }
        return false;
    }
    public static String shortNpub(String hex) {
        if (!hex.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid public key");
        String npub = Nip19.encode("npub", bytes(hex)); return npub.substring(0, 12) + "…" + npub.substring(npub.length() - 6);
    }
    public static String deviceBody(JSONObject e) throws JSONException {
        if (e.getInt("kind") != 30078 || !"wizard-devices".equals(tag(e, "d"))) return "";
        StringBuilder body = new StringBuilder(); JSONArray tags = e.getJSONArray("tags");
        for (int i = 0; i < tags.length(); i++) {
            JSONArray t = tags.getJSONArray(i); String key = t.optString(0), pub = t.optString(1);
            if (("p".equals(key) || "revoked".equals(key)) && pub.matches("[0-9a-f]{64}")) {
                if (body.length() > 0) body.append('\n'); body.append("revoked".equals(key) ? "Remove: " : "Wizard: ").append(shortNpub(pub));
            }
        }
        return body.toString();
    }
    /** Validate the inner event before describing it, discarding requester-supplied descriptions. */
    public static String encryptionSentence(String plaintext, String recipient, String owner) {
        String who = shortNpub(recipient);
        try {
            JSONObject inner = new JSONObject(plaintext);
            JSONObject event = normalize(inner, owner, System.currentTimeMillis() / 1000);
            return sentence(event) + " · sealed to " + who;
        } catch (Exception ignored) { return "Encrypt a private message to " + who; }
    }
    private static String name(JSONObject e) throws JSONException {
        JSONArray tags = e.getJSONArray("tags");
        for (String key : new String[]{"name", "d"}) for (int i = 0; i < tags.length(); i++) {
            JSONArray t = tags.getJSONArray(i);
            if (key.equals(t.optString(0)) && t.length() > 1) {
                String label = t.getString(1).replaceAll("[\\p{Cc}\\p{Cf}]", "").trim();
                if (!label.isEmpty()) return label.substring(0, Math.min(120, label.length()));
            }
        }
        return "Untitled";
    }
    public static String hex(byte[] bytes) {
        StringBuilder b = new StringBuilder();
        for (byte v : bytes) b.append(String.format(Locale.ROOT, "%02x", v & 255));
        return b.toString();
    }
    public static byte[] bytes(String hex) {
        if (!hex.matches("[0-9a-fA-F]+") || hex.length() % 2 != 0) throw new IllegalArgumentException("Invalid hex");
        byte[] b = new byte[hex.length() / 2];
        for (int i = 0; i < b.length; i++) b[i] = (byte)Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return b;
    }
}
