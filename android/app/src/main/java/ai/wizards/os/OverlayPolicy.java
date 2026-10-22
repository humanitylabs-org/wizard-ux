package ai.wizards.os;

import java.net.URI;
import java.util.Locale;

/** Which URLs an overlay page may come from and reach (see {@link OverlayPage}). Pure; OverlayPolicyTest. */
final class OverlayPolicy {
    /** The bundled copy: the same layout as web/, so pages and shared files keep their relative links. */
    static final String ASSETS = "file:///android_asset/wizard-os-home/";
    static final String SHELL = "/wizard-os-home/";

    private OverlayPolicy() {}

    /** The one place overlay pages read the Wizard's origin (a runtime-configured origin can be swapped in here). */
    static String wizardOrigin() { return BuildConfig.ORIGIN; }

    /** The Wizard copy of {@code page}, or null when the origin isn't a plain https origin. */
    static String remoteUrl(String origin, String page) {
        return isHttpsOrigin(origin) ? origin.replaceAll("/+$", "") + SHELL + "assist/" + page : null;
    }

    static String bundledUrl(String page) { return ASSETS + "assist/" + page; }

    static boolean isHttpsOrigin(String origin) {
        URI o = parse(origin);
        String p = o == null ? null : o.getRawPath();
        return o != null && "https".equals(o.getScheme()) && o.getHost() != null && o.getRawUserInfo() == null
                && o.getRawQuery() == null && o.getRawFragment() == null && (p == null || p.isEmpty() || p.equals("/"));
    }

    /** A request the Wizard copy may make: https, exactly the Wizard's host and port, the web shell's static files
     *  (not its API: overlay pages talk to the Wizard only through native code, as the bundled copy does). */
    static boolean fromWizard(String origin, String url) {
        URI o = parse(origin), u = parse(url);
        if (u == null || !isHttpsOrigin(origin) || !"https".equals(u.getScheme()) || u.getRawUserInfo() != null) return false;
        if (u.getHost() == null || !u.getHost().equalsIgnoreCase(o.getHost()) || port(u) != port(o)) return false;
        String p = u.getRawPath();
        return p != null && p.startsWith(SHELL) && !p.startsWith(SHELL + "api/") && safePath(p);
    }

    /** A request the bundled copy may make: only the bundled web-shell folder. */
    static boolean bundled(String url) { return url != null && url.startsWith(ASSETS) && safePath(url); }

    /** The same page, ignoring the #fragment (onPageFinished reports what actually loaded). */
    static boolean samePage(String a, String b) { return a != null && b != null && noFragment(a).equals(noFragment(b)); }

    private static boolean safePath(String p) {
        String l = p.toLowerCase(Locale.ROOT);
        return !p.contains("..") && !p.contains("\\") && !l.contains("%2e") && !l.contains("%2f") && !l.contains("%5c");
    }

    private static int port(URI u) { return u.getPort() == -1 ? 443 : u.getPort(); }

    private static String noFragment(String u) { int i = u.indexOf('#'); return i < 0 ? u : u.substring(0, i); }

    private static URI parse(String s) {
        try { return s == null ? null : new URI(s); } catch (Exception e) { return null; }
    }
}
