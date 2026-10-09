package ai.wizards.os.assist;

/**
 * Decides when a hands-free utterance is finished, from MediaRecorder max-amplitude samples.
 *
 * The side button cannot tell an app when it is released (Android consumes KEYCODE_POWER before
 * any app sees it), so "let go to send" is replaced by: tap the orb, hold the button again, or
 * pause. This class is the "pause" part. Pure Java so it can be unit-tested off-device.
 *
 * Two thresholds (0.6.3, James: "it ends the recording too aggressively"):
 *  - {@link #speechThreshold()} decides that real speech has started, so a cough or a bump never
 *    counts as "you said something".
 *  - {@link #voiceThreshold()} is lower and decides that you are still talking. Trailing words are
 *    often soft ("…pretty nice"); before 0.6.3 they counted as silence, nudged the noise floor up,
 *    and the pause timer ran out while the last word was still being spoken.
 */
public final class SilenceDetector {
    public enum Result { CONTINUE, SEND, NOTHING_HEARD }

    /** How long you can stop talking before the side button sends by itself. 2400 ms before 0.6.3. */
    public static final long SIDE_PAUSE_MS = 3600;

    private final long silenceMs;
    private final long noSpeechMs;
    private final long maxMs;
    private long startedAt = -1;
    private long speechMs = 0;
    private long lastAt = -1;
    private long quietSince = -1;
    private double floor = 600;

    SilenceDetector(long silenceMs, long noSpeechMs, long maxMs) {
        this.silenceMs = silenceMs;
        this.noSpeechMs = noSpeechMs;
        this.maxMs = maxMs;
    }

    public static SilenceDetector standard() {
        return new SilenceDetector(SIDE_PAUSE_MS, 9000, 180_000);
    }

    /** Typing with your voice: people pause mid-sentence while writing, so wait longer before finishing. */
    public static SilenceDetector dictation() {
        return new SilenceDetector(3800, 12000, 300_000);
    }

    /** Amplitude threshold that counts as the start of speech, given the tracked noise floor. */
    int speechThreshold() {
        return (int) Math.max(1800, floor * 3.0);
    }

    /** Lower threshold that counts as "still talking" once speech has started (soft trailing words). */
    int voiceThreshold() {
        return (int) Math.max(700, floor * 1.8);
    }

    public boolean heardSpeech() {
        return speechMs >= 250;
    }

    private long pausedAt = -1;

    /** Pause: the clock stops, so a long pause never counts as "nothing heard" or "done talking". */
    public void pause(long now) { if (pausedAt < 0) pausedAt = now; }

    /** Resume after {@link #pause}: shift every timer by the pause and start the silence count fresh. */
    public void resume(long now) {
        if (pausedAt < 0) return;
        long gap = Math.max(0, now - pausedAt);
        pausedAt = -1;
        if (startedAt >= 0) startedAt += gap;
        lastAt = now;
        quietSince = -1;
    }

    public boolean paused() { return pausedAt >= 0; }

    /** amp: 0..32767 from MediaRecorder.getMaxAmplitude(); now: monotonic millis. */
    public Result feed(int amp, long now) {
        if (pausedAt >= 0) return Result.CONTINUE;
        if (startedAt < 0) {
            startedAt = now;
            lastAt = now;
        }
        long dt = Math.max(0, Math.min(500, now - lastAt));
        lastAt = now;
        boolean loud = amp >= speechThreshold();
        boolean voiced = loud || (heardSpeech() && amp >= voiceThreshold());
        if (loud) speechMs += dt;
        if (voiced) {
            quietSince = -1;
        } else {
            // Track the room's noise floor only from truly quiet samples so speech never raises it.
            floor = floor * 0.95 + Math.max(200, amp) * 0.05;
            if (quietSince < 0) quietSince = now;
        }
        long elapsed = now - startedAt;
        if (elapsed >= maxMs) return heardSpeech() ? Result.SEND : Result.NOTHING_HEARD;
        if (!heardSpeech()) return elapsed >= noSpeechMs ? Result.NOTHING_HEARD : Result.CONTINUE;
        if (quietSince >= 0 && now - quietSince >= silenceMs) return Result.SEND;
        return Result.CONTINUE;
    }
}
