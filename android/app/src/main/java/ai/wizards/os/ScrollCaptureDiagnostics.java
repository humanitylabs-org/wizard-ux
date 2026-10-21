package ai.wizards.os;

/** No content, URLs or persistent state. Every rejection is also visible in adb logcat. */
final class ScrollCaptureDiagnostics {
    private static final int CAPACITY = 48;
    private static final java.util.ArrayDeque<String> events = new java.util.ArrayDeque<>();
    static synchronized void empty(String reason) {
        String line = "search empty: " + reason;
        if (events.size() == CAPACITY) events.removeFirst();
        events.addLast(line);
        android.util.Log.i("WizardScrollCapture", line);
    }
    static synchronized String[] snapshot() { return events.toArray(new String[0]); }
    private ScrollCaptureDiagnostics() { }
}
