package ai.wizards.os.photos;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Pure rules for window.wizardPhotosPort, protocol v1 (Settings › Photos backup in the web shell).
 * page → {v:1, id, method, params}; native → {v:1, id, ok, result | error}; push → {v:1, type:"status", status}.
 * The page may only read the status below and flip settings. Keys, OAuth state, the device id and photos never cross.
 */
public final class PhotosBridgePolicy {
    private PhotosBridgePolicy() {}
    public static final int VERSION = 1;
    /** Older web sends this one word: it opens the native screen (PhotosActivity), the fallback until the web page is proven. */
    public static final String LEGACY_OPEN = "open";
    static final Set<String> METHODS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "status", "setEnabled", "setOption", "connect", "runNow", "permissions", "albums", "setAlbums", "disconnect")));
    static final int MAX_ALBUMS = 500;

    public static boolean method(String m) { return m != null && METHODS.contains(m); }

    /** Web switch name → SharedPreferences key. Only these two booleans are writable from the page. */
    public static String option(String key) { return "wifi".equals(key) ? "wifi" : "charge".equals(key) ? "charge" : null; }

    /** Parses one page message; null for anything that is not a well-formed v1 request for an allowed method. */
    public static JSONObject request(String data) {
        if (data == null || data.length() > 16 * 1024) return null;
        try {
            JSONObject m = new JSONObject(data);
            if (m.optInt("v", 0) != VERSION) return null;
            String id = m.optString("id", "");
            if (id.isEmpty() || id.length() > 64 || !method(m.optString("method", null))) return null;
            if (m.has("params") && m.optJSONObject("params") == null) return null;
            if (!m.has("params")) m.put("params", new JSONObject());
            return m;
        } catch (JSONException e) { return null; }
    }

    /** MediaStore bucket ids are decimal (possibly negative) integers. Anything else is refused, not stored. */
    public static Set<String> albums(JSONArray ids) {
        if (ids == null || ids.length() > MAX_ALBUMS) throw new IllegalArgumentException("Too many albums");
        Set<String> out = new LinkedHashSet<>();
        for (int i = 0; i < ids.length(); i++) {
            String s = ids.optString(i, "");
            if (!s.matches("-?\\d{1,20}")) throw new IllegalArgumentException("Unknown album");
            out.add(s);
        }
        return out;
    }

    /** The shell is the only page that may drive backup: the private origin's /wizard-os-home main frame. */
    public static boolean shellPath(String path) { return path != null && (path.equals("/wizard-os-home") || path.startsWith("/wizard-os-home/")); }

    /** Everything native reports about backup. Plain fields so the JSON shape is unit-tested off-device. */
    public static final class Snapshot {
        public boolean connected, enabled, wifi = true, charge = true, readable, location, limited, signingIn;
        public String server = "", message = "";
        public int done, total;
        public long lastSync;
    }

    /** Whitelisted status; never copies a preference wholesale. */
    public static JSONObject status(Snapshot s) throws JSONException {
        String message = s.message == null || s.message.isEmpty() ? "Turn on backup to sign in with your fingerprint" : s.message;
        return new JSONObject().put("v", VERSION).put("connected", s.connected).put("enabled", s.enabled)
                .put("wifi", s.wifi).put("charge", s.charge).put("server", s.server == null ? "" : s.server)
                .put("done", Math.max(0, s.done)).put("total", Math.max(0, s.total)).put("lastSync", Math.max(0, s.lastSync))
                .put("message", message).put("limited", s.limited).put("signingIn", s.signingIn)
                .put("access", new JSONObject().put("photos", s.readable).put("location", s.location))
                // Backup is on but Android access is missing: the page shows one "Allow photo access" button.
                .put("needsAccess", s.enabled && (!s.readable || !s.location));
    }
}
