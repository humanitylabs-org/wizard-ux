package ai.wizards.os.device;

import android.content.Context;
import android.content.SharedPreferences;

import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import ai.wizards.os.BuildConfig;

/**
 * This Wizard's address: where the shell, native HTTP and every origin check point. Nothing is compiled in from
 * source. A build may carry a default from private Gradle properties (wizardOrigin / wizardHomeUrl /
 * wizardLegacyHosts in the builder's ~/.gradle/gradle.properties, see android/README.md); without one the app asks
 * for the address on first launch ("Connect to your Wizard") and keeps it in app prefs.
 *
 * Legacy hosts are older names of the SAME Wizard (from the build's private properties). They are honoured only
 * while the app points at the build's own origin, so connecting to a different Wizard never trusts them.
 *
 * Pure parsing (normalize, hosts) is unit-tested; the live values are process-wide and loaded once by WizardApp.
 */
public final class WizardAddress {
    static final String PREFS = "wizard_address";
    static final String KEY_ORIGIN = "origin";

    private static volatile String origin = normalize(BuildConfig.ORIGIN);
    private static volatile List<String> legacy = hosts(BuildConfig.LEGACY_HOSTS);
    private static volatile String homeUrl = BuildConfig.HOME_URL;

    private WizardAddress() {}

    /** Read the owner's chosen address (if any) over the build default. Called from WizardApp.onCreate. */
    public static void load(Context c) {
        String saved = prefs(c).getString(KEY_ORIGIN, "");
        // Debug (QA) builds only: files/qa_unconfigured makes the app behave like a build without a private address.
        boolean asPublic = BuildConfig.DEBUG && new java.io.File(c.getFilesDir(), "qa_unconfigured").isFile();
        apply(normalize(saved), asPublic ? "" : normalize(BuildConfig.ORIGIN));
    }

    /** The owner connected the app to {@code o} ("https://host"). Returns false (nothing saved) if it isn't one. */
    public static boolean save(Context c, String o) {
        String n = normalize(o);
        if (n.isEmpty()) return false;
        prefs(c).edit().putString(KEY_ORIGIN, n).commit();
        boolean asPublic = BuildConfig.DEBUG && new java.io.File(c.getFilesDir(), "qa_unconfigured").isFile();
        apply(n, asPublic ? "" : normalize(BuildConfig.ORIGIN));
        return true;
    }

