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
    /** wizard-ux issue 1959: once the pinned page has painted (the box answered), the cover leaves at most this much
     *  later, whether or not the app ever says it has loaded (its frame's load waits for every file it asks for). */
    static final long COVER_AFTER_PAGE_MS = 2_000L;
    /** An app page that answered with a redirect (Recorder: /mizel/ -> live/) goes straight to the WebView for this
     *  long, with no phone-side read first (the WebView can't take a redirect from the phone). */
    static final long REDIRECT_KEEP_MS = 24 * 3_600_000L;
    /** With a kept copy of the app's page, the window waits at most this long for the box to say whether it changed;
     *  a slower box gets the kept page at once (its answer is kept for the next open). Usually the 304 comes first. */
    static final long PAGE_WAIT_MS = 250L;
    /** Can't reach for a pinned window (switch on): at the give-up mark the phone asks the box's /shell-health; a box
     *  that answers in this long is loading slowly, not away, so the window keeps waiting. */
    static final int HEALTH_TIMEOUT_MS = 4_000;
    /** After the app has shown, a picture of it is kept this soon (not only when the window leaves the screen). */
    static final long SHOT_AFTER_SHOWN_MS = 2_000L;
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

    /** The box answered the health check: any HTTP answer below 500 is the box (a 502/503/504 is the gateway saying the
     *  Wizard behind it is not there). -1 / 0: no answer at all. */
    static boolean boxAnswers(int status) { return status >= 200 && status < 500; }

    /** Why the cover left at its time mark: 2 s after the page painted, or the old 10 s mark from the tap. */
    static String coverWhy(long pageAt, long now) {
        return pageAt > 0 && now - pageAt < SHOT_MAX_MS ? "page painted " + (now - pageAt) + " ms ago, the app did not say it loaded" : "10 s mark";
    }

    /** The timing line of one pinned open (uptime ms; 0: that stage did not happen before the cover left). */
    static String timingLine(String app, boolean picture, long tap, long cover, long page, long shown, long gone, String why) {
        StringBuilder b = new StringBuilder("open ").append(app == null ? "?" : app).append(": tap 0");
        b.append(", ").append(picture ? "last screen" : "placeholder").append(' ').append(stage(tap, cover));
        b.append(", page ").append(stage(tap, page));
        b.append(", app ready ").append(stage(tap, shown));
        b.append(", cover left ").append(stage(tap, gone)).append(" (").append(why).append(')');
        return b.toString();
    }

    private static String stage(long tap, long at) { return tap > 0 && at >= tap ? (at - tap) + " ms" : "-"; }

    /** The name on the placeholder: the pinned icon's label, else the app id made readable ("wizard-search" → "Search"). */
    static String placeholderName(String pinned, String app) {
        if (pinned != null && !pinned.trim().isEmpty()) return pinned.trim();
        String id = app == null ? "" : app.trim();
        if (id.startsWith("wizard-")) id = id.substring(7);
        StringBuilder out = new StringBuilder();
        for (String w : id.split("[-_ ]+")) {
            if (w.isEmpty()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1));
        }
        return out.toString();
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
