package ai.wizards.os.badge;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;

/** Draws the unread bubble onto a copy of the app's own icon. The base bitmap is never modified. */
public final class BadgeCompositor {
    private BadgeCompositor() {}
    /** One UI's badge orange-red (wizard-ux issue 1669, on for everyone). */
    public static final int ONE_UI = 0xFFF4511E;

    /** Zero (or unknown) returns {@code base} itself: no bubble, no copy. The whole bitmap is the tile (a shell-drawn
     *  tile may have rounded corners, so the badge keeps to the squircle that shows). */
    public static Bitmap compose(Bitmap base, int count) {
        if (base == null) return null;
        int side = Math.min(base.getWidth(), base.getHeight());
        return drawOneUi(base, count, (len, w) -> BadgeGeometry.oneUi(0f, side, len, w, true), side);
    }

    /**
     * Same badge on a full adaptive-icon bitmap (108 dp art, of which the launcher shows a masked middle): at the
     * visible tile's corner on Samsung (squircle), and at the corner of {@link BadgeGeometry#adaptiveRegion} on every
     * other launcher, so a circle, squircle or rounded-square mask never clips it. Zero (or unknown) returns
     * {@code full} itself.
     */
    public static Bitmap composeAdaptive(Bitmap full, int count, boolean samsung) {
        if (full == null) return null;
        int side = Math.min(full.getWidth(), full.getHeight());
        return drawOneUi(full, count, (len, w) -> BadgeGeometry.oneUiAdaptive(side, len, w, samsung), BadgeGeometry.visibleTile(side));
    }

    private interface Place { BadgeGeometry at(int labelLength, float textWidth); }

    private static Bitmap drawOneUi(Bitmap base, int count, Place place, float tile) {
        String label = BadgeText.label(count);
        if (base == null || label.isEmpty()) return base;
        Bitmap out = base.copy(Bitmap.Config.ARGB_8888, true);
        if (out == null) return base;
        Canvas canvas = new Canvas(out);
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        // Heavier digits (issue 1960): the heaviest weight the font has up to 800, plus a hairline stroke so they read
        // bolder even where the font stops at 700.
        float ts = BadgeGeometry.oneUiTextSize(BadgeGeometry.oneUiHeight(tile));
        text.setTypeface(Typeface.create(Typeface.create("sans-serif-medium", Typeface.NORMAL), 800, false));
        text.setTextSize(ts);
        text.setStyle(Paint.Style.FILL_AND_STROKE);
        text.setStrokeWidth(ts * 0.03f);
        text.setTextAlign(Paint.Align.CENTER);
        text.setColor(Color.WHITE);
        BadgeGeometry g = place.at(label.length(), text.measureText(label));
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(ONE_UI);
        // A faint soft shadow lifts the badge off the tile (issue 1960); BadgeGeometry leaves room for it inside the mask.
        fill.setShadowLayer(BadgeGeometry.shadowBlur(g.height()), 0f, BadgeGeometry.shadowDy(g.height()), BadgeGeometry.SHADOW_COLOR);
        canvas.drawRoundRect(new RectF(g.left, g.top, g.right, g.bottom), g.radius(), g.radius(), fill);
        // Centre the digits on their own ink, not on the font's ascent, so "1" and "85" sit in the middle.
        Rect ink = new Rect();
        text.getTextBounds(label, 0, label.length(), ink);
        canvas.drawText(label, g.textCenterX, (g.top + g.bottom) / 2f - ink.exactCenterY(), text);
        return out;
    }
}
