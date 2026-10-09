package ai.wizards.os.update;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import ai.wizards.os.BuildConfig;
import ai.wizards.os.MainActivity;
import ai.wizards.os.device.AppState;
import ai.wizards.os.device.DeviceBridge;
import ai.wizards.os.device.Http;

/**
 * In-app update (gap #22). Reads the release feed (reports/wizard-os/latest.json on the private origin), and when it
 * names a newer versionCode: download → check size + SHA-256 from the feed → check the APK is Wizard OS, newer, and
 * signed by exactly the installed app's certificate → hand it to Android's installer (James confirms there).
 * The page shows the banner and progress; state changes arrive as WosDevice.event('update', state).
 */
public final class Updater {
    static final String TAG = "WizardUpdate";
    static final String FEED_PATH = "/reports/wizard-os/latest.json";
    private static final ExecutorService io = Executors.newSingleThreadExecutor();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static DeviceBridge bridge;
    private static volatile JSONObject state = stateOf("idle");
    private static UpdatePolicy.Release release;
    private static File verified;
    private static long lastCheck;
    private static boolean wantsInstall; // James tapped Update and went to allow "Install unknown apps"

    private Updater() {}

    public static void attach(Activity a, DeviceBridge b) { bridge = b; }
    public static void detach(Activity a) { bridge = null; }

    /** Feed: debug (QA) builds may point at the fake Wizard (files/qa_origin.txt); release builds never. */
    static String feed(Context c) { return AppState.origin(c) + FEED_PATH; }

    public static String state() { return state.toString(); }

    private static JSONObject stateOf(String s) {
        JSONObject o = new JSONObject();
        try { o.put("state", s).put("installed", BuildConfig.VERSION_NAME).put("installedCode", BuildConfig.VERSION_CODE); } catch (JSONException ignored) { }
        return o;
    }

    private static void set(String s, Object... kv) {
        JSONObject o = stateOf(s);
        try {
            if (release != null) o.put("version", release.versionName).put("versionCode", release.versionCode).put("notes", release.notes).put("bytes", release.bytes);
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
        } catch (JSONException ignored) { }
        state = o;
        DeviceBridge b = bridge;
        if (b != null) b.emit("update", o.toString());
    }

    /** At most every 30 minutes on resume; the page can force one from Settings. */
    public static void onResume(Activity a) {
        if (wantsInstall && a.getPackageManager().canRequestPackageInstalls()) { wantsInstall = false; install(a); return; }
        if (System.currentTimeMillis() - lastCheck > 30 * 60_000L) check(a);
    }

    public static void check(Context c) {
        final Context app = c.getApplicationContext();
        lastCheck = System.currentTimeMillis();
        String st = state.optString("state");
        if ("downloading".equals(st) || "verifying".equals(st)) return;
        io.execute(() -> {
            String feed = feed(app);
            try {
                JSONObject j = Http.json("GET", feed + "?t=" + System.currentTimeMillis(), AppState.origin(app), null, null);
                UpdatePolicy.Release r = UpdatePolicy.parse(j, feed);
                if (r == null) { set("error", "message", "The update feed is unreadable"); return; }
                release = r;
                if (!UpdatePolicy.newer(r, BuildConfig.VERSION_CODE)) { set("current"); return; }
                File f = apkFile(app, r);
                if (f.isFile() && verify(app, f, r) == null) { verified = f; set("ready"); return; }
                set("available");
                Log.i(TAG, "available " + r.versionName + " (" + r.versionCode + ") over " + BuildConfig.VERSION_CODE);
            } catch (IOException e) {
                Log.i(TAG, "check: " + e.getMessage());
                set("offline");
            }
        });
    }

