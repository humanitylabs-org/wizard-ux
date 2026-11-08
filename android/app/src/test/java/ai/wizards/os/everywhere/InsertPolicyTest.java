package ai.wizards.os.everywhere;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.Test;

/** Typed dictation must never touch the clipboard, and must not wait on accessibility to prove it. */
public class InsertPolicyTest {
    @Test public void commitIssuedButUnverifiableIsTypedWithNoClipboard() {
        assertEquals(InsertPolicy.Outcome.TYPED, InsertPolicy.afterCommit(true, true));
        assertFalse(InsertPolicy.clipboardAllowed(true, true));
    }

    @Test public void commitThatThrewMayFallBack() {
        assertEquals(InsertPolicy.Outcome.TRY_CLIPBOARD, InsertPolicy.afterCommit(true, false));
        assertTrue(InsertPolicy.clipboardAllowed(true, false));
    }

    @Test public void noInputConnectionAllowsClipboard() {
        assertEquals(InsertPolicy.Outcome.TRY_CLIPBOARD, InsertPolicy.afterCommit(false, false));
        assertTrue(InsertPolicy.clipboardAllowed(false, false));
    }

    @Test public void webEditorsAreNotVerified() {
        assertTrue(InsertPolicy.isWebEditorClass("android.webkit.WebView"));
        assertFalse(InsertPolicy.shouldVerify(true));
        assertFalse(InsertPolicy.isWebEditorClass("android.widget.EditText"));
        assertFalse(InsertPolicy.isWebEditorClass(null));
        assertTrue(InsertPolicy.shouldVerify(false));
    }

    @Test public void verificationIsShortStepsWithAnEarlyCap() {
        assertTrue(InsertPolicy.VERIFY_STEP_MS <= 25);
        assertTrue(InsertPolicy.VERIFY_CAP_MS <= 300);
    }

    @Test public void insertTextHasNoSleepNoTreeWalkBeforeCommitAndNoClipboardAfterIt() throws Exception {
        String kb = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"),
                "src/main/java/ai/wizards/os/everywhere/WizardKeyboardService.java")), "UTF-8");
        int start = kb.indexOf("public boolean insertText(");
        int end = kb.indexOf("private void logCommitLater");
        String body = kb.substring(start, end);
        int commit = body.indexOf("ic.commitText(");
        int clip = body.indexOf("setPrimaryClip(");
        assertTrue(commit > 0 && clip > commit);
        assertFalse("no fixed sleep on the success path", body.contains("Thread.sleep"));
        assertFalse("no tree walk before the commit", body.substring(0, commit).contains("findEditable()"));
        assertFalse("stale-InputConnection throw is gone", body.contains("Stale InputConnection"));
        assertTrue("fallback is gated by the policy", body.indexOf("InsertPolicy.afterCommit(") > commit
                && body.indexOf("InsertPolicy.afterCommit(") < clip);
    }
}
