package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

public class MicOwnerTest {
    @Before
    public void reset() { MicOwner.resetForTest(); }

    @Test
    public void oneOwnerAtATime() {
        assertTrue(MicOwner.tryAcquire(MicOwner.MEETING));
        assertTrue("re-entrant for the same owner", MicOwner.tryAcquire(MicOwner.MEETING));
        assertFalse("Everywhere refused while a meeting records", MicOwner.tryAcquire(MicOwner.EVERYWHERE));
        assertFalse("side button refused while a meeting records", MicOwner.tryAcquire(MicOwner.SIDE));
        assertTrue(MicOwner.reason(MicOwner.EVERYWHERE).contains("meeting is recording"));
        MicOwner.release(MicOwner.EVERYWHERE); // not the holder: no-op
        assertEquals(MicOwner.MEETING, MicOwner.holder());
        MicOwner.release(MicOwner.MEETING);
        assertNull(MicOwner.holder());
    }

    @Test
    public void meetingRefusedWhileATakeIsActive() {
        assertTrue(MicOwner.tryAcquire(MicOwner.EVERYWHERE));
        assertFalse(MicOwner.tryAcquire(MicOwner.MEETING));
        assertTrue(MicOwner.reason(MicOwner.MEETING).contains("floating orb"));
        MicOwner.release(MicOwner.EVERYWHERE);
        assertTrue(MicOwner.tryAcquire(MicOwner.SIDE));
        assertFalse(MicOwner.tryAcquire(MicOwner.MEETING));
        assertTrue(MicOwner.reason(MicOwner.MEETING).contains("side button"));
        MicOwner.release(MicOwner.SIDE);
        assertTrue(MicOwner.tryAcquire(MicOwner.MEETING));
    }
}
