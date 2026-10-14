package ai.wizards.os;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Identity is box origin + stable registered app ID; routes resolve in the shell. */
public final class HomeScreenPolicy {
    private HomeScreenPolicy() {}
    public static boolean validId(String id) { return id != null && id.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}"); }
    public static String identity(String origin, String id) {
        if (!validId(id) || origin == null || origin.isEmpty()) throw new IllegalArgumentException("invalid app identity");
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest((origin + "\n" + id).getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder("homeapp-");
            for (byte b : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            return out.toString();
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
