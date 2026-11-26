package ai.wizards.os;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Instant home-screen apps (wizard-ux issue 1830, switch wizard/pin-instant-open, off by default): the Android half.
 * The switch lives in the shell; the main page copies it here (WizardOSNative.pinInstantSwitch), because a home-screen
 * app window's page never sees the shell's switches. Rules are in PinInstantPolicy, the file cache in PinCache.
 *
 *  - {@link #reached}: any Wizard window got an answer from this box (when, and over which network).
 *  - {@link #skipConnecting}: a pinned open may leave out the Connecting screen.
 *  - The last screen of each pinned app, saved when its window leaves the screen and shown at the next cold open
 *    until the app's page has loaded (MainActivity pinShot*). App-private cache; switch off deletes them.
 *  - {@link #cache}: the pinned window's phone-side file cache.
 */
final class PinInstant {
    private static final String PREFS = "pin-instant-open";

    private PinInstant() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean on(Context c) { return prefs(c).getBoolean("on", false); }

    static void setOn(Context c, boolean on) {
        if (on(c) == on) return;
        prefs(c).edit().putBoolean("on", on).remove("reachedAt").remove("reachedNet").remove("reachedOrigin").apply();
        android.util.Log.i("WizardOSPinInstant", "pin-instant-open switch " + (on ? "on" : "off"));
        if (!on) {
            final Context app = c.getApplicationContext();
            new Thread(() -> { PinCache.clear(cacheDir(app)); PinCache.clear(shotDir(app)); }, "pin-instant-clear").start();
        }
    }

    /** The network an answer came over right now ("" with no network). */
    static String network(Context c) {
        try {
            android.net.ConnectivityManager cm = c.getSystemService(android.net.ConnectivityManager.class);
            android.net.Network n = cm == null ? null : cm.getActiveNetwork();
            android.net.NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
            boolean[] reach = ReachScreen.net(c);
            return PinInstantPolicy.network(nc != null, n == null ? "" : String.valueOf(n.getNetworkHandle()), reach[1]);
        } catch (RuntimeException e) { return ""; }
    }

    /** A Wizard window got an answer from this box (a page committed or painted). Only while the switch is on; the
     *  same answer again within a second or two (a commit and its paint) is written once. */
    static void reached(Context c) {
        if (!on(c)) return;
        long now = System.currentTimeMillis();
        SharedPreferences p = prefs(c);
        String net = network(c), origin = ai.wizards.os.device.AppState.origin(c);
        if (now - p.getLong("reachedAt", 0) >= 0 && now - p.getLong("reachedAt", 0) < 2_000L
                && net.equals(p.getString("reachedNet", "")) && origin.equals(p.getString("reachedOrigin", ""))) return;
        p.edit().putLong("reachedAt", now).putString("reachedNet", net).putString("reachedOrigin", origin).apply();
    }

    static boolean skipConnecting(Context c) {
        SharedPreferences p = prefs(c);
        boolean sameBox = ai.wizards.os.device.AppState.origin(c).equals(p.getString("reachedOrigin", ""));
        return sameBox && PinInstantPolicy.skipConnecting(p.getBoolean("on", false), System.currentTimeMillis(),
                p.getLong("reachedAt", 0), p.getString("reachedNet", ""), network(c));
    }

    /* ---- the saved last screen of each pinned app ---- */

    static File shotDir(Context c) { return new File(c.getApplicationContext().getCacheDir(), "pin-shots"); }

    static File shotFile(Context c, String origin, String app) {
        return new File(shotDir(c), PinCache.sha1((origin + "|" + app).getBytes(java.nio.charset.StandardCharsets.UTF_8)) + ".jpg");
    }

    static Bitmap shot(Context c, String origin, String app) {
        if (app == null || !on(c)) return null;
        File f = shotFile(c, origin, app);
        if (!f.isFile() || !PinInstantPolicy.shotFresh(System.currentTimeMillis(), f.lastModified())) return null;
        // RGB_565: half the memory of the default, so it decodes and reaches the screen sooner (a JPEG has no alpha).
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inPreferredConfig = Bitmap.Config.RGB_565;
        try { return BitmapFactory.decodeFile(f.getPath(), o); } catch (RuntimeException | OutOfMemoryError e) { return null; }
    }

    static void saveShot(Context c, String origin, String app, Bitmap b) {
        final Context ctx = c.getApplicationContext();
        new Thread(() -> {
            try {
                File dir = shotDir(ctx);
                if (!dir.isDirectory() && !dir.mkdirs()) return;
                File f = shotFile(ctx, origin, app), tmp = new File(dir, f.getName() + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { b.compress(Bitmap.CompressFormat.JPEG, 82, out); }
                if (!on(ctx) || !tmp.renameTo(f)) tmp.delete();
            } catch (IOException | RuntimeException e) { /* no picture this time */ }
            finally { b.recycle(); }
        }, "pin-shot-save").start();
    }

    /* ---- the file cache ---- */

    static File cacheDir(Context c) { return new File(c.getApplicationContext().getCacheDir(), "pin-files"); }

    static PinCache cache(Context c) {
        return new PinCache(cacheDir(c), PinInstant::read, ai.wizards.os.device.AppState.origin(c));
    }

    /** The phone's own read of a box file for the cache: the WebView's headers and cookies, no redirects. */
    static PinCache.Reply read(String url, Map<String, String> headers) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        try {
            con.setInstanceFollowRedirects(false);
            con.setConnectTimeout(10_000); con.setReadTimeout(20_000);
            con.setUseCaches(false);
            for (Map.Entry<String, String> e : headers.entrySet()) con.setRequestProperty(e.getKey(), e.getValue());
            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) con.setRequestProperty("Cookie", cookie);
            int status = con.getResponseCode();
            Map<String, String> out = new LinkedHashMap<>();
            for (Map.Entry<String, List<String>> e : con.getHeaderFields().entrySet()) {
                if (e.getKey() == null || e.getValue() == null || e.getValue().isEmpty()) continue;
                String k = e.getKey().toLowerCase(Locale.ROOT);
                if (k.equals("set-cookie")) for (String v : e.getValue()) android.webkit.CookieManager.getInstance().setCookie(url, v);
                out.put(k, k.equals("set-cookie") ? "1" : String.join(", ", e.getValue()));
            }
            long length = con.getContentLengthLong();
            if (length > PinInstantPolicy.MAX_FILE) throw new IOException("too big to keep");
            java.io.InputStream in = status >= 400 ? con.getErrorStream() : (status == 304 || status == 204 ? null : con.getInputStream());
            byte[] body;
            try { body = PinCache.readAll(in, PinInstantPolicy.MAX_FILE); } finally { if (in != null) in.close(); }
            if (body == null) throw new IOException("too big to keep");
            return new PinCache.Reply(status, con.getResponseMessage(), out, body);
        } finally { con.disconnect(); }
    }

    static android.webkit.WebResourceResponse response(PinCache.Reply r) {
        return new android.webkit.WebResourceResponse(r.mime(), r.charset(), r.status, r.reason,
                PinInstantPolicy.replay(r.headers), new java.io.ByteArrayInputStream(r.body));
    }
}
