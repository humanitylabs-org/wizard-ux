package ai.wizards.os.badge;

/** Badge placement on an icon: top-right, pill-shaped when the label is wider than tall. */
public final class BadgeGeometry {
    public final float left, top, right, bottom, textSize, textCenterX;
    private BadgeGeometry(float l, float t, float r, float b, float textSize, float cx) {
        left = l; top = t; right = r; bottom = b; this.textSize = textSize; textCenterX = cx;
    }
    public float width() { return right - left; }
    public float height() { return bottom - top; }
    public float radius() { return height() / 2f; }

    /* ---- One UI look (wizard-ux issue 1669, on for everyone): no ring, about a third of the visible
     * tile in diameter, a circle for one character and a pill that grows leftwards for more, at the tile's top-right,
     * lifted off the tile by a faint shadow (issue 1960). ---- */

    /** Badge height as a share of the visible tile's side (issue 1960: about 25 % bigger than the first 0.25, so it
     *  reads as clearly as the launcher's own badges next to it). */
    public static final float ONE_UI_SHARE = 0.31f;
    /** One UI Home's icon shape, modelled conservatively (issue 1960: the real mask is rounder than the n = 4 first
     *  used, and its corner cut the badge): the badge must fit inside BOTH a superellipse |x|^n + |y|^n <= 1 with
     *  this n and a rounded square with {@link #ROUNDED_CORNER} corners. */
    public static final float SQUIRCLE_N = 3f;
    /** Corner radius of the rounded-square model, as a share of the tile side. */
    public static final float ROUNDED_CORNER = 0.25f;
    /** Clear space kept between the badge (with its shadow) and the mask edge, as a share of the tile side. */
    public static final float MASK_MARGIN = 0.04f;
    /** Shadow under the badge: about 28 % black. */
    public static final int SHADOW_COLOR = 0x48000000;

    public static float oneUiHeight(float tile) { return tile * ONE_UI_SHARE; }
    public static float oneUiTextSize(float height) { return height * 0.62f; }
    /** Blur radius of the shadow under a badge {@code height} px high (small, at least 1 px). */
    public static float shadowBlur(float height) { return Math.max(1f, height * 0.06f); }
    /** How far the shadow sits below the badge (1-2 px on a phone icon). */
    public static float shadowDy(float height) { return Math.max(1f, height * 0.03f); }
    /** How far the shadow can reach beyond the pill on any side: Android blurs a shadow layer of radius r with a
     *  Gaussian of sigma 0.57735 r + 0.5 and stops at 3 sigma, then drops it by {@link #shadowDy(float)}. */
    public static float shadowReach(float height) { return 3f * (0.57735f * shadowBlur(height) + 0.5f) + shadowDy(height); }

    /**
     * The badge on the tile [tileLeft, tileLeft + tile] (square, same offset on both axes), sized from that tile.
     * @param squircle  true: One UI's rounded mask clips the tile, so the badge is pushed along the diagonal toward
     *                  the top-right corner only as far as the conservative mask model shows it (and its shadow) whole
     *                  with a clear margin; false: the whole square is visible (a square no mask clips, like the
     *                  safe-zone square), so the badge sits in its top-right corner.
     * @param textWidth measured label width at {@link #oneUiTextSize(float)}; 0 = estimate
     */
    public static BadgeGeometry oneUi(float tileLeft, float tile, int labelLength, float textWidth, boolean squircle) {
        return place(tileLeft, tile, oneUiHeight(tile), labelLength, textWidth, squircle);
    }

    /** The badge for a full adaptive-icon bitmap of side {@code full}, sized from the visible 72 dp tile.
     *  Samsung: the masked corner of that tile. Any other launcher: the top-right of the safe-zone square, which a
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
            // Binary search the corner offset k (right edge at c + k, top edge at c - k): the pill grown by its shadow
            // and the clear margin must stay inside the mask model.
            float half = tile / 2f, c = tileLeft + half, grow = shadowReach(d) + Math.max(0.5f, tile * MASK_MARGIN);
            float lo = 0f, hi = half;
            for (int i = 0; i < 30; i++) {
                float k = (lo + hi) / 2f;
                if (pillInside(c + k - width, c - k, width, d, grow, tileLeft, tile)) lo = k; else hi = k;
            }
            right = c + lo; top = c - lo;
        }
        float left = right - width, bottom = top + d;
        return new BadgeGeometry(left, top, right, bottom, ts, (left + right) / 2f);
    }

    /** Is the pill [left, left + width] x [top, top + h] (ends rounded by h / 2), grown by {@code grow} on every side,
     *  inside the mask model of the tile [tileLeft, tileLeft + tile]? Both shapes are convex, so checking both end
     *  circles is enough. */
    public static boolean pillInside(float left, float top, float width, float h, float grow, float tileLeft, float tile) {
        float r = h / 2f, cy = top + r;
        return circleInside(left + r, cy, r + grow, tileLeft, tile) && circleInside(left + width - r, cy, r + grow, tileLeft, tile);
    }

    private static boolean circleInside(float x, float y, float r, float tileLeft, float tile) {
        for (int i = 0; i < 72; i++) {
            double t = i * Math.PI / 36.0;
            if (!insideMask(x + r * Math.cos(t), y + r * Math.sin(t), tileLeft, tile)) return false;
        }
        return true;
    }

    /** Point inside One UI's mask model of the tile [tileLeft, tileLeft + tile]: the n = 3 squircle and the rounded
     *  square at once. */
    public static boolean insideMask(double x, double y, double tileLeft, double tile) {
        double half = tile / 2.0, c = tileLeft + half;
        return insideSquircle(x, y, c, half) && insideRoundedSquare(x, y, tileLeft, tile, ROUNDED_CORNER);
    }

    /** Point inside the superellipse of half-size {@code a} and exponent {@link #SQUIRCLE_N} centred on (c, c). */
    public static boolean insideSquircle(double x, double y, double c, double a) {
        if (a <= 0) return false;
        double u = Math.abs(x - c) / a, v = Math.abs(y - c) / a;
        return Math.pow(u, SQUIRCLE_N) + Math.pow(v, SQUIRCLE_N) <= 1.0;
    }

    /** Point inside the square [tileLeft, tileLeft + tile] with circular corners of radius {@code corner} * tile. */
    public static boolean insideRoundedSquare(double x, double y, double tileLeft, double tile, double corner) {
        double u = x - tileLeft, v = y - tileLeft, r = corner * tile;
        if (u < 0 || v < 0 || u > tile || v > tile) return false;
        double cx = Math.min(Math.max(u, r), tile - r), cy = Math.min(Math.max(v, r), tile - r);
        return Math.hypot(u - cx, v - cy) <= r;
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
