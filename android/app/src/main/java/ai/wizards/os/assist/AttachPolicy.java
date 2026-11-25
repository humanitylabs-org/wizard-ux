package ai.wizards.os.assist;

import java.util.Locale;

/**
 * Camera and Attach on the side-button corner orb (wizard-os issue 655, on for everyone).
 * Plain Java (no Android types) so the rules run as JVM tests: how many things one take may carry, how big one file
 * may be, and how a picked file's name and type are cleaned before they go to Wizard Files.
 */
public final class AttachPolicy {
    /** One cap shared by Screen, Camera and Attach. */
    static final int MAX = 8;
    /** One picked file or photo; anything bigger is left out (the voice note itself is never refused). */
    static final long MAX_BYTES = 25L * 1024 * 1024;
    /** A picker or the camera that never comes back: the take goes on (or is sent) after this. */
    static final long AWAY_MS = 3 * 60 * 1000;

    static final String KIND_PHOTO = "photo", KIND_FILE = "file";

    private AttachPolicy() { }

    /** How many more things this take may carry. */
    static int room(int attached) { return Math.max(0, MAX - Math.max(0, attached)); }

    static boolean fits(long bytes) { return bytes > 0 && bytes <= MAX_BYTES; }

    /** A plain file name: no folders, no control characters, no leading dot, at most 120 characters. */
    static String safeName(String raw, String fallback) {
        String n = raw == null ? "" : raw;
        int slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (slash >= 0) n = n.substring(slash + 1);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n.length(); i++) {
            char ch = n.charAt(i);
            if (ch < 0x20 || ch == 0x7f || ch == '"' || ch == ':' || ch == '*' || ch == '?' || ch == '<' || ch == '>' || ch == '|') continue;
            b.append(ch);
        }
        n = b.toString().trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.length() > 120) {
            int dot = n.lastIndexOf('.');
            String ext = dot > 0 && n.length() - dot <= 10 ? n.substring(dot) : "";
            n = n.substring(0, 120 - ext.length()) + ext;
        }
        return n.isEmpty() ? fallback : n;
    }

    /** The type Android reported when it looks like one, else a guess from the name, else octet-stream. */
    static String mime(String reported, String name) {
        if (reported != null) {
            String r = reported.trim().toLowerCase(Locale.ROOT);
            if (r.matches("[a-z0-9][a-z0-9.+-]{0,40}/[a-z0-9][a-z0-9.+-]{0,80}") && !"application/octet-stream".equals(r)) return r;
        }
        String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
        int dot = n.lastIndexOf('.');
        switch (dot < 0 ? "" : n.substring(dot + 1)) {
            case "jpg": case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "heic": return "image/heic";
            case "pdf": return "application/pdf";
            case "txt": return "text/plain";
            case "mp4": return "video/mp4";
            default: return "application/octet-stream";
        }
    }

    /** The sentence Wizard reads about what rode along with the voice note ("" when nothing did). */
    public static String describe(int shots, int pictures, int files) {
        StringBuilder b = new StringBuilder();
        if (shots > 0) b.append(" They attached ").append(shots).append(shots == 1 ? " screenshot" : " screenshots")
                .append(" of what was on their screen while talking.");
        if (pictures > 0) b.append(" They took ").append(pictures).append(pictures == 1 ? " picture" : " pictures")
                .append(" with the phone's camera while talking.");
        if (files > 0) b.append(" They attached ").append(files).append(files == 1 ? " file" : " files")
                .append(" from the phone while talking.");
        return b.toString();
    }

    /** What the orb shows after a Camera or Attach round: JSON for W.onAttach (no names, counts only). */
    static String counts(int shots, int pictures, int files, int added, int skipped, int tooBig) {
        return "{\"shots\":" + shots + ",\"pictures\":" + pictures + ",\"files\":" + files + ",\"added\":" + added
                + ",\"skipped\":" + skipped + ",\"tooBig\":" + tooBig + ",\"max\":" + MAX + "}";
    }
}
