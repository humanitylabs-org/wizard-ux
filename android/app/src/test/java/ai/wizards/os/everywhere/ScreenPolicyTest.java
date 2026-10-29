package ai.wizards.os.everywhere;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** 0.9.3: hold the floating orb → Select text / Translate screen / Hide orb. */
public class ScreenPolicyTest {
    private static ScreenPolicy.Block b(String t, int x, int y, int w, int h) { return new ScreenPolicy.Block(t, x, y, w, h, false); }
    private static ScreenPolicy.Block label(String t, int x, int y, int w, int h) { return new ScreenPolicy.Block(t, x, y, w, h, true); }

    @Test public void dropsEmptyPunctuationTinyAndOffScreen() {
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(
                b("", 0, 0, 100, 40), b("  ", 0, 50, 100, 40), b("•", 0, 100, 20, 20), b("—", 0, 130, 20, 20),
                b("tiny", 0, 160, 3, 3), b("off", 2000, 0, 100, 40), b("Hello", 10, 300, 100, 40)), 1080, 2400);
        assertEquals(1, out.size());
        assertEquals("Hello", out.get(0).text);
    }

    @Test public void clipsToTheScreen() {
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(b("Wide row", -50, 100, 2000, 60)), 1080, 2400);
        assertEquals(0, out.get(0).x);
        assertEquals(1080, out.get(0).w);
    }

    @Test public void sameWordsDrawnTwiceCountOnce() {
        // Compose merges a child's text into its parent; the tighter box wins.
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(
                b("Order now", 0, 100, 400, 120), b("Order now", 20, 120, 300, 60)), 1080, 2400);
        assertEquals(1, out.size());
        assertEquals(300, out.get(0).w);
    }

    @Test public void aRowLabelThatRepeatsItsTextsIsDropped() {
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(
                b("Pad kra pao", 20, 100, 400, 50), label("Pad kra pao", 0, 90, 1080, 80)), 1080, 2400);
        assertEquals(1, out.size());
        assertFalse(out.get(0).label);
        // …and in the other order the real text replaces the label
        out = ScreenPolicy.clean(Arrays.asList(label("Pad", 0, 90, 1080, 80), b("Pad kra pao", 20, 100, 400, 50)), 1080, 2400);
        assertEquals(1, out.size());
        assertEquals("Pad kra pao", out.get(0).text);
    }

    @Test public void keepsDifferentTextThatOverlaps() {
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(
                b("Price", 0, 100, 300, 60), b("฿120", 10, 105, 280, 50)), 1080, 2400);
        assertEquals(2, out.size());
    }

    @Test public void readingOrderTopToBottomThenLeftToRight() {
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(
                b("third", 0, 400, 200, 40), b("second", 500, 102, 200, 40), b("first", 0, 100, 200, 44)), 1080, 2400);
        assertEquals(Arrays.asList("first", "second", "third"), Arrays.asList(out.get(0).text, out.get(1).text, out.get(2).text));
    }

    @Test public void normalisesWhitespaceButKeepsLines() {
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(b("  a\u00A0 b \n\n\n\n c\t", 0, 0, 100, 100)), 1080, 2400);
        assertEquals("a b\n\nc", out.get(0).text);
    }

    @Test public void thaiAndJapaneseCountAsWords() {
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(b("ผัดกะเพรา", 0, 0, 300, 50), b("本日のおすすめ", 0, 100, 300, 50)), 1080, 2400);
        assertEquals(2, out.size());
    }

    @Test public void capsTheNumberOfBlocks() {
        List<ScreenPolicy.Block> raw = new ArrayList<>();
        for (int i = 0; i < 1000; i++) raw.add(b("row " + i, 0, i * 2, 200, 40));
        assertEquals(ScreenPolicy.MAX_BLOCKS, ScreenPolicy.clean(raw, 1080, 4000).size());
    }

    @Test public void aPictureScreenAsksForPictureText() {
        assertTrue(ScreenPolicy.wantsPictureText(new ArrayList<>()));
        assertTrue(ScreenPolicy.wantsPictureText(Arrays.asList(label("Play video", 0, 0, 100, 100), b("ok", 0, 0, 10, 10))));
        assertFalse(ScreenPolicy.wantsPictureText(Arrays.asList(b("one line", 0, 0, 1, 1), b("two line", 0, 0, 1, 1), b("three", 0, 0, 1, 1))));
    }

    @Test public void jsonForThePage() throws Exception {
        JSONArray a = ScreenPolicy.toJson(Arrays.asList(new ScreenPolicy.Block("Hi \"there\"", 1, 2, 3, 4, true)));
        assertEquals("Hi \"there\"", a.getJSONObject(0).getString("t"));
        assertEquals(4, a.getJSONObject(0).getInt("h"));
        assertTrue(a.getJSONObject(0).getBoolean("l"));
    }

    @Test public void clipsLongContext() {
        assertEquals("abc", ScreenPolicy.clipContext("  abc ", 10));
        String c = ScreenPolicy.clipContext("abcdefghijk", 5);
        assertEquals(5, c.length());
        assertTrue(c.endsWith("…"));
    }

    /* ---------------- 0.9.21: words for Google-style free selection ---------------- */

    private static String joined(List<ScreenPolicy.Word> ws) {
        StringBuilder b = new StringBuilder();
        for (ScreenPolicy.Word w : ws) b.append(w.t).append(w.sp);
        return b.toString().trim();
    }

    /** Character boxes for one line of text: each character 10 px wide, 20 px tall, starting at x0, y. */
    private static float[][] line(String t, int x0, int y) {
        float[][] r = new float[t.length()][];
        for (int i = 0; i < t.length(); i++) r[i] = new float[]{x0 + i * 10, y, x0 + i * 10 + 10, y + 20};
        return r;
    }

    @Test public void punctuationSticksToItsWordAndSpacesSeparate() {
        List<ScreenPolicy.Word> ws = ScreenPolicy.words("Hello, world (test).", null);
        assertEquals(Arrays.asList("Hello,", "world", "(test)."), Arrays.asList(ws.get(0).t, ws.get(1).t, ws.get(2).t));
        assertEquals(" ", ws.get(0).sp);
        assertEquals("Hello, world (test).", joined(ws));
    }

    @Test public void lineBreaksSurviveTheJoin() {
        List<ScreenPolicy.Word> ws = ScreenPolicy.words("Order 4,471\nready now", null);
        assertEquals("\n", ws.get(1).sp);
        assertEquals("4,471", ws.get(1).t);
        assertEquals("Order 4,471\nready now", joined(ws));
    }

    @Test public void thaiWithoutSpacesStillJoinsBackExactly() {
        String t = "ผัดกะเพราหมูสับไข่ดาว";
        List<ScreenPolicy.Word> ws = ScreenPolicy.words(t, null);
        assertTrue(ws.size() >= 1);
        assertEquals(t, joined(ws));
        for (ScreenPolicy.Word w : ws) assertEquals("", w.sp);
    }

    @Test public void wordsGetTheirBoxFromCharacterPositions() {
        List<ScreenPolicy.Word> ws = ScreenPolicy.words("ab cd", line("ab cd", 100, 500));
        assertEquals(2, ws.size());
        assertEquals(100, ws.get(0).x);
        assertEquals(20, ws.get(0).w);
        assertEquals(130, ws.get(1).x);
        assertEquals(500, ws.get(1).y);
        assertEquals(20, ws.get(1).h);
    }

    @Test public void aWrappedWordKeepsItsFirstLineAndUndrawnWordsDrop() {
        float[][] r = line("abcd ef gh", 0, 0);
        r[3] = new float[]{0, 40, 10, 60};   // "d" wrapped to the next line
        r[5] = null; r[6] = null;            // "ef" is not drawn (scrolled away)
        List<ScreenPolicy.Word> ws = ScreenPolicy.words("abcd ef gh", r);
        assertEquals(Arrays.asList("abcd", "gh"), Arrays.asList(ws.get(0).t, ws.get(1).t));
        assertEquals(30, ws.get(0).w);        // a, b, c only
        assertEquals(20, ws.get(0).h);
        assertEquals(" ", ws.get(0).sp);
    }

    @Test public void offScreenWordsAreDroppedAndTheJsonCarriesWordBoxes() throws Exception {
        List<ScreenPolicy.Word> ws = ScreenPolicy.words("in out", new float[][]{{10, 10, 20, 30}, {20, 10, 30, 30}, null,
                {2000, 10, 2010, 30}, {2010, 10, 2020, 30}, {2020, 10, 2030, 30}});
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(
                new ScreenPolicy.Block("in out", 0, 0, 3000, 40, false, ws, true)), 1080, 2400);
        assertEquals(1, out.get(0).words.size());
        JSONArray a = ScreenPolicy.toJson(out);
        JSONArray w0 = a.getJSONObject(0).getJSONArray("wd").getJSONArray(0);
        assertEquals("in", w0.getString(0));
        assertEquals(10, w0.getInt(2));
        assertEquals(6, w0.length());
        assertTrue(a.getJSONObject(0).getBoolean("ex"));
    }

    @Test public void theCopyThatKnowsWhereItsWordsAreWins() {
        List<ScreenPolicy.Word> ws = ScreenPolicy.words("Order now", line("Order now", 0, 100));
        List<ScreenPolicy.Block> out = ScreenPolicy.clean(Arrays.asList(
                b("Order now", 20, 120, 300, 60), new ScreenPolicy.Block("Order now", 0, 100, 400, 120, false, ws, true)), 1080, 2400);
        assertEquals(1, out.size());
        assertTrue(out.get(0).exact);
    }

    /* ---------------- Hide orb + the menu's spot ---------------- */

    @Test public void hiddenOrbStaysHiddenUntilWizardOsOpens() {
        assertTrue(EverywherePolicy.orbVisible(true, true, false, false));
        assertFalse(EverywherePolicy.orbVisible(true, true, false, true));   // hidden from the long-press menu
        assertFalse(EverywherePolicy.orbVisible(true, true, true, false));   // Wizard OS in front: never two orbs
        assertFalse(EverywherePolicy.orbVisible(false, true, false, false));
        assertFalse(EverywherePolicy.orbVisible(true, false, false, false));
    }

    @Test public void menuOpensTowardsTheMiddleAndStaysOnScreen() {
        int W = 1080, H = 2400, orb = 200, w = 700, h = 500, m = 12;
        int[] right = EverywherePolicy.menuSpot(1000, 1600, orb, w, h, W, H, m);   // orb on the right edge
        assertTrue(right[0] + w <= 1000 - orb / 2 + 1);
        assertTrue(right[0] >= m);
        int[] left = EverywherePolicy.menuSpot(80, 1600, orb, w, h, W, H, m);      // orb on the left edge
        assertEquals(80 + orb / 2, left[0]);
        int[] low = EverywherePolicy.menuSpot(1000, 2390, orb, w, h, W, H, m);     // near the bottom: pushed up
        assertTrue(low[1] + h <= H - m * 4);
        int[] high = EverywherePolicy.menuSpot(1000, 0, orb, w, h, W, H, m);       // near the top: pushed down
        assertTrue(high[1] >= m * 4);
        int[] narrow = EverywherePolicy.menuSpot(500, 1200, orb, 1100, h, W, H, m); // wider than the screen: clamped
        assertEquals(m, narrow[0]);
    }
}
