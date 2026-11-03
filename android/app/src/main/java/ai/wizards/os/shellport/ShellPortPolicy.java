package ai.wizards.os.shellport;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Pure rules for window.wizardShellPort, the main-document-only replacement for the two former all-frame
 * Java objects (WizardOSNative, WizardOSDevice). No Android dependencies, so every rule runs in JVM tests.
 *
 * Admission happens in native code BEFORE any dispatch: not detached, main frame, exact trusted origin (the persisted
 * owner origin), trusted top document (the shell path), and a reply proxy bound to the current document generation.
 * The command set is an explicit table of reviewed method names with exact argument types: no reflection, no
 * prefix or generic forwarding. Unknown or malformed messages get no reply and no effect.
 *
 * Wire format (JSON strings): page → {v:1, id, target:"native"|"device", method, args:[…]} or {v:1, id, method:"hello"};
 * native → {v:1, id, ok, result | error, state}; pushes → {v:1, type:"state"|"hook", state, hook?, arg?}.
 */
public final class ShellPortPolicy {
    public static final String NAME = "wizardShellPort";
    public static final int VERSION = 1;
    /** Largest accepted message (shareFile carries a base64 file; the old bridge had no bound at all). */
    public static final int MAX_MESSAGE = 48 * 1024 * 1024;

    public enum Refusal { NONE, DETACHED, CHILD_FRAME, ORIGIN, TOP_DOCUMENT, NOT_TEXT, TOO_LARGE, SCHEMA, UNKNOWN_METHOD, ARGS, STALE_DOCUMENT }

    private ShellPortPolicy() { }

    /**
     * Frame admission. {@code persistedOrigin} is read from storage at message time, so a Wizard switch can never
     * leave an older allowlist entry trusted.
     */
    public static Refusal admit(boolean detached, boolean isMainFrame, String sourceOrigin, String allowedOrigin,
                                String persistedOrigin, boolean trustedTopDocument) {
        if (detached) return Refusal.DETACHED;
        if (!isMainFrame) return Refusal.CHILD_FRAME;
        if (sourceOrigin == null || allowedOrigin == null || allowedOrigin.isEmpty()
                || !sameOrigin(allowedOrigin, sourceOrigin) || !sameOrigin(allowedOrigin, persistedOrigin)) return Refusal.ORIGIN;
        if (!trustedTopDocument) return Refusal.TOP_DOCUMENT;
        return Refusal.NONE;
    }

    /** Exact origin equality: scheme, host (case-insensitive), effective port; no path, no credentials. */
    public static boolean sameOrigin(String a, String b) {
        if (a == null || b == null) return false;
        try {
            java.net.URI x = new java.net.URI(a), y = new java.net.URI(b);
            if (x.getScheme() == null || y.getScheme() == null || x.getHost() == null || y.getHost() == null) return false;
            if (x.getRawUserInfo() != null || y.getRawUserInfo() != null) return false;
            if (!(emptyPath(x) && emptyPath(y))) return false;
            return x.getScheme().equalsIgnoreCase(y.getScheme()) && x.getHost().equalsIgnoreCase(y.getHost())
                    && port(x) == port(y);
        } catch (Exception e) { return false; }
    }

    private static boolean emptyPath(java.net.URI u) {
        String p = u.getRawPath();
        return (p == null || p.isEmpty() || p.equals("/")) && u.getRawQuery() == null && u.getRawFragment() == null;
    }

    private static int port(java.net.URI u) {
        if (u.getPort() != -1) return u.getPort();
        return "https".equalsIgnoreCase(u.getScheme()) ? 443 : 80;
    }

    /** The trusted shell document path (the full app and its home-screen app sessions both load it). */
    public static boolean shellPath(String path) {
        return path != null && (path.equals("/wizard-os-home") || path.startsWith("/wizard-os-home/"));
    }

    /* ------------------------------------------------------------------ command table */

