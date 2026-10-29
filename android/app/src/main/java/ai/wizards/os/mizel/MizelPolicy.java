package ai.wizards.os.mizel;

import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Pattern;

/** Pure decisions for the Mizel meeting recorder (no Android types), unit-tested off-device. */
public final class MizelPolicy {
    /** Retry schedule for chunk uploads and the stop call: 2 s, 5 s, 15 s, 30 s, 1 min, then every 2 min forever. */
    static final long[] BACKOFF_MS = {2000, 5000, 15000, 30000, 60000, 120000};
    /** Paused this long → the recording ends by itself with reason pause_timeout. */
    public static final long PAUSE_TIMEOUT_MS = 30 * 60_000L;
    /** Local audio is kept this long after the meeting reports status ready. */
    public static final long KEEP_AFTER_READY_MS = 24 * 60 * 60_000L;
    /** Same id rule as the meetings service (_mid): also keeps ids safe as directory names. */
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{3,64}");

    public static final String REASON_USER = "user", REASON_PAUSE_TIMEOUT = "pause_timeout", REASON_PROCESS_DEATH = "process_death";

    private MizelPolicy() {}

    public static boolean validMeetingId(String id) { return id != null && ID.matcher(id).matches(); }

    /** Delay before the next try after {@code attempts} consecutive failures (attempts ≥ 1). Never gives up. */
    public static long backoff(int attempts) {
        if (attempts <= 0) return 0;
        return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1];
    }

    /**
     * A refusal that will never succeed on retry: the chunk is dropped from the outbox (logged) so the queue and the
     * stop can move on. Auth (401/403), timeouts, rate limits and server trouble are retried.
     */
    public static boolean permanent(int status) {
        return status == 400 || status == 404 || status == 405 || status == 409 || status == 410 || status == 413 || status == 415 || status == 422;
    }

    public static String chunkPath(String meetingId, int seq, long startMs) {
        return "/meetings/api/meetings/" + meetingId + "/chunks?source=me&seq=" + seq + "&start_ms=" + startMs;
    }

    public static String stopPath(String meetingId) { return "/meetings/api/meetings/" + meetingId + "/stop"; }

    public static String meetingPath(String meetingId) { return "/meetings/api/meetings/" + meetingId; }

    /** {"final_seq":{"me":N},"reason":"…"}; N is -1 when nothing was recorded. */
    public static String stopBody(int finalSeq, String reason) {
        String r = REASON_PAUSE_TIMEOUT.equals(reason) || REASON_PROCESS_DEATH.equals(reason) ? reason : REASON_USER;
        return "{\"final_seq\":{\"me\":" + finalSeq + "},\"reason\":\"" + r + "\"}";
    }

    /** True once every chunk up to and including finalSeq has been acknowledged (or permanently refused). */
    public static boolean stopReady(int finalSeq, int lowestUnresolvedSeq) {
        return lowestUnresolvedSeq < 0 || lowestUnresolvedSeq > finalSeq;
    }

    /** Local files may go once the meeting is ready (or gone) and a day has passed. */
    public static boolean prunable(boolean stopSent, long readyAt, long now) {
        return prunable(stopSent, readyAt, now, KEEP_AFTER_READY_MS);
    }

    public static boolean prunable(boolean stopSent, long readyAt, long now, long keepMs) {
        return stopSent && readyAt > 0 && now - readyAt >= keepMs;
    }

    /** "HH:MM" in the phone's zone for the "Recording ended unexpectedly at HH:MM" notification. */
    public static String clock(long epochMs, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz);
        c.setTimeInMillis(epochMs);
        return String.format(Locale.US, "%02d:%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
    }

    /** "m:ss" or "h:mm:ss". */
    public static String duration(long ms) {
        long s = Math.max(0, ms) / 1000;
        return s >= 3600 ? String.format(Locale.US, "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String.format(Locale.US, "%d:%02d", s / 60, s % 60);
    }

    /** Peak of a PCM16 buffer as 0…1. */
    public static float peak(short[] pcm, int n) {
        int p = 0;
        for (int i = 0; i < n; i++) { int v = pcm[i]; if (v < 0) v = -v; if (v > p) p = v; }
        return Math.min(1f, p / 32767f);
    }
}
