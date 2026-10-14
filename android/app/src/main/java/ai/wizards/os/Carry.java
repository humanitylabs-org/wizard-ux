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
 * One-time carry of the phone's local Wizard OS state from an older name of this Wizard (the build's first
 * legacy host, see device/WizardAddress) to its own name. Builds without an older name never carry. A WebView keeps localStorage and IndexedDB per origin, so without this the first
 * launch on the new address would start with no drafts, no unsent messages and every thread unread.
 *
 * Flow: the first launch after the update opens source() + PAGE (the same Wizard serves it on both names).
 * That page hands what it can read to WizardOSNative.carryOut(json); the app saves it to files/carry.json and
 * opens the shell on the new origin, whose first script (core/carry-in.js) asks carryIn() for it, writes what
 * is missing, and calls carryDone(), which deletes the file. If the old name cannot be reached the app goes
 * straight home and tries again on a later launch, at most MAX_TRIES times.
 */
final class Carry {
    static final String PAGE = "/wizard-os-home/carry.html";
    static final int MAX_TRIES = 3;
    static final long TIMEOUT_MS = 10_000L;
    static final int MAX_CHARS = 24 * 1024 * 1024;
    private static final String PREFS = "carry";

    private Carry() {}

    /** Where the old state lives: the legacy origin in release builds (null if none); debug (QA) builds only via files/qa_carry_from.txt. */
    static String source(Context c) {
        if (!BuildConfig.DEBUG) return ai.wizards.os.device.WizardAddress.legacyOrigin();
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
        return source(c) != null && !p.getBoolean("done", false) && p.getInt("tries", 0) < MAX_TRIES;
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