    /** Argument types: s = string or null, i = 32-bit integer, l = integer, b = boolean. */
    private static final Map<String, String> NATIVE = new HashMap<>();
    private static final Map<String, String> DEVICE = new HashMap<>();
    /** Methods whose result is fresh (not a cached read): the page facade returns a Promise for them. */
    private static final Set<String> FRESH = new HashSet<>();

    static {
        // WizardOSNative (former MainActivity.Bridge)
        String[][] n = {
            {"openInBrowser", "s"}, {"download", "s"}, {"changeServer", ""}, {"platform", ""},
            {"usuals", ""}, {"usualsTeach", "s"}, {"usualsRun", "s"}, {"usualsMatch", "s"}, {"usualsSave", "sss"},
            {"usualsKeepName", "s"}, {"usualsDelete", "s"}, {"usualsCancel", ""},
            {"sideButton", ""}, {"setupSideButton", ""}, {"sideButtonSettings", ""},
            {"everywhere", ""}, {"setEverywhere", "b"}, {"voiceTypingSettings", ""}, {"appVoice", "sl"},
            {"unsent", ""}, {"retryUnsent", "s"}, {"deleteUnsent", "s"}, {"appUnsent", "is"},
            {"keepAwake", "b"}, {"immersive", "b"}, {"cutoutTop", ""}, {"insetTop", ""},
            {"shareText", "ss"}, {"shareFile", "sss"}, {"selection", "i"}, {"haptic", "i"},
        };
        for (String[] m : n) NATIVE.put(m[0], m[1]);
        // WizardOSDevice (former DeviceBridge annotated methods)
        String[][] d = {
            {"version", ""}, {"recHandoffVersion", ""}, {"recHandoffBegin", "ss"}, {"recStartBorrowed", "ss"},
            {"recHandoffEnd", "s"}, {"recHandoffEvents", ""}, {"recStart", "s"}, {"recPause", "b"}, {"recLevel", ""},
            {"micRoute", ""}, {"micPolicy", ""}, {"setMicPolicy", "s"}, {"recActive", ""}, {"recStop", "s"},
            {"recCancel", "s"}, {"recClaim", "s"}, {"recRead", "si"}, {"captureJournal", ""}, {"recDone", "s"},
            {"recPending", ""}, {"cancelledList", ""}, {"cancelledRead", "si"}, {"cancelledDelete", "s"},
            {"clip", "s"}, {"shareMeta", "s"}, {"shareRead", "sii"}, {"shareDone", "s"},
            {"watchRun", "sss"}, {"replyNotes", ""}, {"clearThread", "s"}, {"notifications", ""},
            {"updateCheck", ""}, {"updateInstall", ""}, {"updateState", ""},
        };
        for (String[] m : d) DEVICE.put(m[0], m[1]);
        Collections.addAll(FRESH, "usualsTeach", "usualsRun", "usualsMatch", "usualsSave",
                "recHandoffBegin", "recStartBorrowed", "recHandoffEnd", "recStart", "micRoute", "setMicPolicy",
                "recStop", "recClaim", "recRead", "cancelledRead", "shareMeta", "shareRead", "clearThread");
    }

    public static Map<String, String> nativeMethods() { return Collections.unmodifiableMap(NATIVE); }
    public static Map<String, String> deviceMethods() { return Collections.unmodifiableMap(DEVICE); }
    public static Set<String> freshMethods() { return Collections.unmodifiableSet(FRESH); }

    /** Capability description sent with hello, so the page builds its facade from what this APK offers. */
    public static JSONObject capabilities() throws JSONException {
        JSONObject out = new JSONObject().put("v", VERSION);
        out.put("native", new JSONObject(NATIVE));
        out.put("device", new JSONObject(DEVICE));
        out.put("fresh", new JSONArray(FRESH));
        return out;
    }

