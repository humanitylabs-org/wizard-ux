package ai.wizards.os;

/** Immutable CSS -> physical-pixel math, independent of Android for JVM coverage. */
final class ScrollProxyMetrics {
    final String key;
    final double dpr;
    final int range, offset, extent;

    private ScrollProxyMetrics(String key, double dpr, int range, int offset, int extent) {
        this.key = key; this.dpr = dpr; this.range = range; this.offset = offset; this.extent = extent;
    }

    static ScrollProxyMetrics from(String key, double height, double top, double client, double dpr) {
        if (key == null || key.isEmpty() || key.length() > 120 ||
            !Double.isFinite(height) || !Double.isFinite(top) || !Double.isFinite(client) ||
            !Double.isFinite(dpr) || dpr <= 0 || dpr > 8 || client < 80 || height <= client + 2 ||
            height * dpr > Integer.MAX_VALUE) return null;
        int extent = (int)Math.round(client * dpr), range = (int)Math.round(height * dpr);
        // At fractional DPRs the browser clamps scrollTop to a device-pixel boundary just short
        // of height-client; snap within one CSS px so the ends report "cannot scroll".
        double css = Math.max(0, Math.min(height - client, top));
        if (height - client - css <= 1) css = height - client;
        else if (css <= 1) css = 0;
        int offset = css == height - client ? range - extent : (int)Math.round(css * dpr);
        return new ScrollProxyMetrics(key, dpr, range, Math.min(range - extent, offset), extent);
    }

    boolean canScroll(int direction) {
        return direction < 0 ? offset > 0 : direction > 0 && offset < range - extent;
    }
}
