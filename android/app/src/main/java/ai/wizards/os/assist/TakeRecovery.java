package ai.wizards.os.assist;

/** Pure rules for takes left behind by a dead process and for naming audio by its container. Unit-tested off-device. */
public final class TakeRecovery {
    private TakeRecovery() { }

    /** ~0.25 s of 64 kbps AAC: anything shorter is the recorder's header and nothing said. */
    public static final long MIN_BYTES = 2048;

    public static boolean worthSending(long bytes) { return bytes >= MIN_BYTES; }

    /** ".aac" (ADTS, crash-proof side-button takes) or ".m4a" (MPEG-4: floating orb, older takes). */
    public static String ext(String path) {
        return path != null && path.toLowerCase(java.util.Locale.ROOT).endsWith(".aac") ? ".aac" : ".m4a";
    }

    public static String mime(String path) { return ".aac".equals(ext(path)) ? "audio/aac" : "audio/mp4"; }

    /** Boot / app-updated receiver: send any side-button take the previous process was cut off in the middle of. */
    public static void recoverAfterRestart(android.content.Context c) { VoiceCapture.recoverAfterRestart(c); }
}
