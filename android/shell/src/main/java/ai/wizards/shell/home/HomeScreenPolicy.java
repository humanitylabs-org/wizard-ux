package ai.wizards.shell.home;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

import ai.wizards.shell.ShellOrigin;

/**
 * Pure rules for home-screen apps in Wizard Shell (port of android/app HomeScreenPolicy). No Android types; JVM-tested.
 * A pin's identity is the selected Wizard's origin + a registered app ID, never a caller-provided URL: the pinned
 * task opens {@code <origin>/wizard-os-home/?app-session=<id>} and the Wizard's web (single-app-session.js) resolves it.
 */
public final class HomeScreenPolicy {
    static final String SCHEME = "wizard-homeapp";
    private HomeScreenPolicy() {}

    public static boolean validId(String id) { return id != null && id.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}"); }

    public static boolean validRequest(String requestId) { return requestId != null && requestId.matches("[0-9]{1,12}"); }

    public static String displayName(String id, String registeredName) {
        return "wizard-signal".equals(id) ? "Signal" : registeredName;
    }

    /** A launcher label and a 48–256 px PNG data URL, bounded before decoding. */
    public static boolean validLabel(String name) { return name != null && !name.trim().isEmpty() && name.length() <= 80; }
    public static boolean validIconData(String png) { return png != null && png.startsWith("data:image/png;base64,") && png.length() <= 90000; }
    public static boolean validIconSize(int w, int h) { return w >= 48 && w <= 256 && h >= 48 && h <= 256; }

    /** One intentional tap, not a scroll/cancel/multi-touch or reused activation. */
    public static final class TapGate {
        private float x, y;
        private final float slop;
        private boolean down;
        private long up = -1, generation = 0;
        public TapGate(float slop) { this.slop = slop; }
        public void down(float x, float y) { this.x = x; this.y = y; down = true; up = -1; generation++; }
        public void move(float x, float y) { if (Math.hypot(x - this.x, y - this.y) > slop) cancel(); }
        public void cancel() { down = false; up = -1; generation++; }
        public void up(long now) { up = down ? now : -1; down = false; }
        /** The just-released tap (within 1.5 s), once; -1 otherwise. */
        public long claim(long now) {
            if (up < 0 || now < up || now - up > 1500) return -1;
            up = -1; return generation;
        }
        public boolean current(long claim) { return claim >= 0 && claim == generation; }
    }

    public static String identity(String origin, String id) {
        if (!validId(id) || origin == null || origin.isEmpty()) throw new IllegalArgumentException("invalid app identity");
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest((origin + "\n" + id).getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder("homeapp-");
            for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 255));
            return out.toString();
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    /** The canonical document-task URI of one app on one Wizard: one Android task per (Wizard, app). */
    public static String taskUri(String pkg, String origin, String id) {
        return SCHEME + "://" + pkg + "/" + identity(origin, id) + "?app=" + id;
    }

    /** The app ID of a canonical task URI for the selected Wizard, else null (other Wizard, edited or malformed). */
    public static String appFromTask(String uri, String pkg, String origin) {
        if (uri == null || pkg == null || origin == null) return null;
        int q = uri.indexOf("?app=");
        if (q < 0) return null;
        String id = uri.substring(q + 5);
        try { return validId(id) && uri.equals(taskUri(pkg, origin, id)) ? id : null; }
        catch (RuntimeException e) { return null; }
    }

    /** Where a pinned app's task opens. */
    public static String sessionUrl(String origin, String id) {
        if (origin == null || !validId(id)) return null;
        return origin + "/wizard-os-home/?app-session=" + id;
    }

    /** The selected Wizard's own top-level shell page (not a pinned-app session): only it may ask to pin. */
    public static boolean shellPage(String origin, String url) {
        URI u = shellUri(origin, url);
        return u != null && param(u, "app-session") == null;
    }

    /** A pinned app's task accepts only its own session page on the selected Wizard. */
    public static boolean sessionPage(String origin, String url, String id) {
        URI u = shellUri(origin, url);
        return u != null && validId(id) && id.equals(param(u, "app-session"));
    }

    private static URI shellUri(String origin, String url) {
        if (!ShellOrigin.same(origin, url)) return null;
        try {
            URI u = new URI(url);
            String p = u.getRawPath();
            return "/wizard-os-home/".equals(p) || "/wizard-os-home/index.html".equals(p) ? u : null;
        } catch (Exception e) { return null; }
    }

    /** The single value of a query parameter; null when absent, "" (never a match) when repeated or malformed. */
    static String param(URI u, String name) {
        String q = u.getRawQuery();
        if (q == null) return null;
        String found = null;
        for (String part : q.split("&")) {
            int eq = part.indexOf('=');
            String k = eq < 0 ? part : part.substring(0, eq);
            if (!name.equals(k)) continue;
            if (found != null) return "";
            try { found = eq < 0 ? "" : URLDecoder.decode(part.substring(eq + 1), StandardCharsets.UTF_8.name()); }
            catch (Exception e) { return ""; }
        }
        return found;
    }
}
