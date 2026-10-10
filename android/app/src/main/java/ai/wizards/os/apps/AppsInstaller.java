package ai.wizards.os.apps;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import ai.wizards.os.MainActivity;
import ai.wizards.os.device.AppState;
import ai.wizards.os.device.Http;

/**
 * Installs third-party apps the Android Apps server pinned. Same shape as Wizard OS's own updater (update/Updater):
 * HTTP download → SHA-256 + package + version + signer checks → PackageInstaller session (hashing again while
 * streaming) → result in {@link AppsInstallReceiver}.
 *
 *  - The page never supplies a URL: bytes come only from {origin}/android-apps/apk/{sha256}.apk.
 *  - First install: Android's one confirm; Wizard OS asks to become the update owner (API 34+).
 *  - Update of an app Wizard OS owns: USER_ACTION_NOT_REQUIRED, so Android installs it without asking.
 *  - An update must carry the installed app's signing key; anything else is refused before Android sees it.
 */
public final class AppsInstaller {
    public static final String TAG = "WizardApps";
    static final String ACTION_STATUS = "ai.wizards.os.apps.STATUS";
    static final String EXTRA_PKG = "pkg";
    static final int N_FAIL = 7631, N_CONFIRM = 7632;
    private static final ExecutorService io = Executors.newSingleThreadExecutor();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final JSONObject states = new JSONObject();
    /** Push hook (the bridge): status changes go to the open view. */
    static volatile Listener listener;

    public interface Listener { void onStatus(JSONObject s); }

    private AppsInstaller() {}

