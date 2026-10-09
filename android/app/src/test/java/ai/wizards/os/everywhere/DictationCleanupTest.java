package ai.wizards.os.everywhere;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Archimedes Anywhere's dictation clean-up, as carried into Wizard Everywhere. */
public class DictationCleanupTest {
    @Test public void lineBreaksNeverReachTheField() {
        // A newline typed into Obsidian starts a new line/list item: Archimedes flattens them.
        assertEquals("First thought. Second thought here and more words now. ",
                DictationCleanup.cleanTranscriptForInsertion("First thought.\nSecond thought here and more words now."));
    }

    @Test public void shortFragmentLosesItsFullStopAndEndsWithASpace() {
        assertEquals("Buy milk ", DictationCleanup.cleanTranscriptForInsertion("Buy milk."));
    }

    @Test public void longerSentenceKeepsItsFullStop() {
        assertEquals("I will call you back after the meeting today. ",
                DictationCleanup.cleanTranscriptForInsertion("I will call you back after the meeting today."));
    }

    @Test public void spokenTimesAndGlossary() {
        assertEquals("Meet at 3:30pm on the VPS ", DictationCleanup.cleanTranscriptForInsertion("Meet at 3:30 p.m. on the vps"));
    }

    @Test public void hallucinatedThankYouTailIsDropped() {
        assertEquals("Send the report to the whole team. ",
                DictationCleanup.cleanTranscriptForInsertion("Send the report to the whole team. Thank you."));
    }

    @Test public void repetitionLoopsAreCaught() {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < 6; i++) s.append("this is the same phrase again ");
        assertTrue(DictationCleanup.isLikelyRepetitionLoop(s.toString()));
        assertFalse(DictationCleanup.isLikelyRepetitionLoop("An ordinary sentence with enough words to be checked properly today."));
    }
}
