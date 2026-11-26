package ai.wizards.os;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Instant home-screen apps (wizard-ux issue 1830, switch wizard/pin-instant-open, off by default). Pure rules,
 * unit-tested (PinInstantPolicyTest): when a pinned window may skip Connecting, which of its requests the phone keeps,
 * which answers may be kept, and when a saved picture of the app's last screen is still worth showing.
 *
 * A pinned window is a new Android window with its own WebView. Without this it waits for Connecting (1.2 s), starts
 * from an empty screen and asks the box again for every file the app loads. With it:
 *  - Connecting is skipped when any Wizard window got an answer from this box within {@link #REACHED_MS} on the same
 *    network (active network + VPN). No network / Tailscale off still say so at once and Can't reach still comes at
 *    ReachPolicy.GIVE_UP_MS, so a real outage looks as today.
 *  - Files are kept on the phone (PinCache): the app's page is always checked with the box first (one small,
 *    conditional request); when it changed, the app's other files are fetched again, so an update shows on the next
 *    open. The shell's own unstamped files are kept per shell release. APIs are never kept.
 */
final class PinInstantPolicy {
    private PinInstantPolicy() {}

    /** "Reached recently": any Wizard window got an answer from this box within this long. */
    static final long REACHED_MS = 5 * 60_000L;
    /** A saved last screen older than this is not shown (the app has likely moved on). */
    static final long SHOT_MAX_AGE_MS = 7 * 24 * 3_600_000L;
    /** The saved last screen is kept at most this wide (px): small enough to decode and draw in the first frame. */
    static final int SHOT_WIDTH = 720;
    /** The saved last screen gives way to the live page by this time at the latest. */
    static final long SHOT_MAX_MS = 10_000L;
    /** One kept file at most this big; bigger ones pass through untouched. */
    static final int MAX_FILE = 4 * 1024 * 1024;
    /** All kept files together; the oldest go first. */
    static final long MAX_TOTAL = 64L * 1024 * 1024;

    enum Kind { NONE, PAGE, FILE, SHELL }

    /** May this pinned open skip the Connecting screen: switch on, reached within REACHED_MS, same network now. */
    static boolean skipConnecting(boolean on, long now, long reachedAt, String netThen, String netNow) {
        if (!on || reachedAt <= 0 || now < reachedAt || now - reachedAt > REACHED_MS) return false;
        return netNow != null && !netNow.isEmpty() && netNow.equals(netThen);
    }

    /** The network an answer came over: the active network and whether a VPN (Tailscale) carries it. */
    static String network(boolean network, String id, boolean vpn) {
        return network && id != null && !id.isEmpty() ? id + (vpn ? "|vpn" : "|direct") : "";
    }

    static boolean shotFresh(long now, long takenAt) {
        return takenAt > 0 && now >= takenAt && now - takenAt <= SHOT_MAX_AGE_MS;
    }

    private static final java.util.Set<String> STATIC = new java.util.HashSet<>(java.util.Arrays.asList(
            "js", "mjs", "css", "svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "woff", "woff2", "ttf", "otf",
            "html", "htm", "webmanifest"));

    /** Which kind of request this is for the phone-side cache; NONE passes through untouched. */
    static Kind kind(String boxOrigin, String scheme, String authority, String path, String method, boolean mainFrame,
                     String accept, boolean range) {
        if (mainFrame || range || !"GET".equals(method) || path == null || !path.startsWith("/")) return Kind.NONE;
        if (boxOrigin == null || boxOrigin.isEmpty() || !boxOrigin.equalsIgnoreCase(scheme + "://" + authority)) return Kind.NONE;
        if (path.contains("..") || path.contains("//")) return Kind.NONE;
        String lower = path.toLowerCase(Locale.ROOT);
        int second = lower.indexOf('/', 1);
        if (second < 0) return Kind.NONE;                     // /<app> with no slash: a redirect, not a file
        String seg = lower.substring(1, second);
        if (seg.isEmpty() || seg.equals("wizard") || seg.equals("api") || seg.startsWith("_")) return Kind.NONE;
        // Reads that are data, not files, wherever they sit.
        if (lower.contains("/api/") || lower.contains("/store-data/") || lower.contains("/store-install/")
                || lower.contains("/mcp/") || lower.endsWith("/mcp") || lower.contains("/files/") || lower.contains("/attachments/")) return Kind.NONE;
        String ext = extension(lower);
        if (seg.equals("wizard-os-home")) {
            if (lower.endsWith("/sw.js") || lower.endsWith(".json")) return Kind.NONE;
            return STATIC.contains(ext) && !ext.startsWith("htm") ? Kind.SHELL : Kind.NONE;
        }
        boolean html = accept != null && accept.toLowerCase(Locale.ROOT).startsWith("text/html");
        if (html && (ext.isEmpty() || ext.startsWith("htm"))) return Kind.PAGE;
        if (STATIC.contains(ext) && !ext.startsWith("htm")) return Kind.FILE;
        return Kind.NONE;
    }

