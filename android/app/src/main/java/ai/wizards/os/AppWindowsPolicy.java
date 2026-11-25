package ai.wizards.os;

/**
 * App windows (wizard-os issue 650): the plain rules, no Android types, so they run as JVM
 * tests. {@link AppWindows} applies them.
 */
public final class AppWindowsPolicy {
    /** A window opens only right after a real tap in this window... */
    static final long TAP_MS = 2500;
    /** ...or once, shortly after this app was opened with a link to an app (a notification's link). */
    static final long LINK_INTENT_MS = 20000;
    /** One tap opens one window (a double-delivered click must not stack two launches). */
    static final long REPEAT_MS = 800;

    private AppWindowsPolicy() { }

    /**
     * The page a window opens at: a path on this Wizard ("/app/page?x#y"), or "" for the app's own start (its saved
     * place). Null when it is anything else: another host, a scheme, Wizard's own shell, an encoded or backslash
     * separator, a dot segment, whitespace or control characters. The window's page checks again that it lies inside
     * the app.
     */
    public static String path(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        if (raw.length() > 2048 || !raw.startsWith("/") || raw.startsWith("//")) return null;
        for (int i = 0; i < raw.length(); i++) {
            char ch = raw.charAt(i);
            if (ch <= ' ' || ch == 0x7f || ch == '\\') return null;
        }
        int cut = raw.length();
        for (char stop : new char[] { '?', '#' }) { int at = raw.indexOf(stop); if (at >= 0 && at < cut) cut = at; }
        String p = raw.substring(0, cut), lower = p.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains("%2f") || lower.contains("%5c") || lower.contains("%2e") || lower.contains("%25")) return null;
        for (String seg : p.split("/", -1)) if (seg.equals(".") || seg.equals("..")) return null;
        // Wizard's own pages (home, chats) stay in the main window.
        if (p.matches("/wizard-os-home([/-].*)?")) return null;
        return raw;
    }

    /** May a window open now? Within TAP_MS of a tap, or within LINK_INTENT_MS of a link intent (used once by the caller). */
    static boolean admitted(long now, long tapUpAt, long linkIntentAt, long lastOpenAt) {
        if (lastOpenAt > 0 && now >= lastOpenAt && now - lastOpenAt < REPEAT_MS) return false;
        boolean tap = tapUpAt > 0 && now >= tapUpAt && now - tapUpAt <= TAP_MS;
        boolean link = linkIntentAt > 0 && now >= linkIntentAt && now - linkIntentAt <= LINK_INTENT_MS;
        return tap || link;
    }

    /** A window's name in Recents when it has no home-screen icon: plain text, at most 80 characters. */
    static String name(String raw) {
        if (raw == null) return "";
        String s = raw.replaceAll("[\\p{Cntrl}]", " ").trim();
        return s.length() > 80 ? s.substring(0, 80) : s;
    }
}
