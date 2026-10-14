package ai.wizards.os;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * One-time carry of the phone's local Wizard OS state from the retired private.wizard001.com name to this
 * Wizard's tailnet name. A WebView keeps localStorage and IndexedDB per origin, so without this the first
 * launch on the new address would start with no drafts, no unsent messages and every thread unread.
 *
 * Flow: the first launch after the update opens source() + PAGE (the same Wizard serves it on both names).
 * That page hands what it can read to WizardOSNative.carryOut(json); the app saves it to files/carry.json and
 * opens the shell on the new origin, whose first script (core/carry-in.js) asks carryIn() for it, writes what
 * is missing, and calls carryDone(), which deletes the file. If the old name cannot be reached the app goes
 * straight home and tries again on a later launch, at most MAX_TRIES times. A fresh install (never updated)
 * has nothing on the old name, so it never contacts it and records the carry as done.
 */
final class Carry {
    static final String PAGE = "/wizard-os-home/carry.html";
    static final int MAX_TRIES = 3;
    static final long TIMEOUT_MS = 10_000L;
    static final int MAX_CHARS = 24 * 1024 * 1024;
    private static final String PREFS = "carry";

    private Carry() {}

    /** Where the old state lives: the legacy origin in release builds; debug (QA) builds only via files/qa_carry_from.txt. */
    static String source(Context c) {
        if (!BuildConfig.DEBUG) return "https://" + Origin.LEGACY_HOST;
        File f = new File(c.getFilesDir(), "qa_carry_from.txt");
        if (!f.isFile()) return null;
        try {
            String o = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim();
            return ai.wizards.os.device.AppState.isQaOrigin(o) ? o : null;
        } catch (IOException e) { return null; }
    }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** Should this launch open the carry page before the shell? */
    static boolean pending(Context c) {
        SharedPreferences p = prefs(c);
        if (p.getBoolean("done", false) || p.getInt("tries", 0) >= MAX_TRIES) return false;
        // A new install has no state at the retired origin. Persist this decision so its next update does not
        // turn a fresh post-migration install into a legacy-transfer candidate. (Same rule in QA builds, so the
        // emulator harness exercises the exact production decision.)
        try {
            android.content.pm.PackageInfo info = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            if (!LegacyCarryPolicy.upgradedInstall(info.firstInstallTime, info.lastUpdateTime)) {
                finished(c);
                return false;
            }
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            return false;
        }
        return source(c) != null;
    }

    static String pageUrl(Context c) { return source(c) + PAGE; }

    static boolean isPage(Context c, String url) {
        String s = source(c);
        return s != null && url != null && url.split("[?#]", 2)[0].equals(s + PAGE);
    }

    static void attempt(Context c) {
        SharedPreferences p = prefs(c);
        p.edit().putInt("tries", p.getInt("tries", 0) + 1).apply();
    }

    static void finished(Context c) { prefs(c).edit().putBoolean("done", true).apply(); }

    static File file(Context c) { return new File(c.getFilesDir(), "carry.json"); }

    /** Keep what the old origin handed over. False when it is too large or not a JSON object. */
    static boolean save(Context c, String json) {
        if (!looksLikeObject(json)) return false;
        File tmp = new File(c.getFilesDir(), "carry.json.tmp");
        try (OutputStream o = new FileOutputStream(tmp)) {
            o.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            tmp.delete();
            return false;
        }
        return tmp.renameTo(file(c));
    }

    static boolean looksLikeObject(String json) {
        return json != null && json.length() <= MAX_CHARS && json.startsWith("{") && json.endsWith("}");
    }

    static String load(Context c) {
        File f = file(c);
        if (!f.isFile() || f.length() > MAX_CHARS * 4L) return "";
        try { return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8); } catch (IOException e) { return ""; }
    }

    static void clear(Context c) { file(c).delete(); }
}
