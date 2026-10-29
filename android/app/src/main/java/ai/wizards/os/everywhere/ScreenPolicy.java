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
        /** Its words in order (0.9.21), or null. {@code exact}: every word carries where Android drew it. */
        public final List<Word> words;
        public final boolean exact;

        public Block(String text, int x, int y, int w, int h, boolean label) { this(text, x, y, w, h, label, null, false); }

        public Block(String text, int x, int y, int w, int h, boolean label, List<Word> words, boolean exact) {
            this.text = text; this.x = x; this.y = y; this.w = w; this.h = h; this.label = label;
            this.words = words; this.exact = exact;
        }

        int area() { return Math.max(0, w) * Math.max(0, h); }
    }

    /**
     * One selectable word (Google-style free selection, 0.9.21): its text, what follows it before the next word
     * ("", " " or "\n") and, when the app reports character positions, its box on screen (else w = h = 0).
     */
    public static final class Word {
        public String t;
        public String sp = "";
        public int x, y, w, h;

        Word(String t) { this.t = t; }

        boolean placed() { return w > 0 && h > 0; }
    }

    /**
     * Split text into words the way a text selection snaps: whitespace separates, punctuation sticks to its word,
     * and scripts without spaces (Thai, Japanese, Chinese) split at dictionary word breaks. {@code rects[i]} is
     * character i's {left, top, right, bottom} on screen (null when unknown or not drawn); with rects, a word's box
     * is its characters on the line of its first drawn character, and words with no drawn character are dropped
     * (scrolled out of view). Without rects every word is kept, unplaced.
     */
    public static List<Word> words(String text, float[][] rects) {
        List<Word> out = new ArrayList<>();
        if (text == null || text.isEmpty()) return out;
        java.text.BreakIterator it = java.text.BreakIterator.getWordInstance();
        it.setText(text);
        List<int[]> spans = new ArrayList<>();
        int s = it.first();
        for (int e = it.next(); e != java.text.BreakIterator.DONE; s = e, e = it.next()) {
            String seg = text.substring(s, e);
            if (seg.trim().isEmpty()) {
                if (!out.isEmpty()) {
                    Word last = out.get(out.size() - 1);
                    last.sp = seg.indexOf('\n') >= 0 || "\n".equals(last.sp) ? "\n" : " ";
                }
                continue;
            }
            if (!out.isEmpty()) {
                Word last = out.get(out.size() - 1);
                boolean lastPunct = !hasWordChar(last.t);
                int endCp = last.t.codePointBefore(last.t.length());
                int ty = Character.getType(endCp);
                boolean lastEndsPunct = !Character.isLetterOrDigit(endCp) && ty != Character.NON_SPACING_MARK
                        && ty != Character.COMBINING_SPACING_MARK && ty != Character.ENCLOSING_MARK; // Thai tone marks are letters here
                // "Hello," / "(hello" / "4,471.00" / "don't" / "well-known": punctuation joins the word it touches.
                if (last.sp.isEmpty() && (!hasWordChar(seg) || lastPunct || lastEndsPunct)) {
                    last.t += seg;
                    spans.get(spans.size() - 1)[1] = e;
                    continue;
                }
            }
            out.add(new Word(seg));
            spans.add(new int[]{s, e});
        }
        if (rects == null) return out;
        List<Word> placed = new ArrayList<>();
        for (int k = 0; k < out.size(); k++) {
            Word wd = out.get(k);
            int[] sp = spans.get(k);
            float l = Float.MAX_VALUE, t = Float.MAX_VALUE, r = -Float.MAX_VALUE, b = -Float.MAX_VALUE;
            float lineTop = 0, lineBot = 0;
            boolean any = false;
            for (int i = sp[0]; i < sp[1] && i < rects.length; i++) {
                float[] c = rects[i];
                if (c == null || c[2] - c[0] <= 0 && c[3] - c[1] <= 0) continue;
                float mid = (c[1] + c[3]) / 2;
                if (!any) { lineTop = c[1]; lineBot = c[3]; }
                else if (mid < lineTop || mid > lineBot) continue; // wrapped onto the next line: keep the first
                any = true;
                l = Math.min(l, c[0]); t = Math.min(t, c[1]); r = Math.max(r, c[2]); b = Math.max(b, c[3]);
            }
            if (!any) {
                // A word that isn't drawn: its separator moves to the word before so the text still reads right.
                if (!placed.isEmpty() && wd.sp.length() > placed.get(placed.size() - 1).sp.length())
                    placed.get(placed.size() - 1).sp = wd.sp;
                continue;
            }
            wd.x = Math.round(l); wd.y = Math.round(t);
            wd.w = Math.max(1, Math.round(r - l)); wd.h = Math.max(1, Math.round(b - t));
            placed.add(wd);
        }
        return placed;
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
            List<Word> ws = b.words;
            if (ws != null && b.exact) { // words scrolled or clipped off the screen can't be picked
                ws = new ArrayList<>();
                for (Word wd : b.words)
                    if (wd.x + wd.w > 0 && wd.y + wd.h > 0 && wd.x < screenW && wd.y < screenH) ws.add(wd);
                if (ws.isEmpty()) continue;
            }
            Block c = new Block(t, x1, y1, x2 - x1, y2 - y1, b.label, ws, b.exact);
            boolean dup = false;
            for (int i = 0; i < out.size(); i++) {
                Block o = out.get(i);
                if (overlap(o, c) < 0.6f) continue;
                if (o.text.equals(c.text)) {
                    // keep the one that knows where its words are, then the tighter box
                    boolean better = c.exact != o.exact ? c.exact : c.area() < o.area();
                    if (better) out.set(i, c);
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
            for (Block b : blocks) {
                JSONObject o = new JSONObject().put("t", b.text).put("x", b.x).put("y", b.y).put("w", b.w).put("h", b.h).put("l", b.label);
                if (b.words != null && !b.words.isEmpty()) {
                    JSONArray ws = new JSONArray();
                    for (Word wd : b.words) {
                        JSONArray w = new JSONArray().put(wd.t).put(wd.sp);
                        if (b.exact && wd.placed()) w.put(wd.x).put(wd.y).put(wd.w).put(wd.h);
                        ws.put(w);
                    }
                    o.put("wd", ws).put("ex", b.exact);
                }
                a.put(o);
            }
        } catch (JSONException ignored) { }
        return a;
    }

    /** Selected text going to Wizard rides in the instructions, clipped so a whole web page can't flood the run. */
    public static String clipContext(String s, int max) {
        String t = norm(s);
        return t.length() <= max ? t : t.substring(0, Math.max(0, max - 1)).trim() + "…";
    }
}
