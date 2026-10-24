package ai.wizards.shell.orb;

import java.net.URI;
import java.util.Set;

/**
 * Pure URL and document policy for the floating orb's WebView, ported from android/app's OverlayPolicy (#323).
 * One difference: the selected Wizard may use any HTTPS port (test boxes run on :8444), exactly as Connect accepts.
 */
public final class OrbPolicy {
    public static final String PAGE = "everywhere.html";
    static final String ASSETS = "file:///android_asset/wizard-os-home/";
    static final String SHELL = "/wizard-os-home/";
    /** Document origin of the remote orb page. Never the Wizard origin: a service worker registered there (web/sw.js)
     *  would answer the overlay's requests inside WebView, where shouldInterceptRequest never sees them. No page can
     *  be served at this reserved .invalid name (RFC 6761) except through OrbPage, whose CSP denies workers. */
    public static final String VIRTUAL = "https://wizard-overlay.invalid";
    /** Same policy as #323, embedded in the page and injected natively before any remote markup. */
    public static final String CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data:; frame-src 'none'; child-src 'none'; worker-src 'none'; "
            + "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    /** Exactly what the orb page loads. */
    static final Set<String> FILES = Set.of("assist/everywhere.html", "assist/everywhere.js", "assist/orb-size.js",
            "orb.js", "robert-thread-orb.png", "robert-listening-galaxy.png");

    private OrbPolicy() {}

    public static String remoteUrl(String origin) {
        return isHttpsOrigin(origin) ? VIRTUAL + SHELL + "assist/" + PAGE : null;
    }

    public static String bundledUrl() { return ASSETS + "assist/" + PAGE; }

    public static boolean isHttpsOrigin(String origin) {
        URI o = parse(origin);
        String p = o == null ? null : o.getRawPath();
        int port = o == null ? 0 : o.getPort();
        return o != null && "https".equals(o.getScheme()) && o.getHost() != null && o.getRawUserInfo() == null
                && o.getRawQuery() == null && o.getRawFragment() == null && (port == -1 || (port > 0 && port <= 65535))
                && (p == null || p.isEmpty() || p.equals("/"));
    }

    /** An allowlisted orb resource on the virtual document origin, while an HTTPS Wizard is selected. */
    public static boolean fromWizard(String origin, String url) {
        URI u = parse(url);
        return isHttpsOrigin(origin) && u != null && "https".equals(u.getScheme()) && "wizard-overlay.invalid".equals(u.getRawAuthority())
                && u.getRawQuery() == null && allowedPath(u.getRawPath(), SHELL);
    }

    /** Where natively fetched bytes for an allowed virtual URL come from: the same path on the selected Wizard. */
    public static String upstream(String origin, String url) {
        if (!fromWizard(origin, url)) return null;
        return origin.replaceAll("/+$", "") + parse(url).getRawPath();
    }

    public static boolean bundled(String url) {
        URI u = parse(url);
        return u != null && url.startsWith(ASSETS) && u.getRawQuery() == null
                && allowedPath(u.getRawPath(), "/android_asset/wizard-os-home/");
    }

    private static boolean allowedPath(String path, String prefix) {
        return path != null && path.startsWith(prefix) && FILES.contains(path.substring(prefix.length()));
    }

    public static boolean samePage(String a, String b) { return a != null && b != null && noFragment(a).equals(noFragment(b)); }

    private static String noFragment(String u) { int i = u.indexOf('#'); return i < 0 ? u : u.substring(0, i); }

    private static URI parse(String s) {
        try { return s == null ? null : new URI(s); } catch (Exception e) { return null; }
    }
}
