package ai.wizards.os.vault;

import android.util.Base64;

/** Pure checks for the fingerprint vault (unit-tested). */
final class VaultPolicy {
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
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    static byte[][] unpack(String s) {
        if (s == null) return null;
        int i = s.indexOf(':'); if (i <= 0 || i == s.length() - 1) return null;
        try { return new byte[][]{Base64.decode(s.substring(0, i), Base64.NO_WRAP), Base64.decode(s.substring(i + 1), Base64.NO_WRAP)}; }
        catch (IllegalArgumentException e) { return null; }
    }
}