    public static final class Call {
        public final String id, target, method;
        public final JSONArray args;
        public final boolean hello;
        Call(String id, String target, String method, JSONArray args, boolean hello) {
            this.id = id; this.target = target; this.method = method; this.args = args; this.hello = hello;
        }
    }

    public static final class Rejected extends Exception {
        public final Refusal refusal;
        Rejected(Refusal r) { super(r.name()); refusal = r; }
    }

    /** Parses and type-checks one message. Throws {@link Rejected}; never echoes untrusted content. */
    public static Call parse(String data) throws Rejected {
        if (data == null) throw new Rejected(Refusal.NOT_TEXT);
        if (data.length() > MAX_MESSAGE) throw new Rejected(Refusal.TOO_LARGE);
        JSONObject m;
        try { m = new JSONObject(data); } catch (JSONException e) { throw new Rejected(Refusal.SCHEMA); }
        Object v = m.opt("v"), id = m.opt("id"), method = m.opt("method");
        if (!(v instanceof Number) || ((Number) v).doubleValue() != VERSION) throw new Rejected(Refusal.SCHEMA);
        if (!(id instanceof String) || ((String) id).isEmpty() || ((String) id).length() > 64) throw new Rejected(Refusal.SCHEMA);
        if (!(method instanceof String)) throw new Rejected(Refusal.SCHEMA);
        if ("hello".equals(method)) return new Call((String) id, "", "hello", new JSONArray(), true);
        Object target = m.opt("target"), args = m.opt("args");
        String sig = "native".equals(target) ? NATIVE.get(method) : "device".equals(target) ? DEVICE.get(method) : null;
        if (sig == null) throw new Rejected(Refusal.UNKNOWN_METHOD);
        if (!(args instanceof JSONArray) || ((JSONArray) args).length() != sig.length()) throw new Rejected(Refusal.ARGS);
        JSONArray a = (JSONArray) args;
        for (int i = 0; i < sig.length(); i++) if (!typeOk(sig.charAt(i), a.opt(i))) throw new Rejected(Refusal.ARGS);
        return new Call((String) id, (String) target, (String) method, a, false);
    }

    private static boolean typeOk(char t, Object o) {
        switch (t) {
            case 's': return o == JSONObject.NULL || o instanceof String;
            case 'b': return o instanceof Boolean;
            case 'i': return integral(o) && ((Number) o).longValue() >= Integer.MIN_VALUE && ((Number) o).longValue() <= Integer.MAX_VALUE;
            case 'l': return integral(o);
            default: return false;
        }
    }

    private static boolean integral(Object o) {
        if (o instanceof Integer || o instanceof Long) return true;
        if (!(o instanceof Number)) return false;
        double d = ((Number) o).doubleValue();
        return Double.isFinite(d) && d == Math.rint(d) && Math.abs(d) <= 9.007199254740991E15;
    }

    /** String argument as the old bridge saw it: JS null/undefined became Java null. */
    public static String str(JSONArray a, int i) { Object o = a.opt(i); return o instanceof String ? (String) o : null; }
    public static int integer(JSONArray a, int i) { return ((Number) a.opt(i)).intValue(); }
    public static long lng(JSONArray a, int i) { return ((Number) a.opt(i)).longValue(); }
    public static boolean bool(JSONArray a, int i) { return (Boolean) a.opt(i); }

    /** Method names in refusal logs only: bounded and character-limited, never raw page input. */
    public static String logName(String method) {
        if (method == null) return "-";
        String m = method.length() > 40 ? method.substring(0, 40) : method;
        return m.matches("[A-Za-z.]*") ? m : "?";
    }

    /** Native → page hook calls the facade may run after updating its cache: an exact list, never page-chosen. */
    public static final Set<String> HOOKS = Collections.unmodifiableSet(new HashSet<>(java.util.Arrays.asList(
            "__wosSideButton", "__wosUnsent", "__wosEverywhere", "__wosUsuals", "__wosCutout", "__wosTop", "WosDevice.event")));
}
