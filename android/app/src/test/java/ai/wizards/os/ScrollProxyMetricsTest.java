package ai.wizards.os;

import org.junit.Test;
import static org.junit.Assert.*;

public class ScrollProxyMetricsTest {
    @Test public void fractionalSamsungDensityAndEnds() {
        ScrollProxyMetrics top = ScrollProxyMetrics.from("sc-1", 3000, 0, 650, 2.625);
        assertNotNull(top); assertEquals(7875, top.range); assertEquals(1706, top.extent);
        assertEquals(0, top.offset); assertTrue(top.canScroll(1)); assertFalse(top.canScroll(-1));
        ScrollProxyMetrics bottom = ScrollProxyMetrics.from("sc-1", 3000, 99999, 650, 2.625);
        assertEquals(bottom.range - bottom.extent, bottom.offset);
        assertFalse(bottom.canScroll(1)); assertTrue(bottom.canScroll(-1));
        assertFalse(bottom.canScroll(0));
    }
    @Test public void fractionalOffsetAndOverscrollClamp() {
        ScrollProxyMetrics middle = ScrollProxyMetrics.from("sc-2", 2000, 100.5, 500, 2.625);
        assertEquals(264, middle.offset); assertTrue(middle.canScroll(1)); assertTrue(middle.canScroll(-1));
        assertEquals(0, ScrollProxyMetrics.from("sc-2", 2000, -25, 500, 2.625).offset);
        // Browser-clamped fractional bottom (device-pixel boundary) still reports the end.
        ScrollProxyMetrics clamped = ScrollProxyMetrics.from("sc-3", 3000, 2349.71, 650, 2.625);
        org.junit.Assert.assertFalse(clamped.canScroll(1));
        org.junit.Assert.assertTrue(clamped.canScroll(-1));
    }
    @Test public void rejectInvalidOrNonOverflowingMetrics() {
        assertNull(ScrollProxyMetrics.from("", 2000, 0, 500, 2));
        assertNull(ScrollProxyMetrics.from("sc", 502, 0, 500, 2));
        assertNull(ScrollProxyMetrics.from("sc", 2000, 0, 20, 2));
        assertNull(ScrollProxyMetrics.from("sc", 2000, 0, 500, 0));
        assertNull(ScrollProxyMetrics.from("sc", 2000, 0, 500, 9));
        assertNull(ScrollProxyMetrics.from("sc", Double.NaN, 0, 500, 2));
        assertNull(ScrollProxyMetrics.from("sc", 2000, Double.POSITIVE_INFINITY, 500, 2));
        assertNull(ScrollProxyMetrics.from("sc", 2000, 0, Double.NaN, 2));
        assertNull(ScrollProxyMetrics.from("sc", 2000, 0, 500, Double.NaN));
        assertNull(ScrollProxyMetrics.from("sc", Integer.MAX_VALUE, 0, 500, 2));
    }
}