    private static void apply(String saved, String build) {
        String o = saved.isEmpty() ? build : saved;
        origin = o;
        boolean own = !o.isEmpty() && o.equals(build);
        legacy = own ? hosts(BuildConfig.LEGACY_HOSTS) : Collections.<String>emptyList();
        homeUrl = own && !BuildConfig.HOME_URL.isEmpty() ? BuildConfig.HOME_URL : (o.isEmpty() ? "" : o + "/wizard-os-home/");
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Unit tests: pretend the app points at {@code o} with these older names. */
    public static void setForTest(String o, String... legacyHosts) {
        origin = normalize(o);
        legacy = hosts(String.join(",", legacyHosts));
        homeUrl = origin.isEmpty() ? "" : origin + "/wizard-os-home/";
    }

    /* ---------------- the live values ---------------- */

    /** "https://host", or "" when this phone has not been connected to a Wizard yet. */
    public static String origin() { return origin; }

    public static boolean configured() { return !origin.isEmpty(); }

    /** The host of origin(), or "". */
    public static String host() { return origin.isEmpty() ? "" : origin.substring("https://".length()); }

    /** The shell's start page (the build's own HOME_URL when pointing at the build origin). "" when unconfigured. */
    public static String homeUrl() { return homeUrl; }

    /** Older names of this Wizard, lower case, first = the fallback name. Empty for most builds. */
    public static List<String> legacyHosts() { return legacy; }

    /** "https://" + the first legacy host, or null when there is none. */
    public static String legacyOrigin() { return legacy.isEmpty() ? null : "https://" + legacy.get(0); }

    public static boolean isLegacyHost(String host) {
        return host != null && legacy.contains(host.toLowerCase(Locale.ROOT));
    }

    /** True when {@code o} ("https://host", no port/path) is this Wizard under its own or an older name. */
    public static boolean isTrustedOrigin(String o) {
        if (o == null || o.isEmpty()) return false;
        if (configured() && origin.equals(o)) return true;
        for (String h : legacy) if (("https://" + h).equals(o)) return true;
        return false;
    }

    /**
     * Origins a page-to-native message listener may accept when the page lives on {@code primary}: primary itself,
     * plus the older names when primary is this Wizard's own address (QA fakes get no extras). Empty when unset.
     */
    public static Set<String> listenerOrigins(String primary) {
        Set<String> out = new LinkedHashSet<>();
        if (primary == null || primary.isEmpty()) return out;
        out.add(primary);
        if (configured() && origin.equals(primary)) for (String h : legacy) out.add("https://" + h);
        return out;
    }

    /* ---------------- pure parsing ---------------- */

    /**
     * What the owner typed or a link carried → "https://host" (lower case, no port, no path), or "" if it is not a
     * usable Wizard address. Accepts a bare host ("wizard.tail1234.ts.net"), a trailing path ("…/wizard-os-home/"),
     * and port 443. Refuses http, other ports, user info, and anything without a dotted host.
     */
    public static String normalize(String raw) {
        if (raw == null) return "";
        String s = raw.trim();
        if (s.isEmpty() || s.length() > 300 || s.matches(".*\\s.*")) return "";
        if (!s.matches("(?i)^[a-z][a-z0-9+.-]*://.*")) s = "https://" + s;
        try {
            URI u = new URI(s);
            if (!"https".equalsIgnoreCase(u.getScheme())) return "";
            if (u.getRawUserInfo() != null) return "";
            String h = u.getHost();
            if (h == null || !validHost(h)) return "";
            if (u.getPort() != -1 && u.getPort() != 443) return "";
            return "https://" + h.toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return "";
        }
    }

    static boolean validHost(String h) {
        return h.length() <= 253 && h.contains(".") && !h.startsWith(".") && !h.endsWith(".")
                && h.matches("(?i)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+");
    }

    /** "a.example.com, b.example.com" → [a.example.com, b.example.com] (lower case, valid hosts only, de-duplicated). */
    static List<String> hosts(String csv) {
        List<String> out = new ArrayList<>();
        if (csv == null) return out;
        for (String part : csv.split("[,\\s]+")) {
            String h = part.trim().toLowerCase(Locale.ROOT).replaceFirst("^https://", "").replaceAll("/+$", "");
            if (!h.isEmpty() && validHost(h) && !out.contains(h)) out.add(h);
        }
        return Collections.unmodifiableList(out);
    }

    /**
     * The address a "connect" link carries, or "" if it carries none:
     *   wizardos://connect?address=https://wizard.tail1234.ts.net/   (the Setup app / a QR code)
     *   https://wizard.tail1234.ts.net/wizard-os-home/…              (a Wizard link, on an unconnected phone)
     */
    public static String fromLink(String link) {
        if (link == null) return "";
        try {
            URI u = new URI(link.trim());
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if ("wizardos".equals(scheme)) {
                if (!"connect".equalsIgnoreCase(u.getHost() == null ? u.getAuthority() : u.getHost())) return "";
                String q = u.getRawQuery();
                if (q == null) return "";
                for (String kv : q.split("&")) {
                    int eq = kv.indexOf('=');
                    String k = eq < 0 ? kv : kv.substring(0, eq);
                    if ("address".equals(k) || "url".equals(k)) {
                        return normalize(java.net.URLDecoder.decode(eq < 0 ? "" : kv.substring(eq + 1), "UTF-8"));
                    }
                }
                return "";
            }
            if ("https".equals(scheme)) return normalize(u.getScheme() + "://" + u.getRawAuthority());
        } catch (Exception ignored) { }
        return "";
    }
}