    /** Update button: download + verify if needed, then open Android's installer. */
    public static void install(Activity a) {
        if (release == null) { check(a); return; }
        if (!a.getPackageManager().canRequestPackageInstalls()) {
            wantsInstall = true;
            set("permission");
            main.post(() -> {
                try { a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))); }
                catch (RuntimeException e) { set("error", "message", "This phone won’t let Wizard OS install updates"); }
            });
            return;
        }
        final UpdatePolicy.Release r = release;
        final Context app = a.getApplicationContext();
        io.execute(() -> {
            File f = apkFile(app, r);
            if (verified == null || !verified.equals(f) || !f.isFile()) {
                try { download(app, r, f); }
                catch (IOException e) { Log.w(TAG, "download: " + e); set("error", "message", "Download failed · try again"); return; }
                set("verifying");
                String bad = verify(app, f, r);
                if (bad != null) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                    Log.w(TAG, "rejected: " + bad);
                    set("error", "message", bad);
                    return;
                }
                verified = f;
            }
            set("installing");
            main.post(() -> launchInstaller(a, f));
        });
    }

    static File apkFile(Context c, UpdatePolicy.Release r) {
        File d = ApkProvider.dir(c);
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        File[] old = d.listFiles();
        if (old != null) for (File x : old) if (!x.getName().startsWith(r.sha256)) //noinspection ResultOfMethodCallIgnored
            x.delete();
        return new File(d, r.sha256 + ".apk");
    }

    private static void download(Context c, UpdatePolicy.Release r, File out) throws IOException {
        set("downloading", "progress", 0);
        File part = new File(out.getPath() + ".part");
        HttpURLConnection h = (HttpURLConnection) new URL(r.url).openConnection();
        try {
            h.setConnectTimeout(10_000);
            h.setReadTimeout(60_000);
            h.setInstanceFollowRedirects(false);
            int code = h.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            long total = r.bytes > 0 ? r.bytes : h.getContentLengthLong();
            if (total > 200L * 1024 * 1024) throw new IOException("too large");
            try (InputStream in = h.getInputStream(); OutputStream o = new FileOutputStream(part)) {
                byte[] b = new byte[65536];
                long n = 0; int k, last = -1;
                while ((k = in.read(b)) > 0) {
                    n += k;
                    if (n > 200L * 1024 * 1024) throw new IOException("too large");
                    o.write(b, 0, k);
                    int p = total > 0 ? (int) Math.min(99, n * 100 / total) : 0;
                    if (p != last && p % 5 == 0) { last = p; set("downloading", "progress", p); }
                }
            }
        } finally { h.disconnect(); }
        if (!part.renameTo(out)) throw new IOException("rename");
    }

    /** null when the file is the update the feed promised and safe to install; otherwise why not, in plain words. */
    static String verify(Context c, File f, UpdatePolicy.Release r) {
        if (r.bytes > 0 && f.length() != r.bytes) return "The download is incomplete";
        String sha;
        try { sha = sha256(f); } catch (IOException | NoSuchAlgorithmException e) { return "Couldn’t check the download"; }
        if (!sha.equals(r.sha256)) return "The download doesn’t match the published checksum";
        PackageManager pm = c.getPackageManager();
        PackageInfo apk = pm.getPackageArchiveInfo(f.getPath(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (apk == null) return "The download isn’t an Android app";
        if (!c.getPackageName().equals(apk.packageName)) return "The download is a different app";
        if (apk.getLongVersionCode() != r.versionCode || apk.getLongVersionCode() <= BuildConfig.VERSION_CODE) return "The download isn’t a newer Wizard OS";
        try {
            PackageInfo me = pm.getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
            if (!UpdatePolicy.sameSigners(signers(me.signingInfo), signers(apk.signingInfo))) return "The download isn’t signed by Wizard OS";
        } catch (PackageManager.NameNotFoundException e) { return "Couldn’t read this app’s signature"; }
        return null;
    }

    /** SHA-256 of each current signing certificate (no past keys: a rotated or extra key is a mismatch). */
    static Set<String> signers(SigningInfo s) {
        Set<String> out = new HashSet<>();
        if (s == null) return out;
        Signature[] sigs = s.getApkContentsSigners();
        if (sigs == null) return out;
        for (Signature g : sigs) {
            try { out.add(hex(MessageDigest.getInstance("SHA-256").digest(g.toByteArray()))); }
            catch (NoSuchAlgorithmException ignored) { }
        }
        return out;
    }

    static String sha256(File f) throws IOException, NoSuchAlgorithmException {
        MessageDigest d = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[65536]; int k;
            while ((k = in.read(b)) > 0) d.update(b, 0, k);
        }
        return hex(d.digest());
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x));
        return s.toString();
    }

    private static void launchInstaller(Activity a, File f) {
        Uri u = Uri.parse("content://" + a.getPackageName() + ".updates/" + f.getName());
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(u, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            a.startActivity(i);
            Log.i(TAG, "installer opened for " + f.getName());
            set("installer");
        } catch (RuntimeException e) {
            Log.w(TAG, "installer: " + e);
            set("error", "message", "Android’s installer didn’t open");
        }
    }

    /** Optional "Update ready" notification when the app is not open (not used by the banner path). */
    static void notifyReady(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel("updates") == null)
            nm.createNotificationChannel(new NotificationChannel("updates", "App updates", NotificationManager.IMPORTANCE_LOW));
        PendingIntent pi = PendingIntent.getActivity(c, 71, new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        nm.notify(7601, new Notification.Builder(c, "updates").setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Wizard OS update ready").setContentIntent(pi).setAutoCancel(true).build());
    }
}
