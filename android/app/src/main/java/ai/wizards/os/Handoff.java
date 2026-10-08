package ai.wizards.os;

/** Builds the JSON object passed to window.__wosHandoff. Pure Java so it is unit-testable off-device. */
final class Handoff {
    static final int MAX_TEXT = 2000;

    private Handoff() {}

    static String json(String action, String text) {
        if (MainActivity.ACTION_LISTEN.equals(action)) return "{\"action\":\"listen\"}";
        if (!MainActivity.ACTION_SAY.equals(action) || text == null) return null;
        String t = text.trim();
        if (t.isEmpty()) return null;
        if (t.length() > MAX_TEXT) t = t.substring(0, MAX_TEXT);
        return "{\"action\":\"say\",\"text\":" + quote(t) + "}";
    }

    /** JSON string literal; also escapes '<' and line/paragraph separators so it is inert inside JS source. */
    static String quote(String s) {
        StringBuilder b = new StringBuilder(s.length() + 8).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20 || c == '<' || c == '>' || c == '&' || c == 0x2028 || c == 0x2029 || c == '\'') b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
