package ai.wizards.os.everywhere;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The orb's keyboard mode (ported from Archimedes Anywhere's rules). */
public class KeyboardSignalTest {
    @Test public void coldStartStaysTheNormalOrb() {
        KeyboardSignal k = new KeyboardSignal();
        assertFalse(k.keyboardMode(false, 1000));
        assertFalse(k.keyboardMode(false, 2000));
    }

    @Test public void keyboardWindowTurnsItIntoAMic() {
        KeyboardSignal k = new KeyboardSignal();
        assertTrue(k.keyboardMode(true, 1000));
    }

    @Test public void oneMissingSampleDoesNotFlipBack() {
        KeyboardSignal k = new KeyboardSignal();
        k.keyboardMode(true, 1000);
        assertTrue(k.keyboardMode(false, 10_000));   // Android reshuffling windows
        assertFalse(k.keyboardMode(false, 10_450));  // really gone
        assertFalse(k.keyboardMode(false, 10_900));
    }

    @Test public void focusingAFieldCountsWhileTheKeyboardSlidesUp() {
        KeyboardSignal k = new KeyboardSignal();
        k.editorEvidence(1000);
        assertTrue(k.keyboardMode(false, 1400));
        assertTrue(k.recentEditor(2400));
        assertFalse(k.recentEditor(2600));
    }

    @Test public void aFocusedFieldWithTheKeyboardDismissedGoesBack() {
        KeyboardSignal k = new KeyboardSignal();
        k.editorEvidence(1000);
        k.keyboardMode(true, 1100);
        // The field stays focused but no new evidence arrives and the keyboard is gone.
        k.keyboardMode(false, 5000);
        assertFalse(k.keyboardMode(false, 5450));
    }

    @Test public void tapOverAnOpenKeyboardAlwaysDictatesEvenWithAStaleIcon() {
        assertTrue(KeyboardSignal.dictate(true, false));
        assertTrue(KeyboardSignal.dictate(false, true));
        assertFalse(KeyboardSignal.dictate(false, false));
    }
}
