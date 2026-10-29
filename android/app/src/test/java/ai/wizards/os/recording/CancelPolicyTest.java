package ai.wizards.os.recording;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;

import org.junit.Test;

public class CancelPolicyTest {
    @Test public void shortCancelIsGone() {
        assertFalse(CancelPolicy.keep(3_000, 50_000));
        assertFalse(CancelPolicy.keep(14_999, 500_000));
    }

    @Test public void longCancelIsKept() {
        assertTrue(CancelPolicy.keep(15_000, 120_000));
        assertTrue(CancelPolicy.keep(6 * 60_000, 3_000_000));
    }

    @Test public void emptyFileIsNotKept() { assertFalse(CancelPolicy.keep(60_000, 400)); }

    @Test public void keepsNewestTenForAWeek() {
        long now = 10L * 24 * 3600 * 1000;
        long[] ats = new long[12];
        for (int i = 0; i < ats.length; i++) ats[i] = now - i * 60_000L;
        assertEquals(Arrays.asList(10, 11), CancelPolicy.drop(ats, now));
        long[] old = { now - 1000, now - 8L * 24 * 3600 * 1000 };
        assertEquals(Arrays.asList(1), CancelPolicy.drop(old, now));
    }
}
