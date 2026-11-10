package ai.wizards.os.badge;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;

/** Draws the red unread bubble onto a copy of the app's own icon. The base bitmap is never modified. */
public final class BadgeCompositor {
    private BadgeCompositor() {}
    public static final int RED = 0xFFE5322D;

    /** Zero (or unknown) returns {@code base} itself: no bubble, no copy. */
    public static Bitmap compose(Bitmap base, int count) {
        String label = BadgeText.label(count);
        if (base == null || label.isEmpty()) return base;
        Bitmap out = base.copy(Bitmap.Config.ARGB_8888, true);
        if (out == null) return base;
        int size = Math.min(out.getWidth(), out.getHeight());
        Canvas canvas = new Canvas(out);
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setTextSize(BadgeGeometry.textSizeFor(size));
        text.setTextAlign(Paint.Align.CENTER);
        text.setColor(Color.WHITE);
        BadgeGeometry g = BadgeGeometry.compute(size, label.length(), text.measureText(label));
        RectF bubble = new RectF(g.left, g.top, g.right, g.bottom);
        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(Color.WHITE);                               // ring
        RectF ring = new RectF(bubble); ring.inset(-g.ring, -g.ring);
        canvas.drawRoundRect(ring, ring.height() / 2f, ring.height() / 2f, fill);
        fill.setColor(RED);
        canvas.drawRoundRect(bubble, g.radius(), g.radius(), fill);
        canvas.drawText(label, g.textCenterX, (g.top + g.bottom) / 2f + g.textBaselineOffset, text);
        return out;
    }
}
