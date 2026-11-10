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
}
