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

    /* ---- One UI look (wizard-ux issue 1669, switch wizard/phone-badge-look): no ring, a quarter of the visible tile in
     * diameter, a circle for one character and a pill that grows leftwards for more, at the tile's top-right. ---- */

    /** Badge height as a share of the visible tile's side (One UI's own badges are about a quarter of the icon). */
    public static final float ONE_UI_SHARE = 0.25f;
    /** One UI Home's icon shape, modelled as a superellipse |x|^n + |y|^n <= 1. Samsung's squircle is squarer than
     *  n = 4, so a badge inside this model is inside the real mask too. */
    public static final float SQUIRCLE_N = 4f;

    public static float oneUiHeight(float tile) { return tile * ONE_UI_SHARE; }
    public static float oneUiTextSize(float height) { return height * 0.62f; }

    /**
     * The badge on the tile [tileLeft, tileLeft + tile] (square, same offset on both axes), sized from that tile.
     * @param squircle  true: One UI's squircle masks the tile, so the badge is pushed along the diagonal toward the
     *                  top-right corner as far as the shape shows it whole; false: the whole square is visible (a
     *                  square no mask clips, like the safe-zone square), so the badge sits in its top-right corner.
     * @param textWidth measured label width at {@link #oneUiTextSize(float)}; 0 = estimate
     */
    public static BadgeGeometry oneUi(float tileLeft, float tile, int labelLength, float textWidth, boolean squircle) {
        return place(tileLeft, tile, oneUiHeight(tile), labelLength, textWidth, squircle);
    }

    /** The badge for a full adaptive-icon bitmap of side {@code full}, always a quarter of the visible 72 dp tile.
     *  Samsung: the squircle corner of that tile. Any other launcher: the top-right of the safe-zone square, which a
     *  circle, squircle or rounded-square mask never clips. */
    public static BadgeGeometry oneUiAdaptive(int full, int labelLength, float textWidth, boolean samsung) {
        float tile = visibleTile(full), d = oneUiHeight(tile);
        if (samsung) return place((full - tile) / 2f, tile, d, labelLength, textWidth, true);
        float[] r = adaptiveRegion(full);
        return place(r[0], r[1], d, labelLength, textWidth, false);
    }

    /** Side of the part of a 108 dp adaptive bitmap a launcher shows (the middle 72 dp). */
    public static float visibleTile(int full) { return full * (72f / 108f); }

    private static BadgeGeometry place(float tileLeft, float tile, float d, int labelLength, float textWidth, boolean squircle) {
        float ts = oneUiTextSize(d);
        float w = textWidth > 0 ? textWidth : ts * 0.58f * labelLength;
        float width = Math.min(tile, Math.max(d, w + 2 * d * 0.26f));
        float right, top;
        if (!squircle) {
            float inset = Math.max(0.5f, tile * 0.01f);
            right = tileLeft + tile - inset; top = tileLeft + inset;
        } else {
            // Binary search the corner offset k (right edge at c + k, top edge at c - k), keeping a small margin so the
            // mask's anti-aliased edge never nibbles the badge.
            float half = tile / 2f, c = tileLeft + half, a = half - Math.max(0.5f, d * 0.06f), lo = 0f, hi = half;
            for (int i = 0; i < 30; i++) {
                float k = (lo + hi) / 2f;
                if (pillInside(c + k - width, c - k, width, d, c, a)) lo = k; else hi = k;
            }
            right = c + lo; top = c - lo;
        }
        float left = right - width, bottom = top + d;
        return new BadgeGeometry(left, top, right, bottom, 0f, ts, (left + right) / 2f, ts * 0.35f);
    }

    /** Is the pill [left, left + width] x [top, top + h] (ends rounded by h / 2) inside the superellipse of half-size a
     *  centred on (c, c)? The shape is convex, so checking both end circles is enough. */
    public static boolean pillInside(float left, float top, float width, float h, float c, float a) {
        float r = h / 2f, cy = top + r;
        return circleInside(left + r, cy, r, c, a) && circleInside(left + width - r, cy, r, c, a);
    }

    private static boolean circleInside(float x, float y, float r, float c, float a) {
        for (int i = 0; i < 72; i++) {
            double t = i * Math.PI / 36.0;
            if (!insideSquircle(x + r * Math.cos(t), y + r * Math.sin(t), c, a)) return false;
        }
        return true;
    }

    /** Point inside the superellipse of half-size {@code a} and exponent {@link #SQUIRCLE_N} centred on (c, c). */
    public static boolean insideSquircle(double x, double y, double c, double a) {
        if (a <= 0) return false;
        double u = Math.abs(x - c) / a, v = Math.abs(y - c) / a;
        return Math.pow(u, SQUIRCLE_N) + Math.pow(v, SQUIRCLE_N) <= 1.0;
    }

    /**
     * Where the bubble may go on a full adaptive-icon bitmap of side {@code full} (108 dp): the square inscribed in
     * Android's 66 dp safe-zone circle, which every launcher mask (circle, squircle, rounded square) shows whole.
     * @return {offset, side} in px; the region is centred, so the offset is the same on both axes.
     */
    public static float[] adaptiveRegion(int full) {
        float side = full * (66f / 108f) / (float) Math.sqrt(2.0);
        return new float[]{(full - side) / 2f, side};
    }
}
