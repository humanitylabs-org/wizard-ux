package ai.wizards.os.update;

import android.app.Activity;
import android.app.AppOpsManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.InstallSourceInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.provider.Settings;
import android.util.Log;

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
 * Hands-free in-app update (#22). Reads the release feed (reports/wizard-os/latest.json on the private origin).
 * When it names a newer versionCode: download (by itself on unmetered networks: the on-resume check and a periodic
 * UpdateJob) → check size + SHA-256 from the feed → check the APK is this app, newer, and signed by exactly the
 * pinned Wizard OS key (BuildConfig.UPDATE_SIGNER; QA builds: the installed debug key) → install through a
 * PackageInstaller session with USER_ACTION_NOT_REQUIRED (API 31+). Once Wizard OS has installed itself once, Android
 * lets later updates through without asking; the first one (or API < 31, or "Install unknown apps" not yet allowed)
 * comes back as STATUS_PENDING_USER_ACTION and Android's own confirm screen is shown.
 *
 * Never mid-recording; never under James's fingers: with Wizard OS on screen the page shows one
 * "Update ready · tap to restart" banner, and it installs when he taps it or when the app has been in the background
 * for a moment. State changes reach the page as WosDevice.event('update', state).
 */
public final class Updater {
    static final String TAG = "WizardUpdate";
    static final String FEED_PATH = "/reports/wizard-os/latest.json";
    static final String ACTION_STATUS = "ai.wizards.os.update.STATUS";
    public static final String ACTION_UPDATE = "ai.wizards.os.action.UPDATE";
    static final String EXTRA_VC = "vc";
    static final int N_UPDATE = 7601, N_UPDATED = 7602;
    private static final ExecutorService io = Executors.newSingleThreadExecutor();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static DeviceBridge bridge;
    private static volatile JSONObject state = stateOf("idle");
    private static volatile UpdatePolicy.Release release;
    private static volatile File verified;
    private static long lastCheck;
    private static boolean wantsInstall; // James tapped Update and went to allow "Install unknown apps"
    private static Context appCtx;

    private Updater() {}

    public static void attach(Activity a, DeviceBridge b) {
        bridge = b; appCtx = a.getApplicationContext();
        UpdateJob.schedule(a);
    }
    public static void detach(Activity a) { bridge = null; }

    /** Feed: debug (QA) builds may point at the fake Wizard (files/qa_origin.txt); release builds never. */
    static String feed(Context c) { return AppState.origin(c) + FEED_PATH; }

    public static String state() { return state.toString(); }

    private static JSONObject stateOf(String s) {
        JSONObject o = new JSONObject();
        try { o.put("state", s).put("installed", BuildConfig.VERSION_NAME).put("installedCode", BuildConfig.VERSION_CODE); } catch (JSONException ignored) { }
        return o;
    }

    static void set(String s, Object... kv) {
        JSONObject o = stateOf(s);
        try {
            UpdatePolicy.Release r = release;
            if (r != null) o.put("version", r.versionName).put("versionCode", r.versionCode).put("notes", r.notes).put("bytes", r.bytes);
            for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
        } catch (JSONException ignored) { }
        state = o;
        Log.i(TAG, "state " + o);
        DeviceBridge b = bridge;
        if (b != null) b.emit("update", o.toString());
    }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("updater", Context.MODE_PRIVATE); }

    /* ------------------------------------------------------------------ lifecycle hooks */

    /** At most every 30 minutes on resume; the page can force one from Settings. */
    public static void onResume(Activity a) {
        appCtx = a.getApplicationContext();
        main.removeCallbacks(backgroundInstall);
        cancelNotice(a);
        DeviceBridge b = bridge; // whatever happened in the background (job, refusal), the page shows it now
        if (b != null) b.emit("update", state.toString());
        if (wantsInstall && a.getPackageManager().canRequestPackageInstalls()) { wantsInstall = false; install(a); return; }
        if (System.currentTimeMillis() - lastCheck > 30 * 60_000L) check(a, null);
        // e.g. came back from a recording: show the ready banner (an error stays up until James taps Retry)
        else if (verified != null && !"error".equals(state.optString("state"))) advance(a, false, null);
    }

    /** Wizard OS left the screen: a downloaded update installs after a short grace (unless James comes back). */
    public static void onStop(Activity a) {
        if (verified == null) return;
        main.removeCallbacks(backgroundInstall);
        main.postDelayed(backgroundInstall, UpdatePolicy.BACKGROUND_GRACE_MS);
    }

    private static final Runnable backgroundInstall = () -> {
        Context c = appCtx;
        if (c != null && !AppState.front()) advance(c, false, null);
    };

    /* ------------------------------------------------------------------ check → download → verify → install */

    public static void check(Context c) { check(c, null); }

    /** Read the feed and carry on as far as the rules allow. {@code done} runs (on the io thread) when this pass is over. */
    public static void check(Context c, Runnable done) {
        final Context app = c.getApplicationContext();
        appCtx = app;
        lastCheck = System.currentTimeMillis();
        String st = state.optString("state");
        if ("downloading".equals(st) || "verifying".equals(st) || "installing".equals(st)) { if (done != null) io.execute(done); return; }
        io.execute(() -> {
            try {
                String feed = feed(app);
                // (Under the shell's safety net AppState.origin is the old name, so a fix can still arrive.)
                JSONObject j = Http.json("GET", feed + "?t=" + System.currentTimeMillis(), AppState.origin(app), null, null);
                UpdatePolicy.Release r = UpdatePolicy.parse(j, feed);
                if (r == null) { set("error", "message", "The update feed is unreadable"); return; }
                if (!UpdatePolicy.appOk(r.app, app.getPackageName())) { set("error", "message", "The update feed is for a different app"); return; }
                release = r;
                if (!UpdatePolicy.newer(r, BuildConfig.VERSION_CODE)) { verified = null; set("current"); return; }
                Log.i(TAG, "available " + r.versionName + " (" + r.versionCode + ") over " + BuildConfig.VERSION_CODE);
                File f = apkFile(app, r);
                if (verified == null || !verified.equals(f) || !f.isFile()) verified = (f.isFile() && verify(app, f, r) == null) ? f : null;
                stepNow(app, false);
            } catch (IOException e) {
                Log.i(TAG, "check: " + e.getMessage());
                set("offline");
            } finally {
                if (done != null) done.run();
            }
        });
    }

    /** Update button / ready banner: James wants it now. */
    public static void install(Activity a) {
        appCtx = a.getApplicationContext();
        if (release == null || "error".equals(state.optString("state"))) {
            // Nothing read yet, or a retry: re-read the feed first (it may have been fixed), then go on as tapped.
            release = null; verified = null;
            check(a, () -> { if (release != null && UpdatePolicy.newer(release, BuildConfig.VERSION_CODE)) main.post(() -> advance(a, true, a)); });
            return;
        }
        advance(a, true, a);
    }

    /** Re-evaluate on the io thread. {@code act} is the activity James tapped in (null in the background). */
    static void advance(Context c, boolean tapped, Activity act) {
        final Context app = c.getApplicationContext();
        io.execute(() -> stepNow(app, tapped, act));
    }

    private static void stepNow(Context app, boolean tapped) { stepNow(app, tapped, null); }

    /** One decision (UpdatePolicy.next) and its action. Runs on the io thread. */
    private static void stepNow(Context app, boolean tapped, Activity act) {
        UpdatePolicy.Release r = release;
        if (r == null) return;
        boolean newer = UpdatePolicy.newer(r, BuildConfig.VERSION_CODE);
        boolean ok = verified != null && verified.isFile();
        boolean bad = r.sha256.equals(prefs(app).getString("rejected", ""));
        if (bad && !tapped && !ok) { set("error", "message", prefs(app).getString("rejectedWhy", "Update refused")); return; }
        boolean silent = silentPossible(app);
        UpdatePolicy.Step step = UpdatePolicy.next(newer, ok, unmetered(app), AppState.front(), recording(app),
                silent, tapped);
        Log.i(TAG, "step " + step + " (verified=" + ok + " front=" + AppState.front() + " silent=" + silent + " tapped=" + tapped + ")");
        switch (step) {
            case NONE: return;
            case OFFER: set("available"); return;
            case DOWNLOAD:
                if (!fetch(app, r)) return;
                stepNow(app, tapped, act);
                return;
            case BANNER: set("ready"); return;
            case DEFER:
                set("deferred");
                main.removeCallbacks(deferred);
                main.postDelayed(deferred, 20_000);
                return;
            case WAIT_PERMISSION:
                // Android would ask James and he isn't looking: tell him once per version; his tap does the rest.
                set("ready");
                if (!AppState.front() && UpdatePolicy.mayPromptAgain(prefs(app).getInt("noticed", 0), r.versionCode, false)) {
                    prefs(app).edit().putInt("noticed", r.versionCode).apply();
                    notice(app, "Wizard OS " + r.versionName + " is ready", "Tap to install");
                }
                return;
            case INSTALL:
                if (act != null && !app.getPackageManager().canRequestPackageInstalls()) { askPermission(act); return; }
                commit(app, r, verified, tapped || AppState.front());
        }
    }

    private static final Runnable deferred = () -> { Context c = appCtx; if (c != null) advance(c, false, null); };

    /** Download + verify. false (state already says why) when it can't go on. */
    private static boolean fetch(Context app, UpdatePolicy.Release r) {
        File f = apkFile(app, r);
        try { download(app, r, f); }
        catch (IOException e) { Log.w(TAG, "download: " + e); set("error", "message", "Download failed · try again"); return false; }
        set("verifying");
        String why = verify(app, f, r);
        if (why != null) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            Log.w(TAG, "rejected: " + why);
            prefs(app).edit().putString("rejected", r.sha256).putString("rejectedWhy", why).apply();
            set("error", "message", why);
            return false;
        }
        prefs(app).edit().remove("rejected").remove("rejectedWhy").apply();
        Log.i(TAG, "verified " + r.versionName + " (" + r.versionCode + ")");
        verified = f;
        return true;
    }

    private static void askPermission(Activity a) {
        wantsInstall = true;
        set("permission");
        main.post(() -> {
            try { a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))); }
            catch (RuntimeException e) { set("error", "message", "This phone won’t let Wizard OS install updates"); }
        });
    }

    /* ------------------------------------------------------------------ facts about the phone */

    /** Any Wizard OS recording: native recorder, app orb, floating orb / side button (microphone op active). */
    public static boolean recording(Context c) {
        // A side-button / floating-orb / meeting take holds the one mic owner from start until send or cancel, paused
        // included (a paused MediaRecorder is not an active RECORD_AUDIO op, so the AppOps check below misses it).
        if (UpdatePolicy.takeLive(ai.wizards.os.recording.RecorderService.active() != null,
                ai.wizards.os.everywhere.EverywhereService.appIsRecording(), ai.wizards.os.MicOwner.holder(), false)) return true;
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                AppOpsManager ops = c.getSystemService(AppOpsManager.class);
                if (ops != null && ops.isOpActive(AppOpsManager.OPSTR_RECORD_AUDIO, Process.myUid(), c.getPackageName())) return true;
            } catch (RuntimeException ignored) { }
        }
        return false;
    }

    static boolean unmetered(Context c) {
        ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
        return cm != null && cm.getActiveNetwork() != null && !cm.isActiveNetworkMetered();
    }

    /**
     * Android should let this commit through without asking: API 31+ and "Install unknown apps" allowed. Then a
     * USER_ACTION_NOT_REQUIRED session is silent when Wizard OS is the installer of record / update owner, or updates
     * itself while declaring UPDATE_PACKAGES_WITHOUT_USER_ACTION (both true here). If Android still wants a confirm
     * (older rules, OEM policy) the session says so (STATUS_PENDING_USER_ACTION) and we show Android's screen.
     */
    static boolean silentPossible(Context c) {
        return Build.VERSION.SDK_INT >= 31 && c.getPackageManager().canRequestPackageInstalls();
    }

    @SuppressWarnings("deprecation")
    static String installerOfRecord(Context c) {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                InstallSourceInfo s = c.getPackageManager().getInstallSourceInfo(c.getPackageName());
                return s.getInstallingPackageName();
            }
            return c.getPackageManager().getInstallerPackageName(c.getPackageName());
        } catch (PackageManager.NameNotFoundException | RuntimeException e) { return null; }
    }

    /**
     * The one signing certificate an update must carry. Release: the Wizard OS key, built in (build.gradle). QA builds
     * (UPDATE_SIGNER empty): the debug key this build was signed with; each Thales build job has its own, and the
     * QA fixtures (debug, qanext, qalater) come from the same job.
     */
    static String pinnedSigner(Context c) {
        if (!BuildConfig.UPDATE_SIGNER.isEmpty() || !BuildConfig.DEBUG) return BuildConfig.UPDATE_SIGNER;
        Set<String> me = installedSigners(c);
        return me.size() == 1 ? me.iterator().next() : "";
    }

    static Set<String> installedSigners(Context c) {
        try { return signers(c.getPackageManager().getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES).signingInfo); }
        catch (PackageManager.NameNotFoundException e) { return new HashSet<>(); }
    }

    /* ------------------------------------------------------------------ files */

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
        Log.i(TAG, "downloading " + r.url);
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
        Set<String> me = installedSigners(c);
        if (me.isEmpty()) return "Couldn’t read this app’s signature";
        if (!UpdatePolicy.signerOk(me, signers(apk.signingInfo), pinnedSigner(c), r.signer)) return "The download isn’t signed by Wizard OS";
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
        try (InputStream in = new FileInputStream(f)) {
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

    /* ------------------------------------------------------------------ PackageInstaller session */

    /**
     * Stream the verified file into a session (hashing it again on the way, so a file swapped after the check is
     * refused) and commit. The result arrives in {@link InstallReceiver}. {@code relaunch}: open Wizard OS again once
     * the new version is in (James was in it).
     */
    @android.annotation.SuppressLint("ApplySharedPref") // must hit disk before Android kills us for the install
    private static void commit(Context app, UpdatePolicy.Release r, File f, boolean relaunch) {
        if (f == null || !f.isFile()) { verified = null; set("error", "message", "The download is gone · try again"); return; }
        set("installing");
        PackageInstaller pi = app.getPackageManager().getPackageInstaller();
        for (PackageInstaller.SessionInfo s : pi.getMySessions()) { try { pi.abandonSession(s.getSessionId()); } catch (RuntimeException ignored) { } }
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        p.setAppPackageName(app.getPackageName());
        p.setSize(f.length());
        int ua = UpdatePolicy.requireUserAction(Build.VERSION.SDK_INT);
        // QA builds only: files/qa_update_confirm.txt forces Android's confirm (USER_ACTION_REQUIRED = 1), so the emulator
        // exercises STATUS_PENDING_USER_ACTION → EXTRA_INTENT and a cancelled confirm like an older phone would.
        if (BuildConfig.DEBUG && new File(app.getFilesDir(), "qa_update_confirm.txt").isFile()) ua = 1;
        if (Build.VERSION.SDK_INT >= 31) {
            // Lint wants the SDK constants themselves (the policy's ints are the same values, unit-tested there).
            if (ua == 2) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            else if (ua == 1) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
            else p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_UNSPECIFIED);
        }
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
                if (!hex(d.digest()).equals(r.sha256)) {
                    s.abandon();
                    verified = null;
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                    set("error", "message", "The download changed after it was checked");
                    return;
                }
                // commit(), not apply(): Android kills this process as soon as the new version is in.
                prefs(app).edit().putInt("relaunch", relaunch ? r.versionCode : 0).commit();
                Intent i = new Intent(app, InstallReceiver.class).setAction(ACTION_STATUS).putExtra(EXTRA_VC, r.versionCode);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent cb = PendingIntent.getBroadcast(app, id, i, flags);
                Log.i(TAG, "session " + id + " commit " + r.versionName + " (" + r.versionCode + ") requireUserAction=" + ua
                        + " installer=" + installerOfRecord(app));
                s.commit(cb.getIntentSender());
            }
        } catch (IOException | NoSuchAlgorithmException | RuntimeException e) {
            Log.w(TAG, "session: " + e);
            if (id >= 0) { try { pi.abandonSession(id); } catch (RuntimeException ignored) { } }
            set("error", "message", "Android’s installer refused the update (" + e.getClass().getSimpleName() + ")");
        }
    }

    /** STATUS_* from the session (InstallReceiver). */
    static void onStatus(Context c, int status, String message, Intent confirm, int vc) {
        Context app = c.getApplicationContext();
        appCtx = app;
        Log.i(TAG, "status " + status + " vc=" + vc + (message != null ? " msg=" + message : ""));
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            if (confirm == null) { set("error", "message", "Android’s installer didn’t open"); return; }
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (AppState.front()) {
                try { app.startActivity(confirm); set("confirm"); Log.i(TAG, "installer opened (confirm)"); return; }
                catch (RuntimeException e) { Log.w(TAG, "confirm: " + e); }
            }
            // Not on screen: Android's confirm waits behind a notification tap.
            set("confirm");
            PendingIntent pi = PendingIntent.getActivity(app, 72, confirm, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            notice(app, "Wizard OS update ready", "Tap to install", pi);
            return;
        }
        if (status == PackageInstaller.STATUS_SUCCESS) {
            NotificationManager nm = app.getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(N_UPDATE); // "ready" is done; "updated · tap to open" (N_UPDATED) stays
            verified = null; set("installed"); return;
        }
        prefs(app).edit().putInt("relaunch", 0).apply();
        String why = UpdatePolicy.failureMessage(status, message);
        Log.w(TAG, "install failed: " + why);
        set("error", "message", why == null ? "Update failed" : why, "status", status);
        if (!AppState.front()) notice(app, "Wizard OS couldn’t update", why);
    }

    /** MY_PACKAGE_REPLACED: the new version is in. Reopen Wizard OS if James was in it when it restarted. */
    @android.annotation.SuppressLint("ApplySharedPref")
    static void onReplaced(Context c) {
        SharedPreferences p = prefs(c);
        int want = p.getInt("relaunch", 0);
        p.edit().putInt("relaunch", 0).remove("noticed").remove("rejected").remove("rejectedWhy").commit();
        UpdateJob.schedule(c);
        Log.i(TAG, "replaced; now " + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ") installer=" + installerOfRecord(c) + " relaunch=" + want);
        if (want <= 0) return;
        // James was in Wizard OS when it restarted: bring it back. Android may refuse a start from the background
        // (it allows it when Wizard Everywhere's overlay is on), so a tap-to-open notification is left as well;
        // opening the app clears it.
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        notice(c, N_UPDATED, "Wizard OS updated to " + BuildConfig.VERSION_NAME, "Tap to open",
                PendingIntent.getActivity(c, 73, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        try { c.startActivity(i); } catch (RuntimeException e) { Log.i(TAG, "relaunch: " + e.getMessage()); }
    }

    /* ------------------------------------------------------------------ notifications */

    private static void notice(Context c, String title, String text) {
        Intent i = new Intent(c, MainActivity.class).setAction(ACTION_UPDATE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        notice(c, title, text, PendingIntent.getActivity(c, 71, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    private static void notice(Context c, String title, String text, PendingIntent pi) { notice(c, N_UPDATE, title, text, pi); }

    private static void notice(Context c, int id, String title, String text, PendingIntent pi) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel("updates") == null)
            nm.createNotificationChannel(new NotificationChannel("updates", "App updates", NotificationManager.IMPORTANCE_LOW));
        try {
            nm.notify(id, new Notification.Builder(c, "updates").setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle(title).setContentText(text).setContentIntent(pi).setAutoCancel(true).build());
        } catch (SecurityException e) { Log.i(TAG, "notice: " + e.getMessage()); }
    }

    static void cancelNotice(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) { nm.cancel(N_UPDATE); nm.cancel(N_UPDATED); }
    }

    /** "Update ready" notification tap (MainActivity intent action): install with James looking. */
    public static void onIntent(Activity a, Intent i) {
        if (i == null || !ACTION_UPDATE.equals(i.getAction())) return;
        i.setAction(Intent.ACTION_MAIN);
        install(a);
    }
}
