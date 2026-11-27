package ai.wizards.os.audio;

/**
 * Calls come first on the phone's media player (wizard-ux issue 1976).
 *
 * When a call rings or is answered (a phone call, or a VoIP call such as WhatsApp), Music or Podcasts stops at once and
 * lets go of the audio output and focus, so the call gets the Bluetooth earphones to itself. Nothing in Wizard plays
 * during the call. When the call ends it resumes from where it stopped, on the same device, unless the person paused,
 * stopped or loaded something else meanwhile. A pause Android made for a call (audio focus taken, or "becoming noisy"
 * while the earphones switch to the call profile) is not the person's pause.
 *
 * Pure Java (no Android types) so every decision is unit-tested; {@link BackgroundAudioService} feeds it the
 * {@code AudioManager} mode and the player's own pauses. Mode values are {@code AudioManager.MODE_*}; reasons are
 * Media3's {@code Player.PLAY_WHEN_READY_CHANGE_REASON_*}.
 */
public final class CallHold {
    public static final int MODE_NORMAL = 0, MODE_RINGTONE = 1, MODE_IN_CALL = 2, MODE_IN_COMMUNICATION = 3,
            MODE_CALL_SCREENING = 4, MODE_CALL_REDIRECT = 5, MODE_COMMUNICATION_REDIRECT = 6;
    /** Media3 Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS / _AUDIO_BECOMING_NOISY. */
    public static final int REASON_FOCUS_LOSS = 2, REASON_NOISY = 3;
    /** A focus or noisy pause this long before a call starts was its ringing (a ring lasts up to about a minute). */
    public static final long RING_WINDOW_MS = 60_000;
    /** A focus or noisy pause this soon after a call ended is the earphones switching back, not the person. */
    public static final long SETTLE_MS = 3_000;
    /** After the call, wait this long so Bluetooth is back on the media profile before playing again. */
    public static final long RESUME_DELAY_MS = 1_500;
    public static final int NONE = 0, START = 1, END = 2;

    /** A phone call (ringing, in call, screening): only the system sets these, never Wizard. */
    public static boolean telephony(int mode) {
        return mode == MODE_RINGTONE || mode == MODE_IN_CALL || mode == MODE_CALL_SCREENING || mode == MODE_CALL_REDIRECT;
    }
    /** A voice-chat mode (WhatsApp and other VoIP calls). Wizard's own web mic can set it too, but takes no audio focus. */
    public static boolean voip(int mode) { return mode == MODE_IN_COMMUNICATION || mode == MODE_COMMUNICATION_REDIRECT; }
    /** Whether a call is on: a phone call, or a voice-chat mode while another app holds the audio focus. */
    public static boolean call(int mode, boolean focusTaken) { return telephony(mode) || voip(mode) && focusTaken; }

    /**
     * The pause decision for a pause the player made by itself. True keeps the person's intention to play (the call
     * caused it); false is a real pause (an unplug or another app taking the audio outside any call).
     */
    public static boolean callCaused(int reason, int mode, long now, long callEndedAt) {
        if (reason != REASON_FOCUS_LOSS && reason != REASON_NOISY) return false;
        if (telephony(mode) || voip(mode)) return true;
        return callEndedAt > 0 && now >= callEndedAt && now - callEndedAt <= SETTLE_MS;
    }
    /** At a call's start: the real-looking pause just before it was the call ringing, so the intention comes back. */
    public static boolean ringPause(long pausedAt, long callStartAt) {
        return pausedAt > 0 && callStartAt >= pausedAt && callStartAt - pausedAt <= RING_WINDOW_MS;
    }
    /** After the call: resume only if the person still wants it and it is the same queue and item as before. */
    public static boolean resume(boolean held, boolean want, int heldGeneration, int generation, String heldItem, String item) {
        return held && want && heldGeneration == generation && heldItem != null && heldItem.equals(item);
    }

    private int mode = MODE_NORMAL;
    private boolean inCall, held;
    private int heldGeneration;
    private String heldItem;
    private long pausedAt, callEndedAt;
    private int pausedGeneration;
    private String pausedItem;

    public boolean inCall() { return inCall; }
    public boolean holding() { return held; }
    public int mode() { return mode; }

    /**
     * The audio mode changed (or the player lost focus while in a voice-chat mode). Returns {@link #START} when a call
     * began, {@link #END} when it ended, else {@link #NONE}. {@code focusTaken}: another app took the audio focus.
     */
    public int mode(int next, boolean focusTaken, long now) {
        mode = next;
        boolean recentPause = pausedAt > 0 && now - pausedAt <= RING_WINDOW_MS;
        if (!inCall && call(next, focusTaken || recentPause)) { inCall = true; return START; }
        if (inCall && !telephony(next) && !voip(next)) { inCall = false; callEndedAt = now; return END; }
        return NONE;
    }

    /**
     * The player paused itself for lost audio focus and it was not (yet) a call: remember it, in case a call starts
     * right after (the ringing took the focus). An unplug is never remembered: ringing does not unplug anything.
     */
    public void realPause(int reason, long now, int generation, String item) {
        if (reason != REASON_FOCUS_LOSS) { pausedAt = 0; return; }
        pausedAt = now; pausedGeneration = generation; pausedItem = item; }
    /** At a call's start: whether the pause just before it was the ringing (same item, nothing touched since). */
    public boolean ringTookIt(long now, int generation, String item) {
        boolean took = ringPause(pausedAt, now) && pausedGeneration == generation && pausedItem != null && pausedItem.equals(item);
        pausedAt = 0;
        return took;
    }
    /** The person did something (play, pause, load, stop, skip): an earlier system pause is no longer the ring's. */
    public void personActed() { pausedAt = 0; }

    /** Playback stopped for the call; remember what was playing. */
    public void hold(int generation, String item) { held = true; heldGeneration = generation; heldItem = item; }
    /** The call is over: true to play again. Clears the hold either way. */
    public boolean release(boolean want, int generation, String item) {
        boolean go = resume(held, want, heldGeneration, generation, heldItem, item);
        held = false; heldItem = null;
        return go;
    }
    public long callEndedAt() { return callEndedAt; }
}
