package ai.wizards.os.recording;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import ai.wizards.os.audio.CaptureJournal;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.util.List;

public class RecordingStoreTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static void fill(File f, int n) throws Exception { try (FileOutputStream o = new FileOutputStream(f)) { o.write(new byte[n]); } }

    @Test
    public void aTakeCutShortByAKillIsRecoverable() throws Exception {
        RecordingStore st = new RecordingStore(tmp.newFolder("rec"));
        String id = st.create("auto");
        fill(st.audio(id), 20_000);
        List<JSONObject> p = st.pending(null);
        assertEquals(1, p.size());
        assertEquals("interrupted", p.get(0).getString("state"));
        assertEquals(20_000, p.get(0).getLong("bytes"));
        // while it is the live take, it is not offered
        assertTrue(st.pending(id).isEmpty());
    }

    @Test
    public void claimedHereIsNotOfferedButAClaimFromADeadProcessIs() throws Exception {
        RecordingStore st = new RecordingStore(tmp.newFolder("rec"));
        String id = st.create("auto");
        fill(st.audio(id), 5000);
        st.set(id, "state", "stopped");
        st.claim(id);
        assertTrue(st.pending(null).isEmpty());
        RecordingStore fresh = new RecordingStore(st.audio(id).getParentFile()); // same files, new process
        assertEquals(1, fresh.pending(null).size());
        fresh.delete(id);
        assertTrue(fresh.pending(null).isEmpty());
        assertFalse(st.audio(id).exists());
    }

    @Test
    public void emptyTakesAreNotOffered() throws Exception {
        RecordingStore st = new RecordingStore(tmp.newFolder("rec"));
        String id = st.create("auto");
        fill(st.audio(id), 100);
        assertTrue(st.pending(null).isEmpty());
    }

    /* ---- wizard-ux#1220: stale takes nobody can clear must not block switching Wizards ---- */

    private static final String A = "https://wizard-a.invalid", B = "https://wizard-b.invalid";

    @Test
    public void aTakeClaimedByADeadProcessDoesNotBlockASwitchAndStaysWithItsWizard() throws Exception {
        File dir = tmp.newFolder("rec");
        RecordingStore st = new RecordingStore(dir);
        String id = st.create("auto");
        fill(st.audio(id), 5000);
        st.set(id, "state", "stopped");
        st.claim(id); // the page took it into its outbox, then the app died before recDone
        RecordingStore fresh = new RecordingStore(dir);
        assertEquals("still recoverable by the page", 1, fresh.pending(null, A).size());
        assertTrue("handed to the page: not unsent", fresh.unsent(A).isEmpty());

        assertTrue(fresh.stayWith(A)); // the app moves to Wizard B
        assertTrue("never re-homed to another Wizard", fresh.pending(null, B).isEmpty());
        assertTrue(fresh.unsent(B).isEmpty());
        assertEquals("offered again back on its own Wizard", 1, fresh.pending(null, A).size());
        assertTrue("bytes untouched", st.audio(id).isFile());
    }

    @Test
    public void aTakeNeverHandedToThePageStillBlocks() throws Exception {
        RecordingStore st = new RecordingStore(tmp.newFolder("rec"));
        String id = st.create("auto");
        fill(st.audio(id), 20_000); // interrupted by a kill: only this phone has it
        assertEquals(1, st.unsent(A).size());
        assertEquals(id, st.unsent(A).get(0).getString("id"));
    }

    @Test
    public void aTakeAlreadyKeptInCancelledRecordingsLeavesNoStaleEntry() throws Exception {
        File dir = tmp.newFolder("rec");
        RecordingStore st = new RecordingStore(dir);
        String id = st.create("auto");
        fill(st.audio(id), 5000);
        byte[] bytes = Files.readAllBytes(st.audio(id).toPath());
        CaptureJournal custody = CaptureJournal.at(dir.getParentFile());
        String cid = custody.adopt(st.audio(id), "app");
        custody.release(cid, null); // never handed: kept in Cancelled recordings, original removed
        assertEquals("kept", custody.entry(cid).getString("state"));
        // ...but the original could not be removed and delete() returned before dropping the metadata (the bug)
        Files.write(st.audio(id).toPath(), bytes);
        assertTrue(new File(dir, id + ".json").isFile());

        RecordingStore fresh = new RecordingStore(dir);
        assertTrue("nothing unsent: the bytes are in Cancelled recordings", fresh.pending(null, A).isEmpty());
        assertTrue(fresh.unsent(A).isEmpty());
        assertFalse("stale metadata dropped", new File(dir, id + ".json").exists());
        assertFalse("byte-identical leftover original dropped", st.audio(id).exists());
        assertTrue("the kept copy remains", new File(custody.entry(cid).getString("path")).isFile());
    }

    @Test
    public void deleteDropsTheMetadataOnceTheTakeIsKeptElsewhere() throws Exception {
        File dir = tmp.newFolder("rec");
        RecordingStore st = new RecordingStore(dir);
        String id = st.create("auto");
        fill(st.audio(id), 5000);
        st.delete(id); // never handed, real audio: kept in Cancelled recordings
        assertFalse(new File(dir, id + ".json").exists());
        assertFalse(st.audio(id).exists());
        assertTrue(st.pending(null).isEmpty());
    }

    @Test
    public void differentBytesUnderTheSameNameAreNeverTreatedAsACopy() throws Exception {
        File dir = tmp.newFolder("rec");
        RecordingStore st = new RecordingStore(dir);
        String id = st.create("auto");
        fill(st.audio(id), 5000);
        CaptureJournal custody = CaptureJournal.at(dir.getParentFile());
        custody.release(custody.adopt(st.audio(id), "app"), null);
        fill(st.audio(id), 9000); // other audio now sits at the original path
        assertEquals("still counted, nothing removed", 1, new RecordingStore(dir).unsent(A).size());
        assertTrue(st.audio(id).isFile());
    }

    @Test
    public void anAppCaptureTakeStaysWithItsPageAndDoesNotBlock() throws Exception {
        File dir = tmp.newFolder("rec");
        RecordingStore st = new RecordingStore(dir);
        String id = st.create("app"); // started by an app's capture row, cut short by a kill
        fill(st.audio(id), 20_000);
        assertTrue("its page row recovers it; the voice sheet can't show it", st.unsent(A).isEmpty());
        assertTrue(st.stayWith(A));
        assertTrue(st.pending(null, B).isEmpty());
        assertEquals(1, st.pending(null, A).size());
    }

    @Test
    public void aSwitchIsRefusedWhenATakeCannotBeKeptForItsWizard() throws Exception {
        File dir = tmp.newFolder("rec");
        RecordingStore st = new RecordingStore(dir);
        String id = st.create("auto");
        fill(st.audio(id), 5000);
        st.set(id, "state", "stopped");
        st.claim(id);
        assertTrue(new File(dir, id + ".json.tmp").mkdir()); // the metadata write will fail
        assertFalse(new RecordingStore(dir).stayWith(A));
        assertTrue(new File(dir, id + ".json.tmp").delete());
        assertTrue(new RecordingStore(dir).stayWith(A));
        assertTrue(new RecordingStore(dir).pending(null, B).isEmpty());
    }

    /* ---- wizard-ux#1231: the page settles a take only on positive proof that its audio is gone ---- */

    @Test
    public void audioGoneIsTrueOnlyWhenTheFileIsReallyMissing() throws Exception {
        File dir = tmp.newFolder("rec");
        RecordingStore st = new RecordingStore(dir);
        String id = st.create("app");
        assertTrue("metadata without audio: nothing to claim", st.audioGone(id));
        fill(st.audio(id), 0);
        assertFalse("an empty file is still a file", st.audioGone(id));
        fill(st.audio(id), 3000);
        assertFalse(st.audioGone(id));
        assertTrue("read only", st.audio(id).isFile() && new File(dir, id + ".json").isFile());
        assertTrue("an unknown take has no audio either", st.audioGone("rec-0-unknown"));
        File locked = tmp.newFolder("locked");
        RecordingStore unreadable = new RecordingStore(new File(locked, "rec"));
        String other = unreadable.create("app");
        fill(unreadable.audio(other), 10);
        assertTrue(locked.setExecutable(false, false));
        try { assertFalse("a folder it cannot look into is never called empty", unreadable.audioGone(other)); }
        finally { locked.setExecutable(true, false); }
    }
}
