package ai.wizards.os.everywhere;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;

import ai.wizards.os.device.OwnerProfile;

/** What the agent is told about a recording names the owner from their settings, or "The owner". */
public class EverywhereInstructionsTest {
    @After public void reset() { OwnerProfile.reset(); }

    static EverywhereOutbox.Item item(String source, boolean locked) {
        EverywhereOutbox.Item it = new EverywhereOutbox.Item();
        it.source = source;
        it.locked = locked;
        return it;
    }

    @Test
    public void neutralWithoutAProfile() {
        OwnerProfile.reset();
        String orb = EverywhereOutbox.instructions(item(EverywhereOutbox.SRC_EVERYWHERE, false));
        String side = EverywhereOutbox.instructions(item(EverywhereOutbox.SRC_SIDE, false));
        assertTrue(orb, orb.startsWith("The owner spoke this to the Wizard Everywhere floating orb"));
        assertTrue(side, side.startsWith("The owner spoke this by holding their Android phone's side button"));
        for (String s : new String[] {orb, side, EverywhereOutbox.prompt()}) {
            assertFalse(s, s.matches("(?s).*\\b(James|Archimedes|Miguel|Thales|Bangkok)\\b.*"));
        }
    }

    @Test
    public void namesTheOwnerFromTheProfile() {
        OwnerProfile.apply("{\"owner\":\"Ada\",\"agent\":\"Merlin\"}");
        assertTrue(EverywhereOutbox.instructions(item(EverywhereOutbox.SRC_EVERYWHERE, false)).startsWith("Ada spoke this"));
        assertTrue(EverywhereOutbox.prompt().startsWith("Wizard voice request spoken to Merlin "));
        // A locked phone never claims who spoke.
        assertTrue(EverywhereOutbox.instructions(item(EverywhereOutbox.SRC_SIDE, true)).startsWith("Spoken into the Wizard OS side-button assistant"));
    }
}
