package ai.wizards.os.everywhere;

/** Fits dictated words into text that is already there: spacing and sentence capitals. Pure, unit-tested. */
final class DictationText {
    private DictationText() { }

    /** The piece to insert between {@code before} and {@code after} for the spoken {@code words}. */
    static String fit(String before, String after, String words) {
        String w = words == null ? "" : words.trim().replaceAll("\\s+", " ");
        if (w.isEmpty()) return "";
        before = before == null ? "" : before;
        after = after == null ? "" : after;
        boolean capital = sentenceStart(before);
        int first = firstLetter(w);
        if (first >= 0 && !isAcronymOrName(w, first)) {
            char c = w.charAt(first);
            char want = capital ? Character.toUpperCase(c) : Character.toLowerCase(c);
            w = w.substring(0, first) + want + w.substring(first + 1);
        }
        // Mid-sentence, a lone trailing full stop from the transcriber reads wrong when more text follows.
        if (!after.trim().isEmpty() && w.endsWith(".") && !w.endsWith("..")) w = w.substring(0, w.length() - 1);
        String lead = before.isEmpty() || Character.isWhitespace(before.charAt(before.length() - 1)) ? "" : " ";
        String trail = !after.isEmpty() && !Character.isWhitespace(after.charAt(0)) && !isPunct(after.charAt(0)) ? " " : "";
        return lead + w + trail;
    }

    static boolean sentenceStart(String before) {
        int i = before.length() - 1;
        while (i >= 0 && before.charAt(i) == ' ') i--;
        if (i < 0) return true;
        char c = before.charAt(i);
        return c == '.' || c == '!' || c == '?' || c == '\n' || c == '\r' || c == '•' || c == '*' || c == '-';
    }

    private static int firstLetter(String s) {
        for (int i = 0; i < s.length(); i++) if (Character.isLetter(s.charAt(i))) return i;
        return -1;
    }

    /** "I", "OK", "Wizard": leave words that are capitalised for their own reasons. */
    private static boolean isAcronymOrName(String s, int i) {
        int j = i;
        while (j < s.length() && Character.isLetter(s.charAt(j))) j++;
        String word = s.substring(i, j);
        if (word.equals("I") || word.startsWith("I'") || word.startsWith("I’")) return true;
        if (word.length() > 1 && word.equals(word.toUpperCase())) return true;
        return false;
    }

    private static boolean isPunct(char c) { return ".,!?;:)]}".indexOf(c) >= 0; }
}
