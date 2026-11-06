package ai.wizards.os.everywhere;

/**
 * When is the orb a dictation mic? Pure logic (unit-tested), from Archimedes Anywhere's KeyboardModeTracker:
 *  - a visible keyboard window, or a text field focused in the last moment, means keyboard mode;
 *  - one missing sample (Android reshuffling windows) does not flip it back: two in a row do;
 *  - with no keyboard evidence ever seen, it stays the normal orb.
 */
final class KeyboardSignal {
    static final int REQUIRED_MISSING = 2;
    /** A focus/click on a text field counts for this long while the keyboard slides up. */
    static final long EDITOR_GRACE_MS = 1500;

    private long editorAt = -1;
    private int missing;
    private boolean seen;

    void editorEvidence(long now) { editorAt = now; }

    boolean recentEditor(long now) { return editorAt >= 0 && now - editorAt <= EDITOR_GRACE_MS; }

    boolean keyboardMode(boolean imeVisible, long now) {
        if (imeVisible || recentEditor(now)) { seen = true; missing = 0; return true; }
        if (!seen) return false;
        if (++missing >= REQUIRED_MISSING) { seen = false; missing = 0; return false; }
        return true;
    }

    /** At tap time: the live state wins over a stale icon (so a tap over an open keyboard never messages Wizard). */
    static boolean dictate(boolean inputActiveNow, boolean orbShowsKeyboard) {
        return inputActiveNow || orbShowsKeyboard;
    }
}
