package ai.wizards.os.everywhere;

import android.view.accessibility.AccessibilityNodeInfo;

/** When dictated words count as typed and when the clipboard paste fallback may run (pure, unit-tested). */
final class InsertPolicy {
    private InsertPolicy() {}

    enum Outcome { TYPED, TRY_CLIPBOARD }

    /** Logging-only verification: short steps, early exit, hard cap. */
    static final int VERIFY_STEP_MS = 25;
    static final int VERIFY_CAP_MS = 300;

    /**
     * ic.commitText returns nothing, so "issued without exception" is the whole signal. Once issued the words are
     * typed: a re-read of the field cannot overrule it (web editors expose text to accessibility late).
     * No InputConnection, or a commit that threw, leaves the words untyped.
     */
    static Outcome afterCommit(boolean icAvailable, boolean commitIssued) {
        return icAvailable && commitIssued ? Outcome.TYPED : Outcome.TRY_CLIPBOARD;
    }

    /** The clipboard paste is only for words that were not typed. */
    static boolean clipboardAllowed(boolean icAvailable, boolean commitIssued) {
        return afterCommit(icAvailable, commitIssued) == Outcome.TRY_CLIPBOARD;
    }

    /** WebView / contenteditable nodes publish text to accessibility late, so reading it back proves nothing. */
    static boolean isWebEditorClass(CharSequence className) {
        return className != null && className.toString().startsWith("android.webkit.WebView");
    }

    /** Verification (logging only) is worth running only outside web editors. */
    static boolean shouldVerify(boolean webEditor) { return !webEditor; }

    /** Walks up a few parents looking for a WebView; cheap (no tree search). */
    static boolean isWebEditor(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo n = node;
        for (int i = 0; n != null && i < 24; i++) {
            if (isWebEditorClass(n.getClassName())) return true;
            n = n.getParent();
        }
        return false;
    }
}
