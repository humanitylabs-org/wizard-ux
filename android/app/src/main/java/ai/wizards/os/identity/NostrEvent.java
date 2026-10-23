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
            case 30117: return "Publish " + name(e) + " as your skin";
            case 30617: return "Publish " + name(e) + " as your app";
            default: return "Unfamiliar request";
        }
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
