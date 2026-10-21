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
        int offset = (int)Math.round(Math.max(0, Math.min(height - client, top)) * dpr);
        return new ScrollProxyMetrics(key, dpr, range, Math.min(range - extent, offset), extent);
    }

    boolean canScroll(int direction) {
        return direction < 0 ? offset > 0 : direction > 0 && offset < range - extent;
    }
}
