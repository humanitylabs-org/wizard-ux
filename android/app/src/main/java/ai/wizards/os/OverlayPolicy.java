package ai.wizards.os;

import java.net.URI;
import java.util.Set;

/** Pure URL and document policy for the privileged overlay WebViews. */
final class OverlayPolicy {
    static final String ASSETS = "file:///android_asset/wizard-os-home/";
    static final String SHELL = "/wizard-os-home/";
    /** Document origin of every remote overlay page. Never the Wizard origin: a service worker registered there (the
     *  shell's web/sw.js, or a hosted app's root-scope worker) would answer the overlay's requests inside WebView,
     *  where shouldInterceptRequest never sees them, and hand its own code the privileged bridges. No page can ever be
     *  served at this reserved .invalid name (RFC 6761) except through OverlayPage, whose CSP denies workers. */
    static final String VIRTUAL = "https://wizard-overlay.invalid";
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

    /** Fixed dependencies, not server-supplied preload URLs. */
    static String[] prefetch(String page) {
        String file = noFragment(page);
        if (file.equals("surface.html")) return new String[]{"assist/surface.html", "assist/orb-size.js", "orb.js",
                "motion/wizard-motion.css", "motion/wizard-motion.js", "assist/surface.js", "robert-thread-orb.png"};
        if (file.equals("everywhere.html")) return new String[]{"assist/everywhere.html", "assist/orb-size.js", "orb.js",
                "assist/everywhere.js", "robert-thread-orb.png"};
        return new String[]{"assist/screen.html", "assist/screen.js"};
    }

    static String remoteUrl(String origin, String page) {
        return isHttpsOrigin(origin) && validPage(page) ? VIRTUAL + SHELL + "assist/" + page : null;
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
    /** An allowlisted overlay resource on the virtual document origin, while a plain HTTPS Wizard is selected. */
    static boolean fromWizard(String origin, String url) {
        URI u = parse(url);
        return isHttpsOrigin(origin) && u != null && "https".equals(u.getScheme()) && "wizard-overlay.invalid".equals(u.getRawAuthority())
                && u.getRawQuery() == null && allowedPath(u.getRawPath(), SHELL);
    }
    /** Where natively fetched bytes for an allowed virtual URL come from: the same path on the selected Wizard. */
    static String upstream(String origin, String url) {
        if (!fromWizard(origin, url)) return null;
        return origin.replaceAll("/+$", "") + parse(url).getRawPath();
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
