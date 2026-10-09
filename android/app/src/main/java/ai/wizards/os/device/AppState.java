package ai.wizards.os.device;

import android.content.Context;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import ai.wizards.os.BuildConfig;

/** Small process-wide facts the native features share (kept out of MainActivity so branches merge cleanly). */
public final class AppState {
    private static volatile boolean front;

    private AppState() {}

    /** Wizard OS is on screen (MainActivity started). Reply notifications only fire while it is not. */
    public static boolean front() { return front; }
    public static void setFront(boolean on) { front = on; }

    /**
     * Where native HTTP goes. Release: the private Wizard origin. Debug (QA) builds only: files/qa_home.txt may
     * point at a fake Wizard on the emulator host (http://localhost:PORT via adb reverse, or http://10.0.2.2:PORT),
     * so QA never writes to the real one. The shell page itself is then loaded from there too (homeUrl).
     */
    public static String origin(Context c) {
        String qa = qaOrigin(c);
        return qa != null ? qa : BuildConfig.ORIGIN;
    }

    /** The Wizard OS shell URL: the private origin, or the QA fake (debug builds with files/qa_home.txt only). */
    public static String homeUrl(Context c) {
        String qa = qaOrigin(c);
        return qa != null ? qa + "/wizard-os-home/" : BuildConfig.HOME_URL;
    }

    static String qaOrigin(Context c) {
        if (!BuildConfig.DEBUG) return null;
        File f = new File(c.getFilesDir(), "qa_home.txt");
        if (!f.isFile()) return null;
        try {
            String o = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim();
            return isQaOrigin(o) ? o : null;
        } catch (IOException e) { return null; }
    }

    /** QA builds pointed at a fake Wizard: its pages stay in the app like the private origin's do. */
    public static boolean isQaPage(Context c, android.net.Uri u) {
        String qa = qaOrigin(c);
        return qa != null && u != null && qa.equals(u.getScheme() + "://" + u.getHost() + ":" + u.getPort());
    }

    /** Only loopback-style fakes on the emulator host are accepted; anything else falls back to the real origin. */
    public static boolean isQaOrigin(String o) {
        return o != null && o.matches("http://(localhost|10\\.0\\.2\\.2):\\d{2,5}");
    }
}
