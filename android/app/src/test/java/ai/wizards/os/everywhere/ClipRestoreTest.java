package ai.wizards.os.everywhere;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.Test;

/** Dictation that ends up on the clipboard must be the newest entry, ready to paste. */
public class ClipRestoreTest {
    @Test public void failedPasteKeepsTheWordsOnTop() {
        assertFalse(ClipRestore.shouldRestore(false, true));
        assertFalse(ClipRestore.shouldRestore(false, false));
    }

    @Test public void successfulPasteGivesTheOldClipBack() {
        assertTrue(ClipRestore.shouldRestore(true, true));
        assertFalse("no blank clip pushed when there was nothing before", ClipRestore.shouldRestore(true, false));
    }

    @Test public void neverClobbersSomethingCopiedAfterUs() {
        assertTrue(ClipRestore.stillOurs("hello", "hello"));
        assertFalse(ClipRestore.stillOurs("something newer", "hello"));
        assertFalse(ClipRestore.stillOurs(null, "hello"));
    }

    @Test public void orbCopiesGoThroughCopyAsLatest() throws Exception {
        String svc = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/java/ai/wizards/os/everywhere/EverywhereService.java")));
        assertFalse("orb dictation must not set the clip directly", svc.contains("setPrimaryClip("));
        assertTrue(svc.contains("WizardKeyboardService.copyAsLatest("));
        String kb = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/java/ai/wizards/os/everywhere/WizardKeyboardService.java")));
        assertFalse("no blank clip after paste", kb.contains("newPlainText(\"\", \"\")"));
        assertTrue(kb.contains("ClipRestore.shouldRestore(pasted"));
    }
}
