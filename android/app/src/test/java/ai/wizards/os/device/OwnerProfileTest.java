package ai.wizards.os.device;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;

/** Native text names the owner from their own Wizard's settings, never from code. */
public class OwnerProfileTest {
    @After public void reset() { OwnerProfile.reset(); }

    @Test
    public void unknownOwnerIsNeutral() {
        OwnerProfile.reset();
        assertEquals("", OwnerProfile.owner());
        assertEquals("The owner", OwnerProfile.ownerSubject());
        assertEquals("Wizard", OwnerProfile.agent());
        assertEquals("Names: Wizard, Hermes, Mizel.", OwnerProfile.names());
    }

    @Test
    public void profileFromSettings() {
        assertTrue(OwnerProfile.apply("{\"owner\":\"Ada\",\"agent\":\"Merlin\",\"vocabulary\":[\"Lovelace\",\"\",\"Wizard\"]}"));
        assertEquals("Ada", OwnerProfile.ownerSubject());
        assertEquals("Merlin", OwnerProfile.agent());
        assertEquals("Names: Merlin, Ada, Wizard, Hermes, Mizel, Lovelace.", OwnerProfile.names());
    }

    @Test
    public void badInputChangesNothing() {
        assertTrue(OwnerProfile.apply("{\"owner\":\"Ada\"}"));
        assertFalse(OwnerProfile.apply("not json"));
        assertFalse(OwnerProfile.apply(""));
        assertFalse(OwnerProfile.apply(null));
        assertEquals("Ada", OwnerProfile.owner());
        assertTrue(OwnerProfile.apply("{\"owner\":\"  A\\nB  \"}"));
        assertEquals("A B", OwnerProfile.owner());
    }
}
