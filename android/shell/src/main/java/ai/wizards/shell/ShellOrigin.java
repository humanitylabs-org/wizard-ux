package ai.wizards.shell;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Pure, fail-closed rules for the one Wizard address the shell trusts. Unit-tested off-device. */
public final class ShellOrigin {
    static final String HOME_PATH = "/wizard-os-home/";
    /** Where ShellActivity keeps the selected Wizard (SharedPreferences name and key). */
    public static final String PREFS = "shell", KEY = "origin";

    private ShellOrigin() {}

    /** The selected Wizard's origin, or null: the one place services read it. */
    public static String selected(android.content.Context c) {
        return parse(c.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE).getString(KEY, null));
    }

    /**
     * Accepts what an owner pastes or a Setup QR carries: {@code https://host[:port]}, optionally ending in
     * {@code /} or {@code /wizard-os-home/}, a bare {@code host[:port]}, or {@code wizard://connect?origin=<encoded>}.
     * Returns the normalised origin ({@code https://host[:port]}, port 443 dropped) or null.
     */
    public static String parse(String text) {
        if (text == null) return null;
        String t = text.trim();
        if (t.isEmpty() || t.length() > 2048) return null;
        try {
            if (t.regionMatches(true, 0, "wizard:", 0, 7)) {
                URI u = new URI(t);
                String q = u.getRawQuery();
                if (!"wizard".equalsIgnoreCase(u.getScheme()) || !"connect".equals(u.getHost())
                        || q == null || !q.startsWith("origin=") || q.contains("&")) return null;
                return https(URLDecoder.decode(q.substring(7), StandardCharsets.UTF_8.name()));
            }
            if (!t.contains("://")) t = "https://" + t;
            return https(t);
        } catch (Exception e) {
            return null;
        }
    }

    private static String https(String input) throws Exception {
        URI u = new URI(input.trim());
        if (!"https".equalsIgnoreCase(u.getScheme()) || u.getHost() == null || u.getRawUserInfo() != null
                || u.getRawQuery() != null || u.getRawFragment() != null) return null;
        String path = u.getRawPath();
        if (!(path == null || path.isEmpty() || path.equals("/") || path.equals("/wizard-os-home")
                || path.equals(HOME_PATH))) return null;
        int p = u.getPort();
        if (p == 0 || p < -1 || p > 65535) return null;
        String host = u.getHost().toLowerCase(Locale.ROOT);
        if (host.endsWith(".") || host.contains("..")) return null;
        return "https://" + host + (p == -1 || p == 443 ? "" : ":" + p);
    }

    static String home(String origin) {
        return origin + HOME_PATH;
    }

    /** Same scheme, host and port as the saved origin (an implicit 443 equals an explicit one). */
    static boolean same(String origin, String url) {
        if (origin == null || url == null) return false;
        try {
            URI a = new URI(origin), b = new URI(url);
            return "https".equalsIgnoreCase(b.getScheme()) && a.getHost() != null
                    && a.getHost().equalsIgnoreCase(b.getHost()) && b.getRawUserInfo() == null
                    && port(a) == port(b);
        } catch (Exception e) {
            return false;
        }
    }

    private static int port(URI u) {
        return u.getPort() == -1 ? 443 : u.getPort();
    }

    /** Tailscale names; the reach screen then suggests turning Tailscale on. */
    static boolean tailnet(String origin) {
        try {
            String h = new URI(origin).getHost();
            return h != null && h.endsWith(".ts.net");
        } catch (Exception e) {
            return false;
        }
    }
}
