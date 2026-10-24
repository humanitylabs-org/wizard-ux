package ai.wizards.shell.recorder;

/** The exact device.recording v1 method names (pure, shared by the adapter and its JVM test). */
public final class RecordingMethods {
    public static final String[] ALL = {"status", "level", "start", "pause", "stop", "cancel", "pending", "read", "ack"};

    private RecordingMethods() { }
}
