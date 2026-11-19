package ai.wizards.os;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.AdaptiveIconDrawable;
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