    /** The app a path belongs to: its first path segment. */
    static String app(String path) {
        if (path == null || path.length() < 2) return "";
        int second = path.indexOf('/', 1);
        return second < 0 ? "" : path.substring(1, second);
    }

    static String extension(String path) {
        int slash = path.lastIndexOf('/'), dot = path.lastIndexOf('.');
        return dot > slash ? path.substring(dot + 1) : "";
    }

    /** May this answer be kept on the phone. Headers are lower-case keys. */
    static boolean storable(int status, Map<String, String> headers, int size) {
        if (status != 200 || size < 0 || size > MAX_FILE || headers == null) return false;
        String cc = headers.getOrDefault("cache-control", "").toLowerCase(Locale.ROOT);
        if (cc.contains("no-store") || cc.contains("private")) return false;
        if (headers.containsKey("set-cookie")) return false;
        String vary = headers.getOrDefault("vary", "").toLowerCase(Locale.ROOT).replace(" ", "");
        for (String v : vary.split(",")) if (!v.isEmpty() && !v.equals("accept-encoding")) return false;
        return !headers.getOrDefault("content-type", "").isEmpty();
    }

    /** A kept release-stamped file never changes under its URL. */
    static boolean immutable(Map<String, String> headers) {
        return headers != null && headers.getOrDefault("cache-control", "").toLowerCase(Locale.ROOT).contains("immutable");
    }

    /** What identifies a version of an app's page: its validators, else its bytes. */
    static String generation(Map<String, String> headers, String bodyHash) {
        String etag = headers == null ? "" : headers.getOrDefault("etag", "");
        String modified = headers == null ? "" : headers.getOrDefault("last-modified", "");
        if (!etag.isEmpty() || !modified.isEmpty()) return "v:" + etag + "|" + modified;
        return "h:" + (bodyHash == null ? "" : bodyHash);
    }

    /** Request headers passed on to the box: the WebView's, minus what the phone's own HTTP client sets. */
    static Map<String, String> forward(Map<String, String> request) {
        Map<String, String> out = new LinkedHashMap<>();
        if (request == null) return out;
        for (Map.Entry<String, String> e : request.entrySet()) {
            String k = e.getKey() == null ? "" : e.getKey().toLowerCase(Locale.ROOT);
            if (k.isEmpty() || k.equals("accept-encoding") || k.equals("host") || k.equals("range") || k.equals("cookie")
                    || k.equals("if-none-match") || k.equals("if-modified-since") || k.equals("connection")) continue;
            out.put(e.getKey(), e.getValue());
        }
        return out;
    }

    /** Response headers handed to the WebView: all but the transport's own (the body is already decoded). */
    static Map<String, String> replay(Map<String, String> response) {
        Map<String, String> out = new LinkedHashMap<>();
        if (response == null) return out;
        for (Map.Entry<String, String> e : response.entrySet()) {
            String k = e.getKey();
            if (k.equals("content-encoding") || k.equals("content-length") || k.equals("transfer-encoding")
                    || k.equals("connection") || k.equals("keep-alive") || k.equals("set-cookie")) continue;
            out.put(k, e.getValue());
        }
        return out;
    }

    /** A WebView can take any status from an intercepted read except a redirect (it would not follow it). */
    static boolean replayable(int status) {
        return status >= 200 && status <= 599 && (status < 300 || status > 399);
    }
}