    public static final class Request {
        public final String sha256, pkg, signer;
        public final long versionCode;
        public final boolean background;
        public Request(String sha256, String pkg, String signer, long versionCode, boolean background) {
            this.sha256 = sha256; this.pkg = pkg; this.signer = signer == null ? "" : signer; this.versionCode = versionCode; this.background = background;
        }
    }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("android_apps", Context.MODE_PRIVATE); }

    /** Packages Wizard OS has installed (so the list can show them even without a launcher entry). */
    static Set<String> known(Context c) { return new HashSet<>(prefs(c).getStringSet("known", new HashSet<>())); }

    private static void remember(Context c, String pkg) {
        Set<String> s = known(c); s.add(pkg);
        prefs(c).edit().putStringSet("known", s).apply();
    }

    /* ------------------------------------------------------------------ status */

    public static synchronized JSONObject status() {
        try { return new JSONObject(states.toString()); } catch (JSONException e) { return new JSONObject(); }
    }

    static synchronized void set(String pkg, String state, Object... kv) {
        try {
            JSONObject o = new JSONObject().put("package", pkg).put("state", state).put("at", System.currentTimeMillis());
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
            states.put(pkg, o);
            // Old finished entries go after a while so the map stays small.
            long cut = System.currentTimeMillis() - 30 * 60_000L;
            for (Iterator<String> it = states.keys(); it.hasNext(); ) {
                JSONObject x = states.optJSONObject(it.next());
                if (x != null && x.optLong("at") < cut && !"downloading".equals(x.optString("state")) && !"installing".equals(x.optString("state"))) it.remove();
            }
            Log.i(TAG, pkg + " → " + state + (kv.length > 1 ? " " + o : ""));
            Listener l = listener;
            if (l != null) { JSONObject copy = new JSONObject(o.toString()); main.post(() -> l.onStatus(copy)); }
        } catch (JSONException ignored) { }
    }

    static boolean busy(String pkg) {
        JSONObject o;
        synchronized (AppsInstaller.class) { o = states.optJSONObject(pkg); }
        if (o == null) return false;
        String s = o.optString("state");
        return ("downloading".equals(s) || "installing".equals(s) || "confirm".equals(s)) && System.currentTimeMillis() - o.optLong("at") < 10 * 60_000L;
    }

    /* ------------------------------------------------------------------ install */

    /** Validate synchronously (plain-words error or null), then download + verify + install on the worker. */
    public static String start(Context c, Request r) {
        Context app = c.getApplicationContext();
        String bad = AppsPolicy.checkRequest(r.sha256, r.pkg, r.signer, app.getPackageName());
        if (bad != null) return bad;
        if (busy(r.pkg)) return null; // already on its way: the view keeps showing progress
        set(r.pkg, "downloading", "progress", 0, "sha256", r.sha256);
        io.execute(() -> run(app, r));
        return null;
    }

    private static void run(Context app, Request r) {
        File f = null;
        try {
            f = file(app, r.sha256);
            if (!f.isFile()) download(app, r, f);
            String why = verify(app, f, r);
            if (why != null) { fail(app, r, why); return; }
            commit(app, r, f);
        } catch (IOException e) {
            Log.w(TAG, "download " + r.pkg + ": " + e);
            fail(app, r, "Couldn’t download it · " + (e.getMessage() == null ? "network" : e.getMessage()));
        } catch (RuntimeException e) {
            Log.w(TAG, "install " + r.pkg + ": " + e);
            fail(app, r, "Something went wrong (" + e.getClass().getSimpleName() + ")");
        } finally {
            // A refused or failed file never lingers; a committed one is deleted when the session reports.
            if (f != null) { JSONObject s = status().optJSONObject(r.pkg); if (s == null || "error".equals(s.optString("state"))) //noinspection ResultOfMethodCallIgnored
                f.delete(); }
        }
    }

    static File dir(Context c) {
        File d = new File(c.getCacheDir(), "android-apps");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static File file(Context c, String sha) { return new File(dir(c), sha + ".apk"); }

    private static void download(Context app, Request r, File out) throws IOException {
        String url = AppsPolicy.apkUrl(AppState.origin(app), r.sha256);
        if (url == null) throw new IOException("bad request");
        File part = new File(out.getPath() + ".part");
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        try {
            h.setConnectTimeout(10_000);
            h.setReadTimeout(60_000);
            h.setInstanceFollowRedirects(false);
            int code = h.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            long total = h.getContentLengthLong();
            if (total > AppsPolicy.MAX_BYTES) throw new IOException("too large");
            try (InputStream in = h.getInputStream(); OutputStream o = new FileOutputStream(part)) {
                byte[] b = new byte[65536];
                long n = 0; int k, last = -1;
                while ((k = in.read(b)) > 0) {
                    n += k;
                    if (n > AppsPolicy.MAX_BYTES) throw new IOException("too large");
                    o.write(b, 0, k);
                    int p = total > 0 ? (int) Math.min(99, n * 100 / total) : 0;
                    if (p != last && p % 10 == 0) { last = p; set(r.pkg, "downloading", "progress", p, "sha256", r.sha256); }
                }
            }
        } finally { h.disconnect(); }
        if (!part.renameTo(out)) throw new IOException("rename");
    }

    /** null when the file is exactly what was asked for and safe to install; otherwise why not, in plain words. */
    static String verify(Context app, File f, Request r) {
        String sha;
        try { sha = sha256(f); } catch (IOException | NoSuchAlgorithmException e) { return "Couldn’t check the download"; }
        PackageManager pm = app.getPackageManager();
        PackageInfo apk = sha.equals(r.sha256) ? pm.getPackageArchiveInfo(f.getPath(), PackageManager.GET_SIGNING_CERTIFICATES) : null;
        return AppsPolicy.checkFile(r.sha256, r.pkg, r.signer, r.versionCode,
                sha, apk == null ? null : apk.packageName, apk == null ? 0 : apk.getLongVersionCode(),
                apk == null ? null : AppsCatalog.signers(apk.signingInfo, false),
                apk == null ? null : AppsCatalog.signers(apk.signingInfo, true),
                AppsCatalog.installedVc(app, r.pkg), AppsCatalog.installedSigners(app, r.pkg));
    }

    static String sha256(File f) throws IOException, NoSuchAlgorithmException {
        MessageDigest d = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[65536]; int k;
            while ((k = in.read(b)) > 0) d.update(b, 0, k);
        }
        return AppsCatalog.hex(d.digest());
    }

    private static void commit(Context app, Request r, File f) {
        set(r.pkg, "installing", "sha256", r.sha256);
        PackageInstaller pi = app.getPackageManager().getPackageInstaller();
        boolean installed = AppsCatalog.installedVc(app, r.pkg) >= 0;
        String[] src = AppsCatalog.source(app, r.pkg);
        boolean owned = AppsPolicy.owned(src[0], src[1], app.getPackageName());
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        p.setAppPackageName(r.pkg);
        p.setSize(f.length());
        p.setInstallReason(PackageManager.INSTALL_REASON_USER);
        if (Build.VERSION.SDK_INT >= 33) p.setPackageSource(PackageInstaller.PACKAGE_SOURCE_STORE);
        int ua = AppsPolicy.requireUserAction(Build.VERSION.SDK_INT, installed, owned);
        if (Build.VERSION.SDK_INT >= 31) {
            if (ua == 2) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            else p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_UNSPECIFIED);
        }
        boolean own = AppsPolicy.requestOwnership(Build.VERSION.SDK_INT, installed);
        if (own && Build.VERSION.SDK_INT >= 34) p.setRequestUpdateOwnership(true);
        int id = -1;
        try {
            id = pi.createSession(p);
            try (PackageInstaller.Session s = pi.openSession(id)) {
                MessageDigest d = MessageDigest.getInstance("SHA-256");
                try (InputStream in = new FileInputStream(f); OutputStream o = s.openWrite("base.apk", 0, f.length())) {
                    byte[] b = new byte[65536]; int k;
                    while ((k = in.read(b)) > 0) { d.update(b, 0, k); o.write(b, 0, k); }
                    s.fsync(o);
                }
                if (!AppsCatalog.hex(d.digest()).equals(r.sha256)) {
                    s.abandon();
                    fail(app, r, "The download changed after it was checked");
                    return;
                }
                // Unique per session (data + request code): PendingIntent equality ignores extras, so a shared one would mix up results.
                Intent i = new Intent(app, AppsInstallReceiver.class).setAction(ACTION_STATUS).setData(Uri.parse("wizard-apps-session:" + id)).putExtra(EXTRA_PKG, r.pkg)
                        .putExtra("bg", r.background).putExtra("sha", r.sha256);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent cb = PendingIntent.getBroadcast(app, id, i, flags);
                Log.i(TAG, "session " + id + " " + r.pkg + " installed=" + installed + " owned=" + owned + " requireUserAction=" + ua + " requestOwnership=" + own);
                s.commit(cb.getIntentSender());
            }
        } catch (IOException | NoSuchAlgorithmException | RuntimeException e) {
            Log.w(TAG, "session: " + e);
            if (id >= 0) { try { pi.abandonSession(id); } catch (RuntimeException ignored) { } }
            fail(app, r, "Android’s installer refused it (" + e.getClass().getSimpleName() + ")");
        }
    }

    private static void fail(Context app, Request r, String why) {
        Log.w(TAG, r.pkg + ": " + why);
        set(r.pkg, "error", "message", why);
        if (r.background || !AppState.front()) notice(app, N_FAIL, "Couldn’t update " + label(app, r.pkg), why, null);
    }

    /** STATUS_* from the session. */
    static void onStatus(Context c, String pkg, int status, String message, Intent confirm, boolean bg, String sha) {
        Context app = c.getApplicationContext();
        Log.i(TAG, "status " + pkg + " " + status + (message != null ? " " + message : ""));
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            if (confirm == null) { set(pkg, "error", "message", "Android’s installer didn’t open"); return; }
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            set(pkg, "confirm");
            if (AppState.front() && !bg) {
                try { app.startActivity(confirm); return; } catch (RuntimeException e) { Log.w(TAG, "confirm: " + e); }
            }
            // Not on screen (or a background update Android still wants to confirm): wait behind a quiet notification.
            notice(app, N_CONFIRM + (pkg.hashCode() & 0xffff), "Update ready: " + label(app, pkg), "Tap to install",
                    PendingIntent.getActivity(app, 0x7680 ^ pkg.hashCode(), confirm, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            return;
        }
        if (sha != null) //noinspection ResultOfMethodCallIgnored
            file(app, sha).delete();
        try { ((android.app.NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(N_CONFIRM + (pkg.hashCode() & 0xffff)); } catch (RuntimeException ignored) { }
        if (status == PackageInstaller.STATUS_SUCCESS) {
            remember(app, pkg);
            JSONObject row = AppsCatalog.row(app, pkg);
            set(pkg, "installed", "versionName", row == null ? "" : row.optString("versionName"), "installer", row == null ? "" : row.optString("installer"),
                    "owner", row == null ? "" : row.optString("owner"));
            postInventorySoon(app);
            return;
        }
        String why = AppsPolicy.failure(status, message);
        set(pkg, "error", "message", why == null ? "Install failed" : why, "status", status);
        if (bg || !AppState.front()) notice(app, N_FAIL, "Couldn’t update " + label(app, pkg), why, null);
    }

    static String label(Context c, String pkg) {
        try { return String.valueOf(c.getPackageManager().getApplicationLabel(c.getPackageManager().getApplicationInfo(pkg, 0))); }
        catch (PackageManager.NameNotFoundException e) { return pkg; }
    }

    private static void notice(Context c, int id, String title, String text, PendingIntent pi) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel("android-apps") == null)
            nm.createNotificationChannel(new NotificationChannel("android-apps", "Android Apps", NotificationManager.IMPORTANCE_LOW));
        if (pi == null) {
            Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            pi = PendingIntent.getActivity(c, 0x7681, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        try {
            nm.notify(id, new Notification.Builder(c, "android-apps").setSmallIcon(android.R.drawable.stat_sys_warning)
                    .setContentTitle(title).setContentText(text).setContentIntent(pi).setAutoCancel(true).build());
        } catch (SecurityException e) { Log.i(TAG, "notice: " + e.getMessage()); }
    }

    /* ------------------------------------------------------------------ server sync */

    /** Tell the Android Apps server what is installed (view open, after an install/uninstall, background job). */
    public static void postInventorySoon(Context c) {
        Context app = c.getApplicationContext();
        io.execute(() -> postInventory(app));
    }

    static boolean postInventory(Context app) {
        try {
            JSONObject body = new JSONObject().put("apps", AppsCatalog.list(app)).put("self", app.getPackageName())
                    .put("device", Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE);
            String o = AppState.origin(app);
            Http.json("POST", o + "/android-apps/api/inventory", o, body.toString().getBytes(StandardCharsets.UTF_8), "application/json");
            return true;
        } catch (IOException | JSONException | RuntimeException e) {
            Log.i(TAG, "inventory: " + e.getMessage());
            return false;
        }
    }

    /** Background: install every pending update for an app Wizard OS owns. Runs on the worker; done() on the main thread. */
    public static void checkUpdates(Context c, Runnable done) {
        Context app = c.getApplicationContext();
        io.execute(() -> {
            int n = 0;
            try {
                postInventory(app);
                String o = AppState.origin(app);
                JSONArray items = Http.json("GET", o + "/android-apps/api/updates", o, null, null).optJSONArray("items");
                for (int i = 0; items != null && i < items.length(); i++) {
                    JSONObject u = items.getJSONObject(i);
                    String pkg = u.optString("package");
                    String[] src = AppsCatalog.source(app, pkg);
                    long vc = AppsCatalog.installedVc(app, pkg);
                    if (!AppsPolicy.autoUpdate(vc >= 0, AppsPolicy.owned(src[0], src[1], app.getPackageName()), vc, u.optLong("versionCode"))) continue;
                    Request r = new Request(u.optString("sha256"), pkg, u.optString("signer"), u.optLong("versionCode"), true);
                    String bad = AppsPolicy.checkRequest(r.sha256, r.pkg, r.signer, app.getPackageName());
                    if (bad != null || busy(pkg)) continue;
                    set(pkg, "downloading", "progress", 0, "sha256", r.sha256);
                    run(app, r);
                    n++;
                }
            } catch (IOException | JSONException | RuntimeException e) {
                Log.i(TAG, "updates: " + e.getMessage());
            }
            Log.i(TAG, "background check: " + n + " update(s) started");
            if (done != null) main.post(done);
        });
    }
}
