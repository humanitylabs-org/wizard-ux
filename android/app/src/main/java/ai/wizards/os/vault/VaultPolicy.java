package ai.wizards.os.vault;

import java.util.Base64;

/** Pure checks for the fingerprint vault (unit-tested). */
public final class VaultPolicy {
    public static String method(String method) {
        return java.util.Arrays.asList("vault.has", "vault.seal", "vault.open", "vault.forget").contains(method) ? method : null;
    }

    public static org.json.JSONObject capability() throws org.json.JSONException {
        return new org.json.JSONObject().put("v", 1).put("methods", new org.json.JSONArray()
                .put("vault.has").put("vault.seal").put("vault.open").put("vault.forget"));
    }
    private VaultPolicy() { }

    /** App ids come from the shell's app registry: short, lowercase, no separators that could alias a key. */
    static boolean appId(String id) { return id != null && id.matches("[a-z0-9][a-z0-9-]{0,63}"); }

    static boolean secret(String s) { return s != null && !s.isEmpty() && s.length() <= 4096; }

    /** The prompt names the app; anything odd falls back to a neutral title. */
    static String title(String t) {
        if (t == null) return "Unlock";
        t = t.replaceAll("[\\p{Cntrl}]", "").trim();
        return t.isEmpty() || t.length() > 60 ? "Unlock" : t;
    }

    static String pack(byte[] iv, byte[] ct) {
        return Base64.getEncoder().encodeToString(iv) + ":" + Base64.getEncoder().encodeToString(ct);
    }

    static byte[][] unpack(String s) {
        if (s == null) return null;
        int i = s.indexOf(':'); if (i <= 0 || i == s.length() - 1) return null;
        try {
            byte[] iv = Base64.getDecoder().decode(s.substring(0, i)), ct = Base64.getDecoder().decode(s.substring(i + 1));
            return iv.length == 12 && ct.length >= 16 && ct.length <= 16400 ? new byte[][]{iv, ct} : null;
        }
        catch (IllegalArgumentException e) { return null; }
    }
}
