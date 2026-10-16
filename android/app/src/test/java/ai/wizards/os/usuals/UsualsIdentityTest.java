package ai.wizards.os.usuals;

import org.junit.Test;
import java.util.Arrays;
import static org.junit.Assert.*;

public class UsualsIdentityTest {
    @Test public void configuredNameAndGenericWizardWakeFoodCommands() {
        assertTrue(UsualsPolicy.isBrowse("Hey Saffron, order food", "Saffron"));
        assertTrue(UsualsPolicy.isBrowse("Okay Wizard, order food", "Saffron"));
        assertEquals(0, UsualsPolicy.matchVoice(Arrays.asList("Lunch"), "Hey Saffron, order my usual lunch", "Saffron"));
        assertTrue(UsualsPolicy.isBrowse("Order food", "Saffron"));
        assertTrue(UsualsPolicy.isBrowse("Wizard, order food", null));
    }

    @Test public void oldOwnerNameIsNotAnAliasUnlessConfigured() {
        assertFalse(UsualsPolicy.isBrowse("Archimedes, order food", "Saffron"));
        assertTrue(UsualsPolicy.isBrowse("Archimedes, order food", "Archimedes"));
        assertEquals(-1, UsualsPolicy.matchVoice(Arrays.asList("Lunch"), "Archimedes, order lunch", "Saffron"));
    }

    @Test public void nameIsLiteralAndCannotConsumeAnotherWordsPrefix() {
        assertTrue(UsualsPolicy.isBrowse("Hey A+B, order food", "A+B"));
        assertFalse(UsualsPolicy.isBrowse("Hey AAAB, order food", "A+B"));
        assertTrue(UsualsPolicy.isBrowse("Étoile 星, order food", "Étoile 星"));
        assertFalse(UsualsPolicy.isBrowse("Wizardry, order food", "Saffron"));
        assertFalse(UsualsPolicy.isBrowse("Saffronville, order food", "Saffron"));
    }
}
