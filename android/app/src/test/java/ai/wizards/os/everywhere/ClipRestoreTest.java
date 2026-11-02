package ai.wizards.os.everywhere;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.Test;

/** Clipboard policy plus source wiring guards; native tests prove actual delayed paste/restore. */
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
        String svc = source("EverywhereService.java");
        assertFalse("orb dictation must not set the clip directly", svc.contains("setPrimaryClip("));
        assertTrue(svc.contains("WizardKeyboardService.copyAsLatest("));
    }

    @Test public void asynchronousRestoreRequiresVerifiedPaste() throws Exception {
        verifiedPasteOnly(source("WizardKeyboardService.java"));
    }

    @Test public void restoreRequiresSavedClipAndAttemptOwnership() throws Exception {
        savedAndOwnedOnly(source("WizardKeyboardService.java"));
    }

    @Test public void recoveryCopyCancelsPendingRestoreBeforeBecomingLatest() throws Exception {
        latestCopyCancels(source("WizardKeyboardService.java"));
    }

    @Test public void sourceGuardsRejectUnsafeRestoreMutations() throws Exception {
        String kb = source("WizardKeyboardService.java");
        rejects(() -> verifiedPasteOnly(kb.replace("paste && result ==", "result ==")));
        rejects(() -> verifiedPasteOnly(kb.replace("if (paste && result == DictationCommit.Result.VERIFIED)",
                "if (paste && result == DictationCommit.Result.UNVERIFIED)")));
        rejects(() -> verifiedPasteOnly(kb.replace("completion.accept(result);", "restoreClip(); completion.accept(result);")));
        rejects(() -> savedAndOwnedOnly(kb.replace("saved != null &&", "")));
        rejects(() -> savedAndOwnedOnly(kb.replace("clipLabel.contentEquals(current.getDescription().getLabel())", "true")));
        rejects(() -> savedAndOwnedOnly(kb.replace("ClipRestore.stillOurs(primaryText(clipboard), payload)", "true")));
        rejects(() -> savedAndOwnedOnly(kb.replace("clipboard.setPrimaryClip(saved);",
                "clipboard.setPrimaryClip(ClipData.newPlainText(\"\", \"\"));")));
        rejects(() -> latestCopyCancels(kb.replace("if (k != null) k.cancelClipRestore();", "")));
        rejects(() -> latestCopyCancels(kb.replace("if (r != null) main.removeCallbacks(r);", "")));
    }

    private static void verifiedPasteOnly(String source) {
        String finish = body(compact(source), "voidfinish(DictationCommit.Resultresult)");
        String verified = body(finish, "if(paste&&result==DictationCommit.Result.VERIFIED)");
        assertTrue("restore callback must be created inside the verified-paste branch",
                verified.contains("pendingRestore=()->{pendingRestore=null;restoreClip();};"));
        assertTrue("only that callback is scheduled", verified.contains("main.postDelayed(pendingRestore,500);"));
        assertEquals("no restore bypass outside the verified-paste branch", 1, count(finish, "restoreClip();"));
        assertEquals("no unconditional second scheduling", 1, count(finish, "main.postDelayed("));
        assertFalse("finish must not replace the clip directly", finish.contains("setPrimaryClip("));
        assertFalse("finish must not clear the clip", finish.contains("clearPrimaryClip("));
    }

    private static void savedAndOwnedOnly(String source) {
        String kb = compact(source);
        String restore = body(kb, "voidrestoreClip()");
        String guarded = body(restore, "if(saved!=null&&clipLabel!=null&&current!=null"
                + "&&clipLabel.contentEquals(current.getDescription().getLabel())"
                + "&&ClipRestore.stillOurs(primaryText(clipboard),payload))");
        assertTrue("restore the actual saved clip, never a manufactured blank",
                guarded.contains("clipboard.setPrimaryClip(saved);"));
        assertEquals("no unguarded clipboard replacement", 1, count(restore, "setPrimaryClip("));
        assertFalse("no blank clip after paste", kb.contains("newPlainText(\"\",\"\")"));
        assertFalse("no clearing when no old clip exists", kb.contains("clearPrimaryClip("));
        String start = body(kb, "voidstart()");
        assertTrue("capture the old clip before installing the attempt clip",
                start.indexOf("saved=clipboard.getPrimaryClip();") >= 0
                && start.indexOf("saved=clipboard.getPrimaryClip();") < start.indexOf("clipboard.setPrimaryClip("));
        assertTrue("attempt label must be unique", start.contains("clipLabel=\"Wizarddictation\"+java.util.UUID.randomUUID();"));
    }

    private static void latestCopyCancels(String source) {
        String kb = compact(source);
        String copy = body(kb, "publicstaticvoidcopyAsLatest(android.content.Contextctx,Stringtext)");
        int cancel = copy.indexOf("if(k!=null)k.cancelClipRestore();");
        int write = copy.indexOf("cb.setPrimaryClip(");
        assertTrue("cancel the old restore before writing recovery words", cancel >= 0 && write > cancel);
        assertTrue(copy.contains("newPlainText(\"Wizard\",text)"));
        String cancelBody = body(kb, "privatevoidcancelClipRestore()");
        assertTrue("cancel must remove the captured pending callback, not merely forget it",
                cancelBody.contains("Runnabler=pendingRestore;pendingRestore=null;if(r!=null)main.removeCallbacks(r);"));
        assertTrue("each new attempt also cancels an older restore", body(kb, "voidstart()").startsWith("try{cancelClipRestore();"));
    }

    private static String source(String file) throws Exception {
        return new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"),
                "src/main/java/ai/wizards/os/everywhere/" + file)), StandardCharsets.UTF_8);
    }

    // Ignore formatting/comments, but scope assertions to balanced policy blocks rather than
    // accepting a token anywhere in the service (or a now-unused pure helper's local variable).
    private static String compact(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/|//[^\\r\\n]*", "").replaceAll("\\s+", "");
    }

    private static String body(String source, String header) {
        int start = source.indexOf(header + "{");
        assertTrue("missing policy block: " + header, start >= 0);
        int open = start + header.length(), depth = 1;
        for (int i = open + 1; i < source.length(); i++) {
            if (source.charAt(i) == '{') depth++;
            if (source.charAt(i) == '}' && --depth == 0) return source.substring(open + 1, i);
        }
        throw new AssertionError("unclosed policy block: " + header);
    }

    private static int count(String source, String token) {
        int result = 0;
        for (int i = 0; (i = source.indexOf(token, i)) >= 0; i += token.length()) result++;
        return result;
    }

    private static void rejects(Runnable unsafe) {
        try { unsafe.run(); } catch (AssertionError expected) { return; }
        fail("source guard accepted an unsafe clipboard policy mutation");
    }
}
