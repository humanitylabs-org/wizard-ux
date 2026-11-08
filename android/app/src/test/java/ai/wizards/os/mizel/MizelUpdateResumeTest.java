package ai.wizards.os.mizel;

import static org.junit.Assert.*;
import java.io.File;
import java.io.RandomAccessFile;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class MizelUpdateResumeTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private static final String ID = "mt_update_test", ORIGIN = "https://wizard.example";

    private MizelStore active() throws Exception {
        MizelStore s = new MizelStore(tmp.newFolder());
        s.beginSession(ID, 1000);
        assertTrue(s.noteCapture(ID, 89, ORIGIN));
        return s;
    }

    private void wav(File f, long samples) throws Exception {
        try (RandomAccessFile r = new RandomAccessFile(f, "rw")) {
            r.write(Wav.header(0)); // simulate death before the header was finalised
            r.write(new byte[(int) samples * 2]);
        }
    }

    @Test public void replacementIsNotAnOrdinaryCrash() throws Exception {
        MizelStore s = active();
        assertFalse(MizelUpdatePolicy.interruptedByUpdate(s.snapshot(ID), 89));
        assertTrue(MizelUpdatePolicy.interruptedByUpdate(s.snapshot(ID), 90));
        s.recover(ID, 2000);
        assertFalse(MizelUpdatePolicy.interruptedByUpdate(s.snapshot(ID), 90));
        assertFalse(s.pauseForUpdate(ID, 89, ORIGIN, 3000));
    }

    @Test public void userPausedAndStoppedMeetingsNeverResume() throws Exception {
        MizelStore s = active();
        s.setPaused(ID, true, 2000);
        assertFalse(MizelUpdatePolicy.interruptedByUpdate(s.snapshot(ID), 90));
        assertFalse(s.pauseForUpdate(ID, 89, ORIGIN, 3000));
        s.setPaused(ID, false, 4000);
        assertTrue(s.pauseForUpdate(ID, 89, ORIGIN, 5000));
        s.requestStop(ID, MizelPolicy.REASON_USER, 6000);
        s = new MizelStore(s.root());
        assertFalse(MizelUpdatePolicy.pending(s.snapshot(ID)));
        assertNull(s.updateResumeSnapshot(ID, ORIGIN, 7000));
        assertEquals("user", s.snapshot(ID).stopReason);
    }

    @Test public void finalPartialChunkIsAdoptedAndSequenceAndMediaContinue() throws Exception {
        MizelStore s = active();
        wav(s.chunkFile(ID, 0), Wav.CHUNK_SAMPLES);
        s.chunkDone(ID, 0, Wav.CHUNK_SAMPLES, 2000);
        s.acked(ID, 0);
        wav(s.tmpFile(ID, 1), 16000);
        assertTrue(s.pauseForUpdate(ID, 89, ORIGIN, 3000));
        s = new MizelStore(s.root());
        MizelJournal j = s.updateResumeSnapshot(ID, ORIGIN, 4000);
        assertNotNull(j);
        assertEquals(2, j.nextSeq);
        assertEquals(6000, j.mediaMs());
        assertEquals(1, j.pending.size());
        assertEquals(1, j.pending.get(0).seq);
        assertEquals(5000, j.pending.get(0).startMs);
        assertNull(j.stopReason); // no /stop for an update pause
        assertFalse(j.stopPending());
        assertTrue(s.finishUpdateResume(ID, 90));
        assertFalse(s.finishUpdateResume(ID, 90)); // duplicate restore cannot reset a session
        wav(s.chunkFile(ID, 2), 16000);
        s.chunkDone(ID, 2, 16000, 5000);
        assertEquals(3, s.snapshot(ID).nextSeq);
        assertEquals(7000, s.snapshot(ID).mediaMs());
        assertEquals(90, s.snapshot(ID).captureVersion);
    }

    @Test public void resumeIsBoundToTheExistingOriginAndMeeting() throws Exception {
        MizelStore s = active();
        assertTrue(s.pauseForUpdate(ID, 89, ORIGIN, 2000));
        assertNull(s.updateResumeSnapshot(ID, "https://other.example", 3000));
        assertNull(s.updateResumeSnapshot("mt_not_created", ORIGIN, 3000));
        assertFalse(MizelUpdatePolicy.canResume(null, ORIGIN));
        assertNotNull(s.updateResumeSnapshot(ID, ORIGIN, 3000));
    }

    @Test public void restartAndRepeatedPackageBroadcastKeepTheSamePendingSession() throws Exception {
        MizelStore s = active();
        assertTrue(s.pauseForUpdate(ID, 89, ORIGIN, 2000));
        s = new MizelStore(s.root());
        assertTrue(s.pauseForUpdate(ID, 90, ORIGIN, 3000));
        MizelJournal j = s.snapshot(ID);
        assertTrue(MizelUpdatePolicy.pending(j));
        assertEquals(89, j.captureVersion);
        assertEquals(2000, j.pausedAt);
        assertNull(j.stopReason);
    }

    @Test public void oldJournalsDoNotGuessThatAnOrdinaryCrashWasAnUpdate() throws Exception {
        MizelJournal j = MizelJournal.from(new org.json.JSONObject()
                .put("meetingId", ID).put("recording", true));
        assertFalse(MizelUpdatePolicy.pending(j));
        assertFalse(MizelUpdatePolicy.interruptedByUpdate(j, 90));
        assertFalse(MizelUpdatePolicy.canResume(j, ORIGIN));
    }

    @Test public void updatePauseRefusesFailedJournalPersistence() throws Exception {
        MizelStore s = active();
        File blocked = new File(s.meetingDir(ID), "journal.json.tmp");
        assertTrue(blocked.mkdir()); // cannot open a directory as the atomic-write temp file
        assertFalse(s.pauseForUpdate(ID, 89, ORIGIN, 2000));
        assertFalse(MizelUpdatePolicy.pending(s.snapshot(ID)));
    }
}
