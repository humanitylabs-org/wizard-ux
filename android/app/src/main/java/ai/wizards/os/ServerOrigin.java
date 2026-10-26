package ai.wizards.os;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Pure, fail-closed parsing shared by pairing, persistence, bridges and migration. */
public final class ServerOrigin {
    private ServerOrigin() {}

    public static String parse(String text) {
        if (text == null || text.length() > 4096) return null;
        try {
            String input = text.trim();
            URI u = new URI(input);
            if ("wizard".equals(u.getScheme())) {
                if (!"connect".equals(u.getHost()) || u.getRawUserInfo() != null || u.getPort() != -1
                        || (u.getPath() != null && !u.getPath().isEmpty()) || u.getFragment() != null) return null;
                String q = u.getRawQuery();
                if (q == null || !q.startsWith("origin=") || q.contains("&")) return null;
                return https(URLDecoder.decode(q.substring(7), StandardCharsets.UTF_8.name()));
            }
            return https(input);
        } catch (Exception e) { return null; }
    }

    /** Instrumented emulator-only builds can paste a loopback fake. Release callers always pass false. */
    public static String parse(String text, boolean allowQa) {
        String clean = parse(text);
        if (clean != null || !allowQa || text == null) return clean;
        String t = text.trim();
        if (!t.matches("http://(localhost|10\\.0\\.2\\.2):[0-9]{2,5}")) return null;
        try { int port = new URI(t).getPort(); return port > 0 && port <= 65535 ? t : null; }
        catch (Exception e) { return null; }
    }

    private static String https(String input) throws Exception {
        URI u = new URI(input);
        String path = u.getRawPath();
        if (!"https".equalsIgnoreCase(u.getScheme()) || u.getHost() == null || u.getRawUserInfo() != null
                || u.getRawQuery() != null || u.getRawFragment() != null
                || !(path == null || path.isEmpty() || path.equals("/") || path.equals("/wizard-os-home/") || path.equals("/wizard-os-home"))) return null;
        int p = u.getPort();
        if (p == 0 || p > 65535 || p < -1 || u.getRawAuthority().endsWith(":")) return null;
        String host = u.getHost().toLowerCase(Locale.ROOT);
        if (host.endsWith(".")) return null;
        return "https://" + host + (p == -1 || p == 443 ? "" : ":" + p);
    }

    /** Stored choice wins; build default is a one-time silent migration for existing owner builds. */
    public static String migrated(String stored, String buildDefault) {
        String s = parse(stored);
        return s != null ? s : parse(buildDefault);
    }

    public static boolean matches(String origin, String url) {
        if (origin == null || origin.isEmpty() || url == null) return false;
        try {
            URI a = new URI(origin), b = new URI(url);
            int ap = a.getPort() == -1 ? ("https".equals(a.getScheme()) ? 443 : 80) : a.getPort();
            int bp = b.getPort() == -1 ? ("https".equals(b.getScheme()) ? 443 : 80) : b.getPort();
            return a.getScheme().equals(b.getScheme()) && a.getHost() != null && a.getHost().equalsIgnoreCase(b.getHost())
                    && ap == bp && b.getRawUserInfo() == null;
        } catch (Exception e) { return false; }
    }

    public static boolean needsTailscale(String origin) {
        try { String h = new URI(origin).getHost(); return h != null && h.endsWith(".ts.net"); }
        catch (Exception e) { return false; }
    }
}
