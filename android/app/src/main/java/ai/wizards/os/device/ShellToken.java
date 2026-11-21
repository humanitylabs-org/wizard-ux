package ai.wizards.os.device;

import android.content.Context;
import android.content.SharedPreferences;

import java.net.URL;
import java.net.URLConnection;
import java.util.regex.Pattern;

/**
 * The browser owner boundary's shell token for the app's own native calls (wizard-os#133).
 *
 * With the boundary on (`wam browser-boundary on`), the Agent Service and the App Manager listener answer an owner
 * route only when the call carries {@code X-Wizard-Shell-Token}. The shell page adds it to its own fetch/XHR
 * (core/shell-token.js), but the app's native features call the box themselves (sharing to Wizard, Archimedes
 * Anywhere, reply notifications, dictation, Wizard ID): without the token they would all be refused once a box turns
 * the boundary on. The top-level shell page hands the token over ({@code WizardOSNative.shellToken}), and MainActivity
 * accepts it only while its bridges are gated, so only the shell page itself can set it, never an app frame. The
 * token stays in this app's private storage (background jobs need it after a restart) and goes only to owner routes
 * on the box it came from: the same rule as shell-token.js, so no app backend and no other host ever sees it.
 *
 * Off (the default; no box has the boundary on): nothing is stored and no call changes.
 */
public final class ShellToken {
    public static final String HEADER = "X-Wizard-Shell-Token";
    private static final String PREFS = "wizard_shell_token";
    private static final Pattern TOKEN = Pattern.compile("[a-f0-9]{64}");
    // Same owner routes as web/core/shell-token.js (OWNER).
    private static final Pattern OWNER = Pattern.compile("^/(?:wizard/|api/|v1/|wizard-os-home/(?:api|store-install)/|wizard-ux/(?:api|store-install)/).*");

    /** The box and its token, always read and replaced together (one immutable pair), so a call never mixes two boxes. */
    private static final class Pair {
        final String origin, token;
        Pair(String origin, String token) { this.origin = origin; this.token = token; }
    }
    private static final Pair NONE = new Pair("", "");
    private static volatile boolean loaded;
    private static volatile Pair current = NONE;

    private ShellToken() {}

    public static boolean valid(String t) { return t != null && TOKEN.matcher(t).matches(); }

    /** Reads what an earlier run stored (once per process); every native caller gets its origin through AppState first. */
    static void load(Context c) {
        if (loaded || c == null) return;
        SharedPreferences p = c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String o = p.getString("origin", ""), t = p.getString("token", "");
        synchronized (ShellToken.class) {
            if (loaded) return;
            if (valid(t) && o != null && !o.isEmpty()) current = new Pair(o, t);
            loaded = true;
        }
    }

    /** From the shell page of the box at {@code boxOrigin} (gated bridge only). An invalid token is ignored. */
    public static void set(Context c, String boxOrigin, String t) {
        boxOrigin = normalize(boxOrigin);
        if (!valid(t) || boxOrigin.isEmpty()) return;
        synchronized (ShellToken.class) { current = new Pair(boxOrigin, t); loaded = true; }
        c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("origin", boxOrigin).putString("token", t).apply();
    }

    /** The box says the boundary is off (or this phone moved to another Wizard): forget the token. */
    public static void clear(Context c) {
        synchronized (ShellToken.class) { current = NONE; loaded = true; }
        c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    /** Adds the header to a call to an owner route on the token's own box; anything else goes out unchanged. */
    public static void apply(URLConnection c) {
        if (c == null) return;
        Pair p = current;
        String t = forUrl(p.origin, p.token, c.getURL());
        if (t != null) c.setRequestProperty(HEADER, t);
    }

    /** The token for {@code url}, or null: only a valid token, only its own origin, only an owner route. */
    static String forUrl(String boxOrigin, String t, URL url) {
        if (!valid(t) || boxOrigin == null || boxOrigin.isEmpty() || url == null) return null;
        String path = url.getPath();
        if (path == null || path.contains("//") || !OWNER.matcher(path).matches()) return null;
        return boxOrigin.equals(originOf(url)) ? t : null;
    }

    /** "https://Box.example.ts.net:443/" -> "https://box.example.ts.net"; "" when it is not an http(s) origin. */
    static String normalize(String o) {
        if (o == null || o.isEmpty()) return "";
        try {
            URL u = new URL(o);
            String p = u.getPath();
            if ((p != null && !p.isEmpty() && !p.equals("/")) || u.getQuery() != null || u.getRef() != null) return "";
            return originOf(u);
        } catch (java.net.MalformedURLException e) { return ""; }
    }

    static String originOf(URL u) {
        String scheme = u.getProtocol() == null ? null : u.getProtocol().toLowerCase(java.util.Locale.ROOT);
        String host = u.getHost() == null ? null : u.getHost().toLowerCase(java.util.Locale.ROOT);
        if (!"https".equals(scheme) && !"http".equals(scheme)) return "";
        if (scheme == null || host == null || host.isEmpty() || u.getUserInfo() != null) return "";
        int port = u.getPort();
        boolean dflt = port == -1 || ("https".equals(scheme) && port == 443) || ("http".equals(scheme) && port == 80);
        return scheme + "://" + host + (dflt ? "" : ":" + port);
    }
}
