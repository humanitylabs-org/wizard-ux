package ai.wizards.os;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.util.Base64;
import android.util.Log;
import ai.wizards.os.badge.BadgeLook;
import java.io.ByteArrayOutputStream;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.Icon;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Pinned app icons fill the launcher's mask: dark tile edge to edge, glyph kept whole in the middle. */
@RunWith(AndroidJUnit4.class)
public class HomeScreenIconTest {
    @Test public void squareWebIconBecomesFullBleedAdaptiveIcon() {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        // Same layout the web sends: 192 px dark tile, glyph in the middle two thirds (32..160).
        Bitmap square = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
        Canvas s = new Canvas(square);
        s.drawColor(0xff110d1b);
        android.graphics.Paint white = new android.graphics.Paint(); white.setColor(Color.WHITE);
        s.drawRect(32, 32, 160, 160, white);

        Icon icon = HomeScreenShortcuts.adaptive(square);
        assertEquals(Icon.TYPE_ADAPTIVE_BITMAP, icon.getType());
        Drawable d = icon.loadDrawable(c);
        assertTrue(d instanceof AdaptiveIconDrawable);

        Bitmap shown = Bitmap.createBitmap(216, 216, Bitmap.Config.ARGB_8888);
        d.setBounds(0, 0, 216, 216);
        d.draw(new Canvas(shown));
        // Near the mask's left edge: the dark tile, not a white disc or transparency.
        int edge = shown.getPixel(12, 108);
        assertEquals(255, Color.alpha(edge));
        assertTrue("edge should be the dark tile, was " + Integer.toHexString(edge), Color.red(edge) < 40 && Color.blue(edge) < 60);
        // The glyph is still drawn in the middle.
        int mid = shown.getPixel(108, 108);
        assertTrue("glyph missing in the middle, was " + Integer.toHexString(mid), Color.red(mid) > 200 && Color.green(mid) > 200);
    }

    /** Messenger unread bubble (wizard-ux#1568): drawn inside the launcher mask, top-right; nothing at zero. */
    @Test public void unreadBubbleShowsInsideTheMaskTopRight() {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Bitmap square = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
        new Canvas(square).drawColor(0xff110d1b);
        assertEquals(0, red(shown(c, HomeScreenShortcuts.adaptive(square, 0)), 0, 0, 216, 216));
        for (int n : new int[]{3, 12}) {
            Icon icon = HomeScreenShortcuts.adaptive(square, n);
            assertEquals(Icon.TYPE_ADAPTIVE_BITMAP, icon.getType());
            Bitmap b = shown(c, icon);
            int topRight = red(b, 108, 0, 216, 108);
            assertTrue(n + ": red bubble in the top-right, red px=" + topRight, topRight > 600);
            assertEquals(n + ": nothing red in the bottom half", 0, red(b, 0, 120, 216, 216));
            assertEquals(n + ": nothing red in the left third", 0, red(b, 0, 0, 72, 216));
        }
    }
    /**
     * One UI icon count (wizard-ux issue 1669, switch wizard/phone-badge-look). Synthetic counts 3, 85 and 1000 only.
     * Samsung placement: the badge sits at the visible tile's top-right corner inside One UI's squircle, with the exact
     * digits; other launchers keep it inside the safe zone so this emulator's own mask never clips it. Also logs a
     * 412 px wide picture (tag BadgeShot, base64 PNG in chunks) of the classic and the new look for the pull request.
     */
    @Test public void oneUiBadgeSitsAtTheTileCornerWithExactDigits() {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Bitmap square = glyphSquare();
        BadgeLook.Style samsung = new BadgeLook.Style(true, true), other = new BadgeLook.Style(true, false);
        for (int n : new int[]{3, 85, 1000}) {
            // Samsung: on the raw 288 px adaptive art the visible tile is [48, 240]; its top-right corner is (240, 48).
            Bitmap art = HomeScreenShortcuts.adaptiveArt(square, n, samsung);
            int[] box = orangeBox(art);
            assertTrue(n + ": badge drawn", box[4] > 200);
            assertTrue(n + ": right edge near the tile's right edge, was " + box[2], box[2] >= 240 - 30);
            assertTrue(n + ": top edge near the tile's top edge, was " + box[1], box[1] <= 48 + 30);
            assertEquals(n + ": no white ring around it", 0, whiteRing(art, box));
            // Masked by a squircle (One UI), nothing of the badge is cut: every orange pixel is inside the shape.
            for (int x = box[0]; x <= box[2]; x++) for (int y = box[1]; y <= box[3]; y++) {
                if (orange(art.getPixel(x, y))) assertTrue(n + ": inside the squircle at " + x + "," + y, inSquircle(x, y, 144, 96, 5));
            }
            // Any other launcher: the emulator's own mask shows the badge whole, top-right.
            Bitmap shownOther = shown(c, HomeScreenShortcuts.adaptive(square, n, other));
            assertTrue(n + ": other launcher shows it top-right", countOrange(shownOther, 108, 0, 216, 108) > 150);
            assertEquals(n + ": nothing in the bottom half", 0, countOrange(shownOther, 0, 120, 216, 216));
        }
        // Switch off: the classic red ringed bubble is unchanged.
        Bitmap classic = HomeScreenShortcuts.adaptiveArt(square, 85, BadgeLook.Style.CLASSIC);
        assertEquals("classic has no orange", 0, orangeBox(classic)[4]);
        logShot("before", sheet(c, square, false));
        logShot("after", sheet(c, square, true));
    }

