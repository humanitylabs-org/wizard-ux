package ai.wizards.os.update;

import org.json.JSONObject;

import java.net.URI;

/** Pure rules for the in-app update feed (unit-tested off-device). */
public final class UpdatePolicy {
    private UpdatePolicy() {}

    public static final class Release {
        public final int versionCode;
        public final String versionName, url, sha256, notes;
        public final long bytes;

        Release(int versionCode, String versionName, String url, String sha256, long bytes, String notes) {
            this.versionCode = versionCode; this.versionName = versionName; this.url = url; this.sha256 = sha256;
            this.bytes = bytes; this.notes = notes;
        }
    }

    /**
     * latest.json → Release, or null when malformed. The APK must come from the same origin as the feed
     * (https, or the QA build's plain-http fake on the emulator host), and carry a full SHA-256.
     */
    public static Release parse(JSONObject o, String feedUrl) {
        if (o == null) return null;
        int vc = o.optInt("versionCode", 0);
        String name = o.optString("versionName", o.optString("version", ""));
        String sha = o.optString("sha256", "").toLowerCase(java.util.Locale.ROOT);
        String url = o.optString("url", "");
        long bytes = o.optLong("bytes", o.optLong("size", 0));
        if (vc <= 0 || name.isEmpty() || !sha.matches("[0-9a-f]{64}") || url.isEmpty()) return null;
        String abs = resolve(feedUrl, url);
        if (abs == null || !sameOrigin(feedUrl, abs)) return null;
        return new Release(vc, name, abs, sha, bytes, o.optString("notes", ""));
    }

    public static boolean newer(Release r, int installed) { return r != null && r.versionCode > installed; }

    static String resolve(String base, String ref) {
        try { return URI.create(base).resolve(ref).toString(); } catch (RuntimeException e) { return null; }
    }

    static boolean sameOrigin(String a, String b) {
        try {
            URI x = URI.create(a), y = URI.create(b);
            String sx = x.getScheme(), sy = y.getScheme();
            if (sx == null || !sx.equals(sy) || !("https".equals(sx) || "http".equals(sx))) return false;
            return x.getHost() != null && x.getHost().equalsIgnoreCase(y.getHost()) && port(x) == port(y);
        } catch (RuntimeException e) { return false; }
    }

    private static int port(URI u) { return u.getPort() != -1 ? u.getPort() : "https".equals(u.getScheme()) ? 443 : 80; }

    /** Every certificate of the installed app must sign the update, and nothing else (no added or rotated keys). */
    public static boolean sameSigners(java.util.Set<String> installed, java.util.Set<String> update) {
        return installed != null && update != null && !installed.isEmpty() && installed.equals(update);
    }
}
