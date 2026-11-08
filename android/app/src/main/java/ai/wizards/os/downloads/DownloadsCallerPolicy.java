package ai.wizards.os.downloads;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.util.Locale;

/**
 * Who may use the in-app Downloads port, and what a request may ask (pure Java, unit-tested off-device).
 *
 * The port is {@code window.wizardDownloadsPort}, added with {@code WebViewCompat.addWebMessageListener} for the
 * private Wizard origin only (same pattern as wizardScreenPort / wizardAppsPort). A JavascriptInterface cannot do
 * this job: it is injected into every frame, so a hosted app iframe inside the shell would pass any check on the
 * top-level URL. A caller is admitted only when ALL hold:
 * <ul>
 *   <li>the WebView supports WEB_MESSAGE_LISTENER (otherwise the feature is simply absent: fail closed);</li>
 *   <li>the message comes from the WebView that is current (not a destroyed or replaced one);</li>
 *   <li>the sending frame is the main frame;</li>
 *   <li>its origin is exactly the selected Wizard's primary origin;</li>
 *   <li>the page now at the top is the shell ({@code /wizard-os-home} or below) on that origin.</li>
 * </ul>
 * A denied caller gets no answer and no native action runs. {@link #stillCurrent} is asked again before an answer
 * is posted or an effect is carried out, because a navigation can land between admission and the work.
 */
public final class DownloadsCallerPolicy {
    public static final String NAME = "wizardDownloadsPort";
    public static final int VERSION = 1;
    static final int MAX_MESSAGE = 4096;
    static final int MAX_ID = 64;

    private DownloadsCallerPolicy() {}

    public enum Verdict { ALLOW, DENY_UNSUPPORTED, DENY_WEBVIEW, DENY_NOT_MAIN_FRAME, DENY_ORIGIN, DENY_NOT_SHELL }

    /** The listener feature must exist; without it there is no downloads port at all. */
    public static boolean supported(boolean webMessageListenerFeature) { return webMessageListenerFeature; }

    /** scheme://host[:port] with the default https port dropped, the form AppState.primaryOrigin uses; null if unusable. */
    public static String originOf(String scheme, String host, int port) {
        if (scheme == null || host == null || scheme.isEmpty() || host.isEmpty()) return null;
        String s = scheme.toLowerCase(Locale.ROOT);
        boolean dflt = port == -1 || (s.equals("https") && port == 443) || (s.equals("http") && port == 80);
        return s + "://" + host.toLowerCase(Locale.ROOT) + (dflt ? "" : ":" + port);
    }

    /** The configured address in the same form originOf gives, so both sides of the comparison are spelled alike. */
    public static String normalizeOrigin(String origin) {
        if (origin == null) return null;
        try { URI u = new URI(origin); return originOf(u.getScheme(), u.getHost(), u.getPort()); }
        catch (Exception e) { return null; }
    }

    public static Verdict admit(boolean featureSupported, boolean currentWebView, boolean isMainFrame,
                                String primaryOrigin, String sourceOrigin, String topUrl) {
        if (!supported(featureSupported)) return Verdict.DENY_UNSUPPORTED;
        if (!currentWebView) return Verdict.DENY_WEBVIEW;
        if (!isMainFrame) return Verdict.DENY_NOT_MAIN_FRAME;
        if (primaryOrigin == null || primaryOrigin.isEmpty() || !primaryOrigin.equals(sourceOrigin)) return Verdict.DENY_ORIGIN;
        return shellOnTop(primaryOrigin, topUrl) ? Verdict.ALLOW : Verdict.DENY_NOT_SHELL;
    }

    /** Admission is still valid: same page load, same WebView, and the top page is still the shell. */
    public static boolean stillCurrent(long admittedEpoch, long currentEpoch, boolean currentWebView,
                                       String primaryOrigin, String topUrl) {
        return admittedEpoch == currentEpoch && currentWebView && primaryOrigin != null && !primaryOrigin.isEmpty()
                && shellOnTop(primaryOrigin, topUrl);
    }

    static boolean shellOnTop(String primaryOrigin, String topUrl) {
        if (topUrl == null) return false;
        try {
            URI u = new URI(topUrl);
            if (u.getRawUserInfo() != null || !"https".equalsIgnoreCase(u.getScheme()) && !"http".equalsIgnoreCase(u.getScheme())) return false;
            if (!primaryOrigin.equals(originOf(u.getScheme(), u.getHost(), u.getPort()))) return false;
            String path = u.getPath();
            return path != null && (path.equals("/wizard-os-home") || path.startsWith("/wizard-os-home/"));
        } catch (Exception e) { return false; }
    }

