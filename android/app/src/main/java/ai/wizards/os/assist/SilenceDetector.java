package ai.wizards.os.assist;

/**
 * Decides when a hands-free utterance is finished, from MediaRecorder max-amplitude samples.
 *
 * The side button cannot tell an app when it is released (Android consumes KEYCODE_POWER before
 * any app sees it), so "let go to send" is replaced by: tap the orb, hold the button again, or
 * pause. This class is the "pause" part. Pure Java so it can be unit-tested off-device.
 */
final class SilenceDetector {
    enum Result { CONTINUE, SEND, NOTHING_HEARD }

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

    static SilenceDetector standard() {
        return new SilenceDetector(2400, 9000, 180_000);
    }

    /** Amplitude threshold that counts as speech, given the tracked noise floor. */
    int speechThreshold() {
        return (int) Math.max(1800, floor * 3.0);
    }

    boolean heardSpeech() {
        return speechMs >= 250;
    }

    /** amp: 0..32767 from MediaRecorder.getMaxAmplitude(); now: monotonic millis. */
    Result feed(int amp, long now) {
        if (startedAt < 0) {
            startedAt = now;
            lastAt = now;
        }
        long dt = Math.max(0, Math.min(500, now - lastAt));
        lastAt = now;
        boolean loud = amp >= speechThreshold();
        if (loud) {
            speechMs += dt;
            quietSince = -1;
        } else {
            // Track the room's noise floor only from quiet samples so speech never raises it.
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
