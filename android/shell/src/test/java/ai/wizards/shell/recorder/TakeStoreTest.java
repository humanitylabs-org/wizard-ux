package ai.wizards.shell.recorder;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Base64;
import java.util.List;

import static org.junit.Assert.*;

/** Custody: a take leaves the phone only when the Wizard acknowledges it, nothing was said, or a short Cancel. */
public class TakeStoreTest {
    static final String A = "https://a.example.ts.net", B = "https://b.example.ts.net:8444";
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static void bytes(File f, int n) throws Exception {
        try (FileOutputStream o = new FileOutputStream(f, true)) { byte[] b = new byte[n]; for (int i = 0; i < n; i++) b[i] = (byte) i; o.write(b); }
    }

    @Test public void aKilledTakeIsRecoveredAsInterrupted() throws Exception {
        File dir = tmp.newFolder("takes");
        TakeStore s = new TakeStore(dir);
        String id = s.create("voice", "web-1", A, 1000);
        assertTrue(TakeStore.validId(id));
        bytes(s.audio(id), 5000);
        // The process dies here: no finish(). A fresh store (next launch) offers it.
        List<JSONObject> p = new TakeStore(dir).pending(null, A, 2000);
        assertEquals(1, p.size());
        assertEquals(id, p.get(0).getString("id"));
        assertEquals("interrupted", p.get(0).getString("state"));
        assertEquals("web-1", p.get(0).getString("ref"));
        assertEquals(5000, p.get(0).getLong("bytes"));
        assertFalse("origin never leaves native", p.get(0).has("origin"));
        assertTrue(new TakeStore(dir).pending(id, A, 2000).isEmpty()); // the live take is not "pending"
    }

    @Test public void onlyTheWizardThatRecordedCanSeeReadOrRelease() throws Exception {
        TakeStore s = new TakeStore(tmp.newFolder());
        String id = s.create("voice", "", A, 1);
        bytes(s.audio(id), 4000);
        s.finish(id, "stopped", 3000, 2);
        assertTrue(s.pending(null, B, 3).isEmpty());
        assertNull(s.chunk(id, B, 0));
        assertFalse(s.ack(id, B, null));
        assertTrue(s.audio(id).isFile());
        assertEquals(1, s.pending(null, A, 3).size());
    }

    @Test public void readsInChunksThenAckReleases() throws Exception {
        TakeStore s = new TakeStore(tmp.newFolder());
        String id = s.create("voice", "", A, 1);
        int size = TakeStore.CHUNK + 1234;
        bytes(s.audio(id), size);
        JSONObject t = s.finish(id, "stopped", 9000, 2);
        assertEquals(size, t.getLong("bytes"));
        assertEquals("audio/aac", t.getString("mime"));
        JSONObject c1 = s.chunk(id, A, 0);
        assertEquals(TakeStore.CHUNK, Base64.getDecoder().decode(c1.getString("b64")).length);
        assertEquals(TakeStore.CHUNK, c1.getLong("next"));
        JSONObject c2 = s.chunk(id, A, c1.getLong("next"));
        assertEquals(1234, Base64.getDecoder().decode(c2.getString("b64")).length);
        assertEquals(-1, c2.getLong("next"));
        assertEquals(size, c2.getLong("size"));
        assertNull(s.chunk(id, A, size + 1));
        assertNull(s.chunk(id, A, -1));
        assertFalse("never release the live take", s.ack(id, A, id));
        assertTrue(s.ack(id, A, null));
        assertFalse(s.audio(id).exists());
        assertTrue(s.pending(null, A, 3).isEmpty());
        assertFalse(s.ack(id, A, null));
    }

    @Test public void nothingSaidAndShortCancelAreReleasedLongCancelIsKept() throws Exception {
        TakeStore s = new TakeStore(tmp.newFolder());
        String empty = s.create("voice", "", A, 1);
        bytes(s.audio(empty), 100);
        assertTrue(s.finish(empty, "stopped", 500, 2).getBoolean("released"));
        assertFalse(s.audio(empty).exists());

        String quick = s.create("voice", "", A, 1);
        bytes(s.audio(quick), 9000);
        assertTrue(s.finish(quick, "cancelled", TakeStore.KEEP_CANCELLED_MS - 1, 2).getBoolean("released"));
        assertFalse(s.audio(quick).exists());

        String longer = s.create("voice", "", A, 1);
        bytes(s.audio(longer), 9000);
        assertFalse(s.finish(longer, "cancelled", TakeStore.KEEP_CANCELLED_MS, 2).getBoolean("released"));
        List<JSONObject> p = s.pending(null, A, 3);
        assertEquals(1, p.size());
        assertEquals("cancelled", p.get(0).getString("state"));
    }

    @Test public void staleEmptyStartsAreCleanedButFreshOnesLeftAlone() throws Exception {
        TakeStore s = new TakeStore(tmp.newFolder());
        String id = s.create("voice", "", A, 1000);
        assertTrue(s.pending(null, A, 2000).isEmpty());
        assertTrue("just started: kept", s.audio(id).exists());
        assertTrue(s.pending(null, A, 1000 + 61_000).isEmpty());
        assertFalse("a failed start older than a minute holds nothing", s.audio(id).exists());
    }

    @Test public void idsKindsAndRefsAreSanitised() throws Exception {
        for (String bad : new String[]{null, "", "../x", "take-1-ABCDEF01", "take-1-abcdef0", "take-x-abcdef01", "take-1-abcdef01/../../a"})
            assertFalse(String.valueOf(bad), TakeStore.validId(bad));
        TakeStore s = new TakeStore(tmp.newFolder());
        assertNull(s.read("../../etc/passwd"));
        assertNull(s.chunk("../x", A, 0));
        assertEquals("voice", TakeStore.cleanKind("<script>"));
        assertEquals("dictation", TakeStore.cleanKind("dictation"));
        assertEquals("", TakeStore.cleanRef("a b"));
        assertEquals("capture-1:2", TakeStore.cleanRef("capture-1:2"));
        try { s.create("voice", "", null, 1); fail("a take needs its Wizard"); } catch (java.io.IOException expected) { }
        assertEquals("take-5-0123abcd", s.create("take-5-0123abcd", "voice", "", A, 5));
        for (String bad : new String[]{"take-5-0123abcd", "../evil", "take-5-0123ABCD"}) {
            try { s.create(bad, "voice", "", A, 6); fail("accepted " + bad); } catch (java.io.IOException expected) { }
        }
    }
}