    /** Native -> page: an event may be handed to the page only while the shell is the top document. */
    public static boolean canPush(String primaryOrigin, String topUrl) {
        return primaryOrigin != null && !primaryOrigin.isEmpty() && shellOnTop(primaryOrigin, topUrl);
    }

    /**
     * The message that carries one event (start | done | failed | sync) to the page: {"v":1,"event":{...}}, no id (it is not a
     * reply). It is posted through the reply proxy of an ADMITTED main-frame message, so it lands on the private port the shell
     * module holds, never on a global a hosted app can call. Null unless the input is exactly one JSON object.
     */
    public static String eventEnvelope(String eventJson) {
        if (eventJson == null || eventJson.length() > MAX_MESSAGE) return null;
        try {
            org.json.JSONTokener t = new org.json.JSONTokener(eventJson);
            Object v = t.nextValue();
            if (!(v instanceof JSONObject) || t.nextClean() != 0) return null;
            return new JSONObject().put("v", 1).put("event", v).toString();
        } catch (JSONException e) { return null; }
    }

    /** The four things the page may ask for; each runs the same code the tap in the sheet always ran. */
    public interface Actions {
        String list();
        String open(String id);
        String cancel(String id);
        String remove(String id);
    }

    /** One parsed request: {v:1, id, method: list|open|cancel|remove, params?: {id}}. */
    public static final class Request {
        public final String id, method, arg;
        Request(String id, String method, String arg) { this.id = id; this.method = method; this.arg = arg; }
        public boolean isList() { return "list".equals(method); }
    }

    /** Null for anything malformed (no answer is sent). Unknown methods parse, and are answered with an error. */
    public static Request parse(String data) {
        if (data == null || data.length() > MAX_MESSAGE) return null;
        try {
            JSONObject m = new JSONObject(data);
            if (m.optInt("v", -1) != VERSION) return null;
            Object id = m.opt("id"), method = m.opt("method"), params = m.opt("params");
            if (!(id instanceof String) || ((String) id).isEmpty() || ((String) id).length() > MAX_ID || !(method instanceof String)) return null;
            if (params != null && params != JSONObject.NULL && !(params instanceof JSONObject)) return null;
            String arg = params instanceof JSONObject ? ((JSONObject) params).optString("id", "") : "";
            return new Request((String) id, (String) method, arg);
        } catch (JSONException e) { return null; }
    }

    static boolean knownMethod(String m) { return "list".equals(m) || "open".equals(m) || "cancel".equals(m) || "remove".equals(m); }

    /** Executes an admitted request and returns the reply JSON. */
    public static String execute(Request r, Actions a) {
        if (!knownMethod(r.method)) return error(r.id, "unknown method");
        if (r.isList()) {
            try { return ok(r.id, new JSONObject(a.list())); }
            catch (JSONException | RuntimeException e) { return error(r.id, "failed"); }
        }
        if (DownloadsPolicy.parseId(r.arg) < 0) return ok(r.id, "missing"); // never forwards anything but plain digits
        String out;
        try {
            switch (r.method) {
                case "open": out = a.open(r.arg); break;
                case "cancel": out = a.cancel(r.arg); break;
                default: out = a.remove(r.arg); break;
            }
        } catch (RuntimeException e) { out = "missing"; }
        return ok(r.id, out == null ? "missing" : out);
    }

    /** The whole gate: a denied verdict or a malformed request yields null and NOTHING is executed. */
    public static String handle(Verdict verdict, String data, Actions a) {
        if (verdict != Verdict.ALLOW) return null;
        Request r = parse(data);
        return r == null ? null : execute(r, a);
    }

    static String ok(String id, Object result) {
        try { return new JSONObject().put("v", VERSION).put("id", id).put("ok", true).put("result", result).toString(); }
        catch (JSONException e) { throw new IllegalStateException(e); }
    }

    static String error(String id, String why) {
        try { return new JSONObject().put("v", VERSION).put("id", id).put("ok", false).put("error", why).toString(); }
        catch (JSONException e) { throw new IllegalStateException(e); }
    }
}
