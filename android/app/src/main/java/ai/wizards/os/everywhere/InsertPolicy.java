package ai.wizards.os.everywhere;

import android.view.accessibility.AccessibilityNodeInfo;

/** When dictated words count as typed and when the clipboard paste fallback may run (pure, unit-tested). */
final class InsertPolicy {
    private InsertPolicy() {}

    enum Outcome { TYPED, TRY_CLIPBOARD }

    /** Verification of native editors: short steps, early exit, hard cap. */
    static final int VERIFY_STEP_MS = 25;
    static final int VERIFY_CAP_MS = 300;

    /**
     * ic.commitText returns nothing, so after it the field itself is the only evidence. Web editors (Notes) and
     * unknown nodes publish text to accessibility late: trust the commit at once. Reliable native editors are
     * checked: text changed means typed; text that cannot be read back is trusted; text verifiably unchanged at the
     * cap means a stale or rejected InputConnection, so the words go to the clipboard strategy.
     * No InputConnection, or a commit that threw, leaves the words untyped.
     */
    static Outcome afterCommit(boolean icAvailable, boolean commitIssued, boolean webEditor,
                               boolean verifiable, boolean textChanged) {
        if (!icAvailable || !commitIssued) return Outcome.TRY_CLIPBOARD;
        if (webEditor || !verifiable || textChanged) return Outcome.TYPED;
        return Outcome.TRY_CLIPBOARD;
    }

    /** The clipboard paste is only for words that were not typed. */
    static boolean clipboardAllowed(boolean icAvailable, boolean commitIssued, boolean webEditor,
                                    boolean verifiable, boolean textChanged) {
        return afterCommit(icAvailable, commitIssued, webEditor, verifiable, textChanged) == Outcome.TRY_CLIPBOARD;
    }

    /** WebView / contenteditable nodes publish text to accessibility late, so reading it back proves nothing. */
    static boolean isWebEditorClass(CharSequence className) {
        return className != null && className.toString().startsWith("android.webkit.WebView");
    }

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
