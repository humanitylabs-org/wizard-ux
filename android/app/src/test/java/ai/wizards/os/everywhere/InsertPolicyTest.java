package ai.wizards.os.everywhere;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.Test;

/** Typed dictation never pops the clipboard in web editors, stays fast in native ones, and is not lost when rejected. */
public class InsertPolicyTest {
    private static final InsertPolicy.Outcome TYPED = InsertPolicy.Outcome.TYPED;
    private static final InsertPolicy.Outcome CLIP = InsertPolicy.Outcome.TRY_CLIPBOARD;

    @Test public void webEditorIsTypedWithoutVerification() {
        assertEquals(TYPED, InsertPolicy.afterCommit(true, true, true, false, false));
        assertFalse(InsertPolicy.clipboardAllowed(true, true, true, false, false));
    }

    @Test public void nativeEditorWithChangedTextIsTyped() {
        assertEquals(TYPED, InsertPolicy.afterCommit(true, true, false, true, true));
    }

    @Test public void nativeEditorWithUnreadableTextIsTrusted() {
        assertEquals(TYPED, InsertPolicy.afterCommit(true, true, false, false, false));
    }

    @Test public void nativeEditorUnchangedAtCapFallsBackToClipboard() {
        assertEquals(CLIP, InsertPolicy.afterCommit(true, true, false, true, false));
        assertTrue(InsertPolicy.clipboardAllowed(true, true, false, true, false));
    }

    @Test public void commitThatThrewMayFallBack() {
        assertEquals(CLIP, InsertPolicy.afterCommit(true, false, false, false, false));
        assertEquals(CLIP, InsertPolicy.afterCommit(true, false, true, false, false));
    }

    @Test public void noInputConnectionAllowsClipboard() {
        assertEquals(CLIP, InsertPolicy.afterCommit(false, false, true, false, false));
        assertTrue(InsertPolicy.clipboardAllowed(false, false, true, false, false));
    }

    @Test public void webEditorClassIsRecognised() {
        assertTrue(InsertPolicy.isWebEditorClass("android.webkit.WebView"));
        assertFalse(InsertPolicy.isWebEditorClass("android.widget.EditText"));
        assertFalse(InsertPolicy.isWebEditorClass(null));
    }

    @Test public void verificationIsShortStepsWithAnEarlyCap() {
        assertTrue(InsertPolicy.VERIFY_STEP_MS <= 25);
        assertTrue(InsertPolicy.VERIFY_CAP_MS <= 300);
    }

    @Test public void insertTextIsCheapBeforeCommitAndWaitsOnlyForNativeEditorsAfterIt() throws Exception {
        String kb = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"),
                "src/main/java/ai/wizards/os/everywhere/WizardKeyboardService.java")), "UTF-8");
        int start = kb.indexOf("public boolean insertText(");
        int end = kb.indexOf("private volatile Runnable pendingRestore");
        String body = kb.substring(start, end);
        int commit = body.indexOf("ic.commitText(");
        int sleep = body.indexOf("Thread.sleep(");
        int web = body.indexOf("InsertPolicy.isWebEditor(node)");
        int clip = body.indexOf("setPrimaryClip(");
        assertTrue(commit > 0 && clip > commit);
        assertTrue("sleep only after the commit and the web-editor check", sleep > web && web > commit);
        assertFalse("no tree walk before the commit", body.substring(0, commit).contains("findEditable()"));
        assertFalse("no sleep before the commit", body.substring(0, commit).contains("Thread.sleep"));
        assertTrue("fallback is gated by the policy", body.indexOf("InsertPolicy.afterCommit(") > sleep
                && body.indexOf("InsertPolicy.afterCommit(") < clip);
    }
}
