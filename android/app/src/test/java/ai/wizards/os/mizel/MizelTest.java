package ai.wizards.os.mizel;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.util.TimeZone;

public class MizelTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /* ---------------- WAV ---------------- */

    @Test
    public void wavHeaderIs16kMonoPcm16() {
        byte[] h = Wav.header(160000);
        assertEquals(44, h.length);
        assertTrue(Wav.valid(h));
        assertEquals(160000, Wav.dataSize(h));
        assertEquals(5000, Wav.ms(Wav.samples(160000)));
        assertEquals(80000, Wav.CHUNK_SAMPLES);
        // byte rate 32000, block align 2
        assertEquals(32000, (h[28] & 0xff) | (h[29] & 0xff) << 8 | (h[30] & 0xff) << 16);
        assertEquals(2, h[32]);
    }

    @Test
    public void fixHeaderRepairsATornFile() throws Exception {
        File f = tmp.newFile("x.wav");
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(Wav.header(0)); o.write(new byte[1001]); }
        try (RandomAccessFile r = new RandomAccessFile(f, "rw")) { assertEquals(1000, Wav.fixHeader(r)); }
        assertEquals(1044, f.length());
    }

    /* ---------------- policy ---------------- */

    @Test
    public void policy() {
        assertTrue(MizelPolicy.validMeetingId("mt_0123456789ab"));
        assertTrue(MizelPolicy.validMeetingId("qa_x-1"));
        assertFalse(MizelPolicy.validMeetingId("../etc"));
        assertFalse(MizelPolicy.validMeetingId("a"));
        assertFalse(MizelPolicy.validMeetingId(null));
        assertEquals(2000, MizelPolicy.backoff(1));
        assertEquals(120000, MizelPolicy.backoff(6));
        assertEquals("never gives up", 120000, MizelPolicy.backoff(50));
        assertTrue(MizelPolicy.permanent(404));
        assertFalse(MizelPolicy.permanent(0));
        assertFalse(MizelPolicy.permanent(403));
        assertFalse(MizelPolicy.permanent(503));
        assertEquals("/meetings/api/meetings/m_1/chunks?source=me&seq=3&start_ms=15000", MizelPolicy.chunkPath("m_1", 3, 15000));
        assertEquals("/meetings/api/meetings/m_1/stop", MizelPolicy.stopPath("m_1"));
        assertEquals("{\"final_seq\":{\"me\":7},\"reason\":\"pause_timeout\"}", MizelPolicy.stopBody(7, "pause_timeout"));
        assertEquals("{\"final_seq\":{\"me\":7},\"reason\":\"user\"}", MizelPolicy.stopBody(7, "anything-else"));
        assertTrue(MizelPolicy.stopReady(4, -1));
        assertTrue(MizelPolicy.stopReady(4, 5));
        assertFalse(MizelPolicy.stopReady(4, 4));
        assertFalse(MizelPolicy.prunable(true, 1000, 1000 + MizelPolicy.KEEP_AFTER_READY_MS - 1));
        assertTrue(MizelPolicy.prunable(true, 1000, 1000 + MizelPolicy.KEEP_AFTER_READY_MS));
        assertFalse(MizelPolicy.prunable(false, 1000, Long.MAX_VALUE));
        assertEquals("07:05", MizelPolicy.clock(7 * 3600_000L + 5 * 60_000L, TimeZone.getTimeZone("UTC")));
        assertEquals(30 * 60_000L, MizelPolicy.PAUSE_TIMEOUT_MS);
    }

    /* ---------------- protocol ---------------- */

    @Test
    public void protocolParse() {
        MizelProtocol.Cmd c = MizelProtocol.parse("{\"id\":7,\"cmd\":\"start\",\"meetingId\":\"mt_abc\"}");
        assertNull(c.error);
        assertEquals(7, c.id);
        assertEquals("mt_abc", c.meetingId);
        assertEquals(MizelProtocol.E_BAD_MEETING_ID, MizelProtocol.parse("{\"id\":1,\"cmd\":\"start\"}").error);
        assertEquals(MizelProtocol.E_BAD_MEETING_ID, MizelProtocol.parse("{\"id\":1,\"cmd\":\"start\",\"meetingId\":\"../x\"}").error);
        assertEquals(MizelProtocol.E_UNKNOWN_CMD, MizelProtocol.parse("{\"id\":1,\"cmd\":\"upload\",\"url\":\"https://evil\"}").error);
        assertEquals(MizelProtocol.E_BAD_REQUEST, MizelProtocol.parse("not json").error);
        assertNull(MizelProtocol.parse("{\"id\":\"a\",\"cmd\":\"status\"}").error);
        assertEquals("a", MizelProtocol.parse("{\"id\":\"a\",\"cmd\":\"pause\"}").id);
    }

    @Test
    public void protocolMessages() throws Exception {
        JSONObject st = MizelProtocol.state(true, false, "mt_1", 12345, 2, 0, "recording", 1800000);
        JSONObject r = new JSONObject(MizelProtocol.reply(9, true, null, st));
        assertEquals(9, r.getInt("id"));
        assertTrue(r.getBoolean("ok"));
        assertFalse(r.has("error"));
        assertEquals(12345, r.getJSONObject("status").getLong("mediaMs"));
        JSONObject e = new JSONObject(MizelProtocol.reply("x", false, "mic_busy", null));
        assertEquals("mic_busy", e.getString("error"));
        JSONObject p = new JSONObject(MizelProtocol.statePush(st));
        assertEquals("state", p.getString("type"));
        for (String k : new String[]{"recording", "paused", "meetingId", "mediaMs", "pendingChunks", "pausedMs"}) assertTrue(k, p.has(k));
        JSONObject lv = new JSONObject(MizelProtocol.levelPush(0.5f));
        assertEquals("level", lv.getString("type"));
        assertEquals(0.5, lv.getDouble("me"), 1e-6);
    }

    /* ---------------- store / journal ---------------- */

    private static void writeChunk(MizelStore s, String id, int seq, long samples) throws Exception {
        File t = s.tmpFile(id, seq);
        t.getParentFile().mkdirs();
        try (RandomAccessFile r = new RandomAccessFile(t, "rw")) {
            r.write(Wav.header(samples * 2));
            r.write(new byte[(int) samples * 2]);
        }
        assertTrue(t.renameTo(s.chunkFile(id, seq)));
    }

    @Test
    public void seqAndMediaTimeComeFromTheJournal() throws Exception {
        File root = tmp.newFolder("mizel");
        MizelStore s = new MizelStore(root);
        s.beginSession("mt_a", 1000);
        for (int i = 0; i < 3; i++) {
            int seq = s.currentSeq("mt_a");
            assertEquals(i, seq);
            writeChunk(s, "mt_a", seq, Wav.CHUNK_SAMPLES);
            MizelJournal.Chunk c = s.chunkDone("mt_a", seq, Wav.CHUNK_SAMPLES, 2000 + i);
            assertEquals(i * 5000L, c.startMs);
        }
        // a short chunk at pause, then resume: media time excludes the paused time
        writeChunk(s, "mt_a", 3, 16000);
        s.chunkDone("mt_a", 3, 16000, 3000);
        s.setPaused("mt_a", true, 4000);
        s.setPaused("mt_a", false, 9_000_000);
        writeChunk(s, "mt_a", 4, Wav.CHUNK_SAMPLES);
        assertEquals(16000L, s.chunkDone("mt_a", 4, Wav.CHUNK_SAMPLES, 9_000_100).startMs);
        // a fresh store (new process) continues from the journal
        MizelStore s2 = new MizelStore(root);
        assertEquals(5, s2.currentSeq("mt_a"));
        assertEquals(21000, s2.get("mt_a").mediaMs());
        assertEquals(5, s2.pendingCount("mt_a"));
        s2.acked("mt_a", 0); s2.acked("mt_a", 1);
        MizelJournal j = s2.requestStop("mt_a", "user", 10_000_000);
        assertEquals(4, j.finalSeq);
        assertTrue(j.stopPending());
        assertFalse(MizelPolicy.stopReady(j.finalSeq, j.lowestPendingSeq()));
        s2.acked("mt_a", 2); s2.acked("mt_a", 3); s2.acked("mt_a", 4);
        assertTrue(MizelPolicy.stopReady(j.finalSeq, s2.get("mt_a").lowestPendingSeq()));
        s2.stopSent("mt_a", 10_000_100);
        assertFalse("acked files stay until ready + a day", s2.prune(10_000_200).contains("mt_a"));
        s2.statusChecked("mt_a", 10_000_300, true);
        assertFalse(s2.prune(10_000_300 + 1000).contains("mt_a"));
        assertTrue(s2.chunkFile("mt_a", 0).isFile());
        assertTrue(s2.prune(10_000_300 + MizelPolicy.KEEP_AFTER_READY_MS).contains("mt_a"));
        assertFalse(s2.meetingDir("mt_a").exists());
    }

    @Test
    public void recoverAfterProcessDeathAdoptsFilesAndQueuesProcessDeathStop() throws Exception {
        File root = tmp.newFolder("mizel");
        MizelStore s = new MizelStore(root);
        s.beginSession("mt_b", 1000);
        writeChunk(s, "mt_b", 0, Wav.CHUNK_SAMPLES);
        s.chunkDone("mt_b", 0, Wav.CHUNK_SAMPLES, 2000);
        s.acked("mt_b", 0);
        // seq 1 renamed but not journalled (death between rename and journal), seq 2 torn mid-write
        writeChunk(s, "mt_b", 1, Wav.CHUNK_SAMPLES);
        File torn = s.tmpFile("mt_b", 2);
        try (RandomAccessFile r = new RandomAccessFile(torn, "rw")) { r.write(Wav.header(0)); r.write(new byte[16001]); }
        MizelStore after = new MizelStore(root); // the new process
        assertTrue(after.get("mt_b").recording);
        after.recover("mt_b", 50_000);
        MizelJournal j = after.get("mt_b");
        assertFalse(j.recording);
        assertEquals(MizelPolicy.REASON_PROCESS_DEATH, j.stopReason);
        assertEquals(2, j.finalSeq);
        assertEquals(3, j.nextSeq);
        assertEquals(1, j.acked);
        assertEquals(5000, j.chunk(1).startMs);
        assertEquals(10000, j.chunk(2).startMs);
        assertEquals(8000, j.chunk(2).samples);
        assertTrue(after.chunkFile("mt_b", 2).isFile());
        assertFalse(torn.exists());
        byte[] h = new byte[44];
        try (RandomAccessFile r = new RandomAccessFile(after.chunkFile("mt_b", 2), "r")) { r.readFully(h); }
        assertTrue(Wav.valid(h));
        assertEquals(16000, Wav.dataSize(h));
        // a second recover changes nothing (idempotent)
        new MizelStore(root).recover("mt_b", 60_000);
        assertEquals(2, new MizelStore(root).get("mt_b").finalSeq);
    }

    @Test
    public void startFailureForgetsABrandNewMeeting() throws Exception {
        MizelStore s = new MizelStore(tmp.newFolder("mizel"));
        s.beginSession("mt_c", 1);
        s.abandonSession("mt_c");
        assertNull(s.get("mt_c"));
        assertFalse(s.meetingDir("mt_c").exists());
    }

    @Test
    public void backoffIsPersisted() throws Exception {
        File root = tmp.newFolder("mizel");
        MizelStore s = new MizelStore(root);
        s.beginSession("mt_d", 1);
        writeChunk(s, "mt_d", 0, 100);
        s.chunkDone("mt_d", 0, 100, 2);
        assertEquals(2000, s.chunkFailed("mt_d", 0, 10));
        assertEquals(5000, s.chunkFailed("mt_d", 0, 20));
        MizelJournal.Chunk c = new MizelStore(root).get("mt_d").chunk(0);
        assertNotNull(c);
        assertEquals(2, c.attempts);
        assertEquals(5020, c.nextAt);
        s.resetBackoff();
        assertEquals(0, new MizelStore(root).get("mt_d").chunk(0).nextAt);
    }
}
