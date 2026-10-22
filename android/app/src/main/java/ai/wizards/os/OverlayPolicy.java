package ai.wizards.os;

import java.net.URI;
import java.util.Set;

/** Pure URL and document policy for the privileged overlay WebViews. */
final class OverlayPolicy {
    static final String ASSETS = "file:///android_asset/wizard-os-home/";
    static final String SHELL = "/wizard-os-home/";
    // addJavascriptInterface is visible to ALL frames, including opaque-origin srcdoc/data frames.
    // Enforce this policy natively, not via headers supplied by a potentially older web deployment.
    static final String CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            + "img-src 'self' data:; frame-src 'none'; child-src 'none'; worker-src 'none'; "
            + "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    private static final Set<String> FILES = Set.of(
            "assist/everywhere.html", "assist/surface.html", "assist/screen.html",
            "assist/everywhere.js", "assist/surface.js", "assist/screen.js", "assist/orb-size.js",
            "orb.js", "motion/wizard-motion.js", "motion/wizard-motion.css",
            "robert-thread-orb.png", "robert-listening-galaxy.png");

    private OverlayPolicy() {}

    static String remoteUrl(String origin, String page) {
        return isHttpsOrigin(origin) && validPage(page) ? origin.replaceAll("/+$", "") + SHELL + "assist/" + page : null;
    }
    static boolean validPage(String page) {
        if (page == null) return false;
        String file = noFragment(page);
        return Set.of("surface.html", "everywhere.html", "screen.html").contains(file);
    }
    static String bundledUrl(String page) {
        if (!validPage(page)) throw new IllegalArgumentException("Unknown overlay page");
        return ASSETS + "assist/" + page;
    }
    static boolean isHttpsOrigin(String origin) {
        URI o = parse(origin);
        String p = o == null ? null : o.getRawPath();
        return o != null && "https".equals(o.getScheme()) && o.getHost() != null && o.getRawUserInfo() == null
                && o.getRawQuery() == null && o.getRawFragment() == null && (o.getPort() == -1 || o.getPort() == 443)
                && (p == null || p.isEmpty() || p.equals("/"));
    }
    static boolean fromWizard(String origin, String url) {
        URI u = parse(url);
        return isHttpsOrigin(origin) && u != null && ServerOrigin.matches(origin.replaceAll("/+$", ""), url)
                && u.getRawQuery() == null && allowedPath(u.getRawPath(), SHELL);
    }
    static boolean bundled(String url) {
        URI u = parse(url);
        return u != null && url.startsWith(ASSETS) && u.getRawQuery() == null
                && allowedPath(u.getRawPath(), "/android_asset/wizard-os-home/");
    }
    private static boolean allowedPath(String path, String prefix) {
        return path != null && path.startsWith(prefix) && FILES.contains(path.substring(prefix.length()));
    }
    static boolean samePage(String a, String b) { return a != null && b != null && noFragment(a).equals(noFragment(b)); }
    private static String noFragment(String u) { int i = u.indexOf('#'); return i < 0 ? u : u.substring(0, i); }
    private static URI parse(String s) {
        try { return s == null ? null : new URI(s); } catch (Exception e) { return null; }
    }
}
