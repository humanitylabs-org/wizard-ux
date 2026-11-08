package ai.wizards.os.badge;

/** Bubble placement for an icon of side {@code size}: top-right, pill-shaped when the label is wider than tall. */
public final class BadgeGeometry {
    public final float left, top, right, bottom, ring, textSize, textCenterX, textBaselineOffset;
    private BadgeGeometry(float l, float t, float r, float b, float ring, float textSize, float cx, float baseline) {
        left = l; top = t; right = r; bottom = b; this.ring = ring; this.textSize = textSize; textCenterX = cx; textBaselineOffset = baseline;
    }
    public float width() { return right - left; }
    public float height() { return bottom - top; }
    public float radius() { return height() / 2f; }

    /**
     * @param size           icon side in px
     * @param labelLength    characters in the label ("9", "9+")
     * @param textWidth      measured width of the label at {@link #textSizeFor(int)}; 0 = estimate
     */
    public static BadgeGeometry compute(int size, int labelLength, float textWidth) {
        float s = size;
        float d = s * 0.40f;                         // bubble height
        float ring = Math.max(1f, s * 0.035f);        // white edge so it reads on any icon
        float inset = s * 0.02f + ring;               // keep the ring inside the bitmap
        float ts = textSizeFor(size);
        float w = textWidth > 0 ? textWidth : ts * 0.6f * labelLength;
        float pad = d * 0.30f;
        float width = Math.max(d, w + 2 * pad);
        float right = s - inset, left = right - width, top = inset, bottom = top + d;
        // Vertical centring: caller adds this to the bubble centre to get the text baseline.
        float baseline = ts * 0.35f;
        return new BadgeGeometry(left, top, right, bottom, ring, ts, (left + right) / 2f, baseline);
    }

    public static float textSizeFor(int size) { return size * 0.26f; }
}