    private static Bitmap glyphSquare() {
        Bitmap sq = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
        Canvas k = new Canvas(sq);
        k.drawColor(0xff110d1b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(0xffd9ccff);
        k.drawRoundRect(new RectF(52, 58, 140, 122), 22, 22, p);       // a chat-bubble glyph in the middle
        Path tail = new Path(); tail.moveTo(70, 118); tail.lineTo(62, 140); tail.lineTo(92, 120); tail.close();
        k.drawPath(tail, p);
        return sq;
    }
    private static boolean orange(int p) {
        return Color.alpha(p) > 200 && Math.abs(Color.red(p) - 0xF4) < 14 && Math.abs(Color.green(p) - 0x51) < 14 && Math.abs(Color.blue(p) - 0x1E) < 14;
    }
    /** {minX, minY, maxX, maxY, count} of the orange badge pixels. */
    private static int[] orangeBox(Bitmap b) {
        int[] r = {Integer.MAX_VALUE, Integer.MAX_VALUE, -1, -1, 0};
        for (int x = 0; x < b.getWidth(); x++) for (int y = 0; y < b.getHeight(); y++) if (orange(b.getPixel(x, y))) {
            r[0] = Math.min(r[0], x); r[1] = Math.min(r[1], y); r[2] = Math.max(r[2], x); r[3] = Math.max(r[3], y); r[4]++;
        }
        return r;
    }
    private static int countOrange(Bitmap b, int x0, int y0, int x1, int y1) {
        int n = 0;
        for (int x = x0; x < x1; x++) for (int y = y0; y < y1; y++) if (orange(b.getPixel(x, y))) n++;
        return n;
    }
    /** White pixels in a 3 px band just outside the badge's box (a ring would put them there). */
    private static int whiteRing(Bitmap b, int[] box) {
        int n = 0;
        for (int x = Math.max(0, box[0] - 3); x <= Math.min(b.getWidth() - 1, box[2] + 3); x++)
            for (int y = Math.max(0, box[1] - 3); y <= Math.min(b.getHeight() - 1, box[3] + 3); y++) {
                boolean outside = x < box[0] || x > box[2] || y < box[1] || y > box[3];
                int p = b.getPixel(x, y);
                if (outside && Color.red(p) > 240 && Color.green(p) > 240 && Color.blue(p) > 240) n++;
            }
        return n;
    }
    private static boolean inSquircle(double x, double y, double c, double a, double n) {
        return Math.pow(Math.abs(x - c) / a, n) + Math.pow(Math.abs(y - c) / a, n) <= 1.0;
    }
    private static Path squircle(float l, float t, float side) {
        Path p = new Path();
        double c = side / 2.0;
        for (int i = 0; i <= 360; i++) {
            double th = Math.toRadians(i), co = Math.cos(th), si = Math.sin(th);
            double x = c + c * Math.signum(co) * Math.pow(Math.abs(co), 2 / 5.0), y = c + c * Math.signum(si) * Math.pow(Math.abs(si), 2 / 5.0);
            if (i == 0) p.moveTo((float) (l + x), (float) (t + y)); else p.lineTo((float) (l + x), (float) (t + y));
        }
        p.close();
        return p;
    }
    /** 412 px wide: top row One UI (squircle, Samsung placement), bottom row this emulator's mask; counts 3, 85, 1000. */
    private static Bitmap sheet(Context c, Bitmap square, boolean oneUi) {
        int w = 412, tile = 96, gap = (w - 3 * tile) / 4, h = 2 * tile + 3 * 40;
        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas k = new Canvas(out);
        k.drawColor(0xff2b3a55);
        Paint label = new Paint(Paint.ANTI_ALIAS_FLAG);
        label.setColor(Color.WHITE); label.setTextSize(15); label.setTextAlign(Paint.Align.CENTER);
        int[] counts = {3, 85, 1000};
        for (int row = 0; row < 2; row++) {
            int top = 30 + row * (tile + 40);
            for (int i = 0; i < 3; i++) {
                int left = gap + i * (tile + gap);
                BadgeLook.Style style = oneUi ? new BadgeLook.Style(true, row == 0) : BadgeLook.Style.CLASSIC;
                if (row == 0) {
                    // One UI shows the middle 72 of 108 dp, masked by its squircle.
                    Bitmap a = HomeScreenShortcuts.adaptiveArt(square, counts[i], style);
                    int s = a.getWidth(), in = Math.round(s * 18f / 108f);
                    k.save();
                    k.clipPath(squircle(left, top, tile));
                    k.drawBitmap(a, new android.graphics.Rect(in, in, s - in, s - in), new RectF(left, top, left + tile, top + tile), new Paint(Paint.FILTER_BITMAP_FLAG));
                    k.restore();
                } else {
                    Drawable d = HomeScreenShortcuts.adaptive(square, counts[i], style).loadDrawable(c);
                    d.setBounds(left, top, left + tile, top + tile);
                    d.draw(k);
                }
                k.drawText(counts[i] + " unread", left + tile / 2f, top + tile + 20, label);
            }
            k.drawText(row == 0 ? "One UI (Samsung)" : "Other launchers", w / 2f, top - 10, label);
        }
        return out;
    }
    private static void logShot(String name, Bitmap b) {
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, png);
        String all = Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP);
        int n = (all.length() + 2999) / 3000;
        for (int i = 0; i < n; i++) Log.i("BadgeShot", name + " " + i + "/" + n + " " + all.substring(i * 3000, Math.min(all.length(), (i + 1) * 3000)));
    }
    private static Bitmap shown(Context c, Icon icon) {
        Drawable d = icon.loadDrawable(c);
        Bitmap b = Bitmap.createBitmap(216, 216, Bitmap.Config.ARGB_8888);
        d.setBounds(0, 0, 216, 216);
        d.draw(new Canvas(b));
        return b;
    }
    private static int red(Bitmap b, int x0, int y0, int x1, int y1) {
        int n = 0;
        for (int x = x0; x < x1; x++) for (int y = y0; y < y1; y++) {
            int p = b.getPixel(x, y);
            if (Color.alpha(p) > 200 && Math.abs(Color.red(p) - 0xE5) < 16 && Math.abs(Color.green(p) - 0x32) < 16 && Math.abs(Color.blue(p) - 0x2D) < 16) n++;
        }
        return n;
    }
}
