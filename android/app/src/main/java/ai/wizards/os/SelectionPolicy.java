package ai.wizards.os;

/** Pure rules for SelectionWebView (unit-tested on the JVM). */
public final class SelectionPolicy {
    private SelectionPolicy() { }

    /** A press on page text counts as ours for this long: Android starts the selection toolbar ~0.5 s into a hold. */
    public static final long DOWN_FRESH_MS = 2500;

    /** Whether a selection toolbar starting now belongs to the page's own menu. A text field always keeps Android's (Paste). */
    public static boolean ours(boolean selOurs, boolean downEditable, long sinceDownMs) {
        if (downEditable && sinceDownMs >= 0 && sinceDownMs < DOWN_FRESH_MS) return false;
        if (selOurs) return true;
        return !downEditable && sinceDownMs >= 0 && sinceDownMs < DOWN_FRESH_MS;
    }

    /** Text handed to Android's share sheet: never empty, capped well under Binder's transaction limit. */
    public static String shareText(String text) {
        String t = text == null ? "" : text;
        return t.length() > 90_000 ? t.substring(0, 90_000) + "\n…" : t;
    }

    /** A safe file name for a shared file: no path, no leading dot, at most 120 chars, with a fallback. */
    public static String fileName(String name) {
        String n = name == null ? "" : name.replaceAll("[/\\\\\\p{Cntrl}]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.isEmpty()) n = "wizard-file";
        if (n.length() > 120) { int dot = n.lastIndexOf('.'); String ext = dot > 0 && n.length() - dot <= 10 ? n.substring(dot) : ""; n = n.substring(0, 120 - ext.length()) + ext; }
        return n;
    }
}
