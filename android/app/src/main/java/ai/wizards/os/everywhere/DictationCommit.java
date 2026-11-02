package ai.wizards.os.everywhere;

/** Selection-bound evidence, shared by the native node and input-connection channels. No writes here. */
final class DictationCommit {
    enum Result { UNAVAILABLE, VERIFIED, UNVERIFIED }

    static final class Snapshot {
        final String text;
        final int start, end, offset;
        final boolean endKnown;
        Snapshot(String text, int start, int end, int offset) { this(text,start,end,offset,true); }
        Snapshot(String text, int start, int end, int offset, boolean endKnown) {
            this.endKnown = endKnown;
            this.text = text; this.start = Math.min(start, end); this.end = Math.max(start, end);
            this.offset = offset;
        }
        boolean valid() {
            return text != null && start >= 0 && end <= text.length() && offset >= 0;
        }
        boolean same(Snapshot other) {
            return valid() && other != null && other.valid() && offset == other.offset
                    && start == other.start && end == other.end && text.equals(other.text);
        }
    }

    private DictationCommit() { }

    /** Whole focused editable node only; a displayed hint is not document text.
     * TextView omits selection for empty documents. A consistent displayed hint proves emptiness,
     * whose only caret is 0. Do not generalize to non-hint nodes or IC window snapshots. */
    static Snapshot nodeSnapshot(String text, String hint, boolean showingHint, int start, int end) {
        if (showingHint && text != null && !text.isEmpty() && !text.equals(hint))
            return new Snapshot(null, start, end, 0); // Contradictory node content is not empty evidence.
        if (showingHint && start == -1 && end == -1) start = end = 0;
        return new Snapshot(showingHint ? "" : text, start, end, 0);
    }

    /** Exact replacement, not containment, case-folding, trimming, or an arbitrary new phrase. */
    static boolean verifies(Snapshot before, Snapshot after, String payload) {
        if (payload == null || before == null || after == null || !before.valid() || !after.valid()
                || before.offset != 0 || after.offset != 0) return false;
        String expected = before.text.substring(0, before.start) + payload + before.text.substring(before.end);
        return expected.equals(after.text) && verifiesWindow(before, after, payload);
    }

    static boolean verifiesWindow(Snapshot before, Snapshot after, String payload) {
        if (before == null || after == null || !before.valid() || !after.valid()
                || payload == null || payload.trim().isEmpty()) return false;
        int a = before.offset + before.start;
        int b = before.offset + before.end;
        int cursor = a + payload.length();
        if (after.offset + after.start != cursor || after.start != after.end) return false;
        int at = a - after.offset;
        // Require the entire inserted payload, nearby anchors, and every overlapping context character.
        // Absolute offsets bind a moving IC window; unknown offsets are not a verifiable empty field.
        int delta = payload.length() - (b - a);
        if (before.endKnown && before.offset + before.text.length() + delta != after.offset + after.text.length()) return false;
        if (at < 0 || at + payload.length() > after.text.length()
                || !after.text.regionMatches(at, payload, 0, payload.length())) return false;
        int left = Math.min(16, before.start);
        int right = Math.min(16, before.text.length() - before.end);
        if (at < left || at + payload.length() + right > after.text.length()) return false;
        int prefixStart = Math.max(before.offset, after.offset);
        for (int p = prefixStart; p < a; p++)
            if (before.text.charAt(p - before.offset) != after.text.charAt(p - after.offset)) return false;
        int suffixEnd = Math.min(before.offset + before.text.length(),
                after.offset + after.text.length() - delta);
        for (int p = b; p < suffixEnd; p++)
            if (before.text.charAt(p - before.offset) != after.text.charAt(p + delta - after.offset)) return false;
        return true;
    }
}
