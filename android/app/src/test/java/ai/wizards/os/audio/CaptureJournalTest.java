package ai.wizards.os.audio;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.Assert.*;

public class CaptureJournalTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private File audio(File root, String name) throws Exception {
        File f = new File(root, name);
        assertTrue(f.getParentFile().isDirectory() || f.getParentFile().mkdirs());
        byte[] bytes = new byte[4096];
        for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) (i % 127);
        Files.write(f.toPath(), bytes);
        return f;
    }
    private CaptureJournal journal(File root, File file) {
        CaptureJournal j = new CaptureJournal(root);
        j.register("take", "app", "note", file, 123);
        return j;
    }
    private void kept(CaptureJournal j, String id, byte[] expected) throws Exception {
        JSONObject e = j.entry(id);
        assertEquals("kept", e.getString("state"));
        assertEquals("cancelled-takes", e.getString("owner"));
        File kept = new File(e.getString("path"));
        assertEquals("cancelled", kept.getParentFile().getName());
        assertArrayEquals(expected, Files.readAllBytes(kept.toPath()));
    }

    @Test public void stateMachineRequiresAdapterThenServerReceipt() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac");
        CaptureJournal j = journal(root, f);
        assertThrows(IllegalStateException.class, () -> j.transition("take", "delivered", new JSONObject()));
        j.transition("take", "stopped", null);
        assertThrows(IllegalArgumentException.class, () -> j.transition("take", "handed", null));
        j.hand("take", "web-outbox");
        assertThrows(IllegalArgumentException.class, () -> j.transition("take", "delivered", null));
        assertThrows(IllegalStateException.class, () -> j.transition("take", "recording", null));
        j.received("take", "wizard-file:abc");
        assertTrue(f.exists()); // A receipt alone does not delete bytes (meetings retain them for a day).
        assertTrue(j.release("take", CaptureJournal.Reason.SERVER_RECEIPT));
        assertFalse(f.exists());
        assertEquals(2, j.entry("take").getJSONArray("receipts").length());
        assertEquals("[]", j.status());
        assertEquals("delivered", new CaptureJournal(root).entry("take").getString("state"));
    }

    @Test public void serverReasonWithoutReceiptKeepsOriginal() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac");
        byte[] bytes = Files.readAllBytes(f.toPath()); CaptureJournal j = journal(root, f);
        assertTrue(j.release("take", CaptureJournal.Reason.SERVER_RECEIPT));
        kept(j, "take", bytes);
    }

    @Test public void unspecifiedReasonKeepsEvenTinyUnheardAudio() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac");
        Files.write(f.toPath(), new byte[]{1}); CaptureJournal j = journal(root, f);
        assertTrue(j.release("take", null)); kept(j, "take", new byte[]{1});
        assertTrue(j.release("take", null)); // idempotent; never delete the kept file
        kept(new CaptureJournal(root), "take", new byte[]{1});
    }

    @Test public void discardReasonRequiresAnExplicitDecision() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac");
        byte[] bytes = Files.readAllBytes(f.toPath()); CaptureJournal j = journal(root, f);
        j.release("take", CaptureJournal.Reason.USER_DISCARD);
        kept(j, "take", bytes);
    }

    @Test public void explicitShortCancelDiscards() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac"); CaptureJournal j = journal(root, f);
        j.stopped("take"); j.userDiscard("take", 14_999);
        assertTrue(j.release("take", CaptureJournal.Reason.USER_DISCARD));
        assertFalse(f.exists()); assertEquals("discarded", j.entry("take").getString("state"));
    }

    @Test public void explicitLongCancelIsKeptAtThePolicyBoundary() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac");
        byte[] bytes = Files.readAllBytes(f.toPath()); CaptureJournal j = journal(root, f);
        assertTrue(j.cancel(f, "app", 15_000)); kept(j, "take", bytes);
    }

    @Test public void meetingPruneRequiresAckAndReadyDeadline() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "chunk.wav"); CaptureJournal j = new CaptureJournal(root);
        j.register("m/000000", "meeting", "meeting_chunk", f, 1);
        j.hand("m/000000", "mizel-uploader"); j.received("m/000000", "mizel-chunk:m/0");
        j.ready("m/000000", System.currentTimeMillis() - 86_400_001L, 86_400_000L);
        assertTrue(j.release("m/000000", CaptureJournal.Reason.MEETING_PRUNE_AFTER_READY)); assertFalse(f.exists());
    }

    @Test public void meetingNotReadyIsKeptInsteadOfPruned() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "chunk.wav"); byte[] bytes = Files.readAllBytes(f.toPath());
        CaptureJournal j = new CaptureJournal(root); j.register("chunk", "meeting", "meeting_chunk", f, 1);
        j.hand("chunk", "mizel-uploader"); j.received("chunk", "mizel-chunk:m/0");
        j.ready("chunk", System.currentTimeMillis(), 86_400_000L);
        j.release("chunk", CaptureJournal.Reason.MEETING_PRUNE_AFTER_READY); kept(j, "chunk", bytes);
    }

    @Test public void rejectedMeetingChunkCannotAcquirePruneAuthority() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "chunk.wav"); byte[] bytes = Files.readAllBytes(f.toPath());
        CaptureJournal j = new CaptureJournal(root); j.register("chunk", "meeting", "meeting_chunk", f, 1);
        j.hand("chunk", "mizel-uploader"); j.ready("chunk", 1, 0);
        j.release("chunk", CaptureJournal.Reason.MEETING_PRUNE_AFTER_READY); kept(j, "chunk", bytes);
    }

    @Test public void verifiedCopyRetainsIdentityAndCustodyState() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac"); CaptureJournal j = journal(root, f);
        File target = new File(root, "outbox.aac"); j.stopped("take"); j.transfer("take", target);
        assertFalse(f.exists()); assertTrue(target.exists());
        assertEquals("take", j.idFor(target)); assertEquals("stopped", j.entry("take").getString("state"));
        assertEquals(target.getAbsolutePath(), new CaptureJournal(root).entry("take").getString("path"));
    }

    @Test public void wrongCopyIsNotPermissionToDelete() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac"), other = audio(root, "copy.aac");
        byte[] bytes = Files.readAllBytes(f.toPath()); byte[] wrong = bytes.clone(); wrong[23] ^= 1;
        Files.write(other.toPath(), wrong); CaptureJournal j = journal(root, f);
        j.release("take", CaptureJournal.Reason.SUPERSEDED_COPY, other); kept(j, "take", bytes);
        assertArrayEquals(wrong, Files.readAllBytes(other.toPath()));
    }

    @Test public void interruptedCopyNeverOverwritesExistingDifferentBytes() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac"), other = audio(root, "copy.aac");
        Files.write(other.toPath(), new byte[]{5}); CaptureJournal j = journal(root, f);
        assertThrows(IOException.class, () -> j.transfer("take", other));
        assertTrue(f.exists()); assertArrayEquals(new byte[]{5}, Files.readAllBytes(other.toPath()));
    }

    @Test public void recoveryRetainsAllNonterminalStatesAndIgnoresTornIndexTemp() throws Exception {
        File root = tmp.newFolder(); CaptureJournal j = new CaptureJournal(root);
        for (String state : new String[]{"recording", "stopped", "handed"}) {
            File f = audio(root, state + ".aac"); j.register(state, "side", "note", f, 10);
            if (!"recording".equals(state)) j.stopped(state);
            if ("handed".equals(state)) j.hand(state, "everywhere-outbox");
        }
        Files.write(new File(root, "capture-journal.json.tmp").toPath(), "[torn".getBytes(StandardCharsets.UTF_8));
        CaptureJournal after = new CaptureJournal(root);
        assertEquals(3, new JSONArray(after.status()).length());
        for (String state : new String[]{"recording", "stopped", "handed"}) {
            assertEquals(state, after.entry(state).getString("state")); assertTrue(new File(root, state + ".aac").exists());
        }
    }

    @Test public void legacyAdoptionPreservesAdapterIdsAndPathsWithoutMovingBytes() throws Exception {
        File root = tmp.newFolder();
        File app = audio(root, "recordings/rec-original.aac");
        File outbox = audio(root, "everywhere/audio/wos-side-original.aac");
        File chunk = audio(root, "mizel/mt_original/me/000004.wav");
        File torn = audio(root, "mizel/mt_original/me/000005.wav.tmp");
        File duplicate = audio(root, "mizel/mt_original/me/000004.wav.tmp");
        JSONObject item = new JSONObject().put("id", "wos-side-original").put("source", "side")
                .put("audioPath", outbox.getAbsolutePath()).put("createdAt", 99);
        Files.write(new File(root, "everywhere/outbox.json").toPath(), new JSONArray().put(item).toString().getBytes(StandardCharsets.UTF_8));
        CaptureJournal j = new CaptureJournal(root);
        assertEquals("rec-original", j.idFor(app)); assertEquals("wos-side-original", j.idFor(outbox));
        assertEquals("mt_original/000004", j.idFor(chunk)); assertEquals("mt_original/000005", j.idFor(torn));
        assertEquals("mt_original/000004.tmp", j.idFor(duplicate));
        for (File f : Arrays.asList(app, outbox, chunk, torn, duplicate)) assertTrue(f.exists());
        assertEquals(5, new JSONArray(j.status()).length());
        assertEquals(5, new JSONArray(new CaptureJournal(root).status()).length());
    }

    @Test public void processDeathBetweenChunkRenameAndJournalUpdateKeepsSameId() throws Exception {
        File root = tmp.newFolder(); CaptureJournal j = new CaptureJournal(root);
        File torn = audio(root, "mizel/mt_original/me/000001.wav.tmp");
        j.register("mt_original/000001", "meeting", "meeting_chunk", torn, 1);
        File done = new File(torn.getParentFile(), "000001.wav"); assertTrue(torn.renameTo(done));
        CaptureJournal after = new CaptureJournal(root);
        assertEquals("mt_original/000001", after.idFor(done)); assertTrue(done.exists());
        assertEquals(1, new JSONArray(after.status()).length());
    }

    @Test public void journalWriteFailureCannotDeleteTheOriginal() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac"); CaptureJournal j = journal(root, f);
        j.hand("take", "web-outbox"); j.received("take", "wizard-file:test");
        assertTrue(new File(root, "capture-journal.json.tmp").mkdir());
        assertThrows(java.io.UncheckedIOException.class, () -> j.release("take", CaptureJournal.Reason.SERVER_RECEIPT));
        assertTrue(f.exists()); assertEquals("delivered", new CaptureJournal(root).entry("take").getString("state"));
    }

    @Test public void failedKeepDoesNotHideOrDeleteTheOriginal() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac"); CaptureJournal j = journal(root, f);
        Files.write(new File(root, "cancelled").toPath(), new byte[]{1});
        assertFalse(j.release("take", null)); assertTrue(f.exists());
        assertEquals("recording", j.entry("take").getString("state"));
    }

    @Test public void statusIsReadOnlyAndContainsOnlyThePublicContract() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac"); CaptureJournal j = journal(root, f);
        byte[] before = Files.readAllBytes(new File(root, "capture-journal.json").toPath());
        JSONObject row = new JSONArray(j.status()).getJSONObject(0);
        assertEquals(7, row.length()); assertEquals(4096, row.getLong("bytes"));
        assertEquals("app", row.getString("source")); assertEquals("note", row.getString("kind"));
        assertFalse(row.has("path")); assertFalse(row.has("receipts"));
        assertArrayEquals(before, Files.readAllBytes(new File(root, "capture-journal.json").toPath()));
    }

    @Test public void noReleaseReasonCanDestroyAnAlreadyKeptOriginal() throws Exception {
        File root = tmp.newFolder(), f = audio(root, "take.aac");
        byte[] bytes = Files.readAllBytes(f.toPath()); CaptureJournal j = journal(root, f);
        j.release("take", null);
        for (CaptureJournal.Reason reason : CaptureJournal.Reason.values()) {
            j.release("take", reason); kept(j, "take", bytes);
        }
    }

    // Match every direct zero-argument File.delete, not only today's names: future renamed variables fail too.
    private static final Pattern DELETE = Pattern.compile("(?:[\\w.]+\\([^;{}\\n]*?\\)|[\\w.]+)\\s*\\.\\s*delete\\s*\\(\\s*\\)");
    private static List<String> deletes(String source) {
        source = source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
        Matcher m = DELETE.matcher(source); List<String> out = new ArrayList<>();
        while (m.find()) out.add(m.group().replaceAll("\\s+", ""));
        Collections.sort(out); return out;
    }
    private static void allow(Map<String, List<String>> map, String name, String... calls) {
        List<String> sorted = new ArrayList<>(Arrays.asList(calls)); Collections.sort(sorted); map.put(name, sorted);
    }

    @Test public void sourceGuardRejectsRecordingDeletionIncludingRenamedVariables() {
        assertFalse(deletes("recording.delete();").isEmpty());
        assertFalse(deletes("audio(id).delete();").isEmpty());
        assertFalse(deletes("new File(it.audioPath).delete();").isEmpty());
        assertFalse(deletes("someNewChunkVariable . delete ( );").isEmpty());
        assertTrue(deletes("RecordingStore.get(c).delete(id);").isEmpty()); // adapter method, not File.delete
    }

    @Test public void sourceGuardAllowsOnlyReviewedNonRecordingDeletes() throws Exception {
        Path base = Path.of("src/main/java");
        if (!Files.isDirectory(base)) base = Path.of("app/src/main/java");
        assertTrue("Run from Android project/app directory", Files.isDirectory(base));
        Map<String, List<String>> allowed = new HashMap<>();
        // Metadata / screenshots only (not an exception for a whole class or arbitrary variable names).
        allow(allowed, "recording/RecordingStore.java", "meta(id).delete()");
        allow(allowed, "everywhere/EverywhereOutbox.java", "File(it.shots.optString(i)).delete()");
        allow(allowed, "Carry.java", "tmp.delete()", "file(c).delete()"); // carry JSON
        allow(allowed, "mizel/MizelStore.java", "f.delete()"); // guarded non-audio metadata/empty directories
        // Shared/imported attachments are not native recorder output; their own delivery custody is unchanged.
        allow(allowed, "share/ShareStore.java", "f.delete()", "d.delete()");
        allow(allowed, "share/ShareQueue.java", "f.delete()", "f.delete()", "d.delete()");
        allow(allowed, "share/ShareUploader.java", "out.delete()");
        allow(allowed, "share/ShareActivity.java", "out.delete()", "out.delete()");
        // APK/update archives and outgoing shared-file copies, never recording/chunk files.
        allow(allowed, "update/Updater.java", "f.delete()", "x.delete()", "f.delete()");
        allow(allowed, "apps/AppsInstaller.java", "f.delete()", "file(app,sha).delete()");
        allow(allowed, "MainActivity.java", "f.delete()", "d.delete()");
        final Path root = base;
        try (Stream<Path> paths = Files.walk(root)) {
            for (Path file : (Iterable<Path>) paths.filter(p -> p.toString().endsWith(".java"))::iterator) {
                String name = root.relativize(file).toString().replace(File.separatorChar, '/').replaceFirst("^ai/wizards/os/", "");
                if (name.equals("audio/CaptureJournal.java") || name.equals("recording/CancelledTakes.java")) continue;
                String text = Files.readString(file);
                assertFalse(name + " bypasses File.delete guard", text.matches("(?s).*Files\\s*\\.\\s*delete(IfExists)?\\s*\\(.*"));
                assertEquals(name, allowed.getOrDefault(name, Collections.emptyList()), deletes(text));
                if (name.equals("mizel/MizelStore.java")) {
                    assertTrue(text.contains("if (CaptureJournal.isAudio(f)) {"));
                    assertTrue(text.contains("custody.releaseFile(f, \"meeting\", reason);\n            return;"));
                }
            }
        }
    }
}
