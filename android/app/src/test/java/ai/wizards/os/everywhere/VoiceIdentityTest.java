package ai.wizards.os.everywhere;

import org.junit.Test;
import static org.junit.Assert.*;

public class VoiceIdentityTest {
    @Test public void requestContextNeverAssumesTheOwnersNameOrGender() {
        EverywhereOutbox.Item item = new EverywhereOutbox.Item();
        for (String source : new String[]{EverywhereOutbox.SRC_SIDE, EverywhereOutbox.SRC_EVERYWHERE}) {
            item.source = source;
            String context = EverywhereOutbox.instructions(item);
            assertTrue(context.contains("The user spoke"));
            assertFalse(context.contains("James"));
            assertFalse(java.util.regex.Pattern.compile("\\b(?:his|he)\\b", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(context).find());
        }
        item.shots.put("fixture.png");
        assertTrue(EverywhereOutbox.instructions(item).contains("They attached 1 screenshot"));
        item.source = EverywhereOutbox.SRC_SIDE;
        item.locked = true;
        assertTrue(EverywhereOutbox.instructions(item).contains("speaker was not verified by an unlock"));
    }

    @Test public void dictationRemainsUnprompted() {
        assertEquals("", EverywhereOutbox.DICTATION_PROMPT);
    }
}
