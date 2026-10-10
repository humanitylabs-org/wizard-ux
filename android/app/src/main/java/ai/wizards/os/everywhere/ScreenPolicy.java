package ai.wizards.os.everywhere;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Screen mode (orb long-press): the text Android exposes for whatever is on screen, cleaned into selectable blocks.
 * Pure Java (no Android types) so the clean-up rules are unit-tested off-device.
 */
public final class ScreenPolicy {
    /** Most blocks one screen can hold before the rest is dropped (a huge list view or a web page). */
    static final int MAX_BLOCKS = 400;
    /** Below this many blocks with words in them, the screen is probably a picture: offer "Read picture text". */
    static final int FEW_BLOCKS = 3;

    private ScreenPolicy() {}

    /** One piece of on-screen text, in screen pixels. {@code label} = it came from a content description, not text. */
    public static final class Block {
        public final String text;
        public final int x, y, w, h;
        public final boolean label;

        public Block(String text, int x, int y, int w, int h, boolean label) {
            this.text = text; this.x = x; this.y = y; this.w = w; this.h = h; this.label = label;
        }

        int area() { return Math.max(0, w) * Math.max(0, h); }
    }

    static String norm(String s) {
        if (s == null) return "";
        return s.replace('\u00A0', ' ').replaceAll("[\\t\\x0B\\f\\r ]+", " ").replaceAll(" *\\n *", "\n").replaceAll("\\n{3,}", "\n\n").trim();
    }

    /** Overlap of a and b as a share of the smaller box. */
    static float overlap(Block a, Block b) {
        int x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
        int x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
        if (x2 <= x1 || y2 <= y1) return 0f;
        int small = Math.min(a.area(), b.area());
        return small <= 0 ? 0f : (float) ((x2 - x1) * (y2 - y1)) / small;
    }

    /**
     * Clip to the screen, drop empty / off-screen / tiny pieces, drop duplicates (the same words drawn twice: Compose
     * merges a child's text into its parent; a button's label repeats its text), then reading order.
     */
    public static List<Block> clean(List<Block> raw, int screenW, int screenH) {
        List<Block> out = new ArrayList<>();
        if (raw == null) return out;
        for (Block b : raw) {
            if (b == null) continue;
            String t = norm(b.text);
            if (t.isEmpty() || !hasWordChar(t)) continue;
            int x1 = Math.max(0, b.x), y1 = Math.max(0, b.y);
            int x2 = Math.min(screenW, b.x + b.w), y2 = Math.min(screenH, b.y + b.h);
            if (x2 - x1 < 4 || y2 - y1 < 4) continue;
            Block c = new Block(t, x1, y1, x2 - x1, y2 - y1, b.label);
            boolean dup = false;
            for (int i = 0; i < out.size(); i++) {
                Block o = out.get(i);
                if (overlap(o, c) < 0.6f) continue;
                if (o.text.equals(c.text)) {
                    if (c.area() < o.area()) out.set(i, c); // keep the tighter box
                    dup = true; break;
                }
                // A label that only repeats words already on screen inside it (a list row described by its texts).
                if (c.label && o.text.contains(c.text)) { dup = true; break; }
                if (o.label && c.text.contains(o.text)) { out.set(i, c); dup = true; break; }
            }
            if (!dup) out.add(c);
            if (out.size() >= MAX_BLOCKS) break;
        }
        sortReadingOrder(out);
        return out;
    }

    /** Top to bottom; pieces on the same line (their middles within half a line) left to right. */
    static void sortReadingOrder(List<Block> blocks) {
        Collections.sort(blocks, (a, b) -> {
            int ma = a.y + a.h / 2, mb = b.y + b.h / 2;
            int line = Math.max(8, Math.min(a.h, b.h) / 2);
            if (Math.abs(ma - mb) <= line) return Integer.compare(a.x, b.x);
            return Integer.compare(a.y, b.y);
        });
    }

    static boolean hasWordChar(String s) {
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            if (Character.isLetterOrDigit(cp)) return true;
            i += Character.charCount(cp);
        }
        return false;
    }

    /** Hardly any text came back (a photo, a video, a game, a canvas): the picture itself has to be read. */
    public static boolean wantsPictureText(List<Block> blocks) {
        int words = 0;
        for (Block b : blocks) if (b.text.length() >= 3 && !b.label) words++;
        return words < FEW_BLOCKS;
    }

    /** What the Screen page receives. */
    public static JSONArray toJson(List<Block> blocks) {
        JSONArray a = new JSONArray();
        try {
            for (Block b : blocks)
                a.put(new JSONObject().put("t", b.text).put("x", b.x).put("y", b.y).put("w", b.w).put("h", b.h).put("l", b.label));
        } catch (JSONException ignored) { }
        return a;
    }

    /** Selected text going to Wizard rides in the instructions, clipped so a whole web page can't flood the run. */
    public static String clipContext(String s, int max) {
        String t = norm(s);
        return t.length() <= max ? t : t.substring(0, Math.max(0, max - 1)).trim() + "…";
    }
}
