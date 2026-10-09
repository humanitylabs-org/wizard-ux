package ai.wizards.os.notify;

/** Pure rules for reply notifications (unit-tested off-device). */
public final class ReplyPolicy {
    private ReplyPolicy() {}

    public static boolean settled(String status) {
        return "completed".equals(status) || "failed".equals(status) || "cancelled".equals(status)
                || "stopped".equals(status) || "interrupted".equals(status);
    }

    public static String ended(String status) {
        return "failed".equals(status) || "interrupted".equals(status) ? "That request stopped with an error" : "That request was stopped";
    }

    /** The start of a reply, without Markdown noise, at most 280 characters. */
    public static String excerpt(String s) {
        if (s == null) return "";
        String t = s.replaceAll("(?s)```.*?```", " [code] ")
                .replaceAll("\\[([^\\]]+)]\\([^)]*\\)", "$1")
                .replaceAll("(?m)^\\s{0,3}(#{1,6}|>|[-*+]|\\d+\\.)\\s+", "")
                .replaceAll("[*_`~]+", "")
                .replaceAll("\\s+", " ").trim();
        if (t.length() <= 280) return t;
        int cut = t.lastIndexOf(' ', 279);
        return t.substring(0, cut > 200 ? cut : 279) + "…";
    }
}
