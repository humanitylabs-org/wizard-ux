package ai.wizards.os.recording;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
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
}
