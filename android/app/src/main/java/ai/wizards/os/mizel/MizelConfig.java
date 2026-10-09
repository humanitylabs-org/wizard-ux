package ai.wizards.os.mizel;

import android.content.Context;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

/**
 * Where the recorder uploads and how long it waits. Release builds always use the private origin and the real
 * timings; debug (.qa) builds can be pointed at a fake server on the emulator host and given short timers:
 *  - files/qa_origin.txt   "http://10.0.2.2:PORT" (shared with the Everywhere outbox QA hook)
 *  - files/qa_mizel.json   {"pauseTimeoutMs": 20000, "drainGraceMs": 30000, "statusEveryMs": 5000, "keepAfterReadyMs": 0,
 *                           "fakeMic": 0|1|2, "staticNotification": 0|1}   (1 = synthetic tone if AudioRecord cannot open, 2 = always synthetic)
 */
public final class MizelConfig {
    public static final String DEFAULT_ORIGIN = ai.wizards.os.BuildConfig.ORIGIN;
    /** After Stop, the service stays in front this long without upload progress, then hands over to a job. */
    static final long DRAIN_GRACE_MS = 90_000L;
    /** How often a finished meeting is asked whether it is ready (for pruning local audio). */
    static final long STATUS_EVERY_MS = 15 * 60_000L;

    private MizelConfig() {}

    public static String origin(Context c) {
        if (!ai.wizards.os.BuildConfig.DEBUG) return DEFAULT_ORIGIN;
        File f = new File(c.getFilesDir(), "qa_origin.txt");
        if (!f.isFile()) return DEFAULT_ORIGIN;
        try {
            String o = new String(MizelStore.readAll(new FileInputStream(f)), StandardCharsets.UTF_8).trim();
            return o.matches("http://10\\.0\\.2\\.2:\\d+") ? o : DEFAULT_ORIGIN;
        } catch (Exception e) { return DEFAULT_ORIGIN; }
    }

    private static long qa(Context c, String key, long dflt, long min) {
        if (!ai.wizards.os.BuildConfig.DEBUG) return dflt;
        File f = new File(c.getFilesDir(), "qa_mizel.json");
        if (!f.isFile()) return dflt;
        try {
            JSONObject o = new JSONObject(new String(MizelStore.readAll(new FileInputStream(f)), StandardCharsets.UTF_8));
            return o.has(key) ? Math.max(min, o.getLong(key)) : dflt;
        } catch (Exception e) { return dflt; }
    }

    public static long pauseTimeoutMs(Context c) { return qa(c, "pauseTimeoutMs", MizelPolicy.PAUSE_TIMEOUT_MS, 5000); }

    static long drainGraceMs(Context c) { return qa(c, "drainGraceMs", DRAIN_GRACE_MS, 5000); }

    static long statusEveryMs(Context c) { return qa(c, "statusEveryMs", STATUS_EVERY_MS, 1000); }

    /** Debug builds only; release always 0 (real microphone or nothing). */
    static int qaFakeMic(Context c) { return (int) qa(c, "fakeMic", 0, 0); }

    /** Debug builds: no ticking chronometer, so uiautomator can dump the notification shade (it never idles otherwise). */
    static boolean qaStaticNotification(Context c) { return qa(c, "staticNotification", 0, 0) == 1; }

    static long keepAfterReadyMs(Context c) { return qa(c, "keepAfterReadyMs", MizelPolicy.KEEP_AFTER_READY_MS, 0); }
}
