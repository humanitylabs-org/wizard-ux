package ai.wizards.os.mizel;

import static org.junit.Assert.*;

import java.io.File;
import java.io.RandomAccessFile;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * wizard-ux#1724: a phone recording must not end for good when the app process dies mid-meeting. The store keeps an
 * actively capturing meeting open as a durable pause (same meeting, next seq, same media time, no /stop), and only
 * ends it with process_death when it can't continue.
 */
public class MizelProcessDeathResumeTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private static final String ID = "mt_death_test", ORIGIN = "https://wizard.example";
    private static final long LIMIT = MizelPolicy.PAUSE_TIMEOUT_MS;

    private MizelStore active(long at) throws Exception {
        MizelStore s = new MizelStore(tmp.newFolder());
        s.beginSession(ID, at);
        assertTrue(s.noteCapture(ID, 122, ORIGIN));
        return s;
    }

    private void wav(File f, long samples) throws Exception {
        try (RandomAccessFile r = new RandomAccessFile(f, "rw")) {
            r.write(Wav.header(0)); // the process died before the header was finalised
            r.write(new byte[(int) samples * 2]);
        }
    }

    @Test public void processDeathKeepsTheSameMeetingOpenAndContinuesSeqAndMediaTime() throws Exception {
        long t0 = System.currentTimeMillis() - 10_000;
        MizelStore s = active(t0);
        wav(s.chunkFile(ID, 0), Wav.CHUNK_SAMPLES);
        s.chunkDone(ID, 0, Wav.CHUNK_SAMPLES, t0 + 5_000);
        s.acked(ID, 0);
        wav(s.chunkFile(ID, 1), Wav.CHUNK_SAMPLES);
        s.chunkDone(ID, 1, Wav.CHUNK_SAMPLES, t0 + 10_000);
        wav(s.tmpFile(ID, 2), 16_000); // torn chunk being written when the process died

        MizelStore after = new MizelStore(s.root()); // the new process
        long now = System.currentTimeMillis() + 1_300; // the new process starts ~1.3 s after the death
        assertTrue(after.pauseForProcessDeath(ID, ORIGIN, "low_memory", now, LIMIT));
        MizelJournal j = after.snapshot(ID);
        assertTrue("same session stays open", j.recording);
        assertTrue(j.paused);
        assertTrue(MizelUpdatePolicy.pending(j));
        assertTrue(MizelUpdatePolicy.afterProcessDeath(j));
        assertNull("no /stop is queued for a process death any more", j.stopReason);
        assertFalse(j.stopPending());
        assertEquals("low_memory", j.exitReason);
        assertEquals("torn chunk adopted; next seq continues", 3, j.nextSeq);
        assertEquals(11_000, j.mediaMs());
        assertTrue("pause dated at the death, not when it was found", j.pausedAt <= now);

        // Reload (e.g. the Activity opens after a job ran) and resume like the visible Activity does.
        after = new MizelStore(after.root());
        MizelJournal r = after.updateResumeSnapshot(ID, ORIGIN, now + 1_000);
        assertNotNull(r);
        assertTrue(after.finishUpdateResume(ID, 122));
        MizelJournal live = after.snapshot(ID);
        assertFalse(MizelUpdatePolicy.pending(live));
        assertEquals("", live.resumeCause);
        assertTrue(live.recording);
        assertFalse(live.paused);
        wav(after.chunkFile(ID, 3), Wav.CHUNK_SAMPLES);
        MizelJournal.Chunk c = after.chunkDone(ID, 3, Wav.CHUNK_SAMPLES, now + 6_000);
        assertNotNull(c);
        assertEquals("start_ms continues from the stored media time", 11_000, c.startMs);
        assertEquals(4, after.snapshot(ID).nextSeq);
    }

    @Test public void pausedStoppedOrStaleMeetingsAreNotKeptOpen() throws Exception {
        long t0 = System.currentTimeMillis() - 5_000;
        MizelStore s = active(t0);
        s.setPaused(ID, true, t0 + 1_000); // the owner's own pause
        assertFalse(s.pauseForProcessDeath(ID, ORIGIN, "", t0 + 2_000, LIMIT));
        assertFalse(MizelUpdatePolicy.pending(s.snapshot(ID)));

        s.setPaused(ID, false, t0 + 3_000);
        s.requestStop(ID, MizelPolicy.REASON_USER, t0 + 4_000); // the owner's Stop
        assertFalse(s.pauseForProcessDeath(ID, ORIGIN, "", t0 + 5_000, LIMIT));
        assertEquals(MizelPolicy.REASON_USER, s.snapshot(ID).stopReason);

        // Audio that ended longer ago than the pause limit is a meeting that is over.
        MizelStore old = new MizelStore(tmp.newFolder());
        long then = System.currentTimeMillis() - LIMIT - 60_000;
        old.beginSession(ID, then);
        assertTrue(old.noteCapture(ID, 122, ORIGIN));
        assertFalse(old.pauseForProcessDeath(ID, ORIGIN, "", System.currentTimeMillis(), LIMIT));
        assertFalse(MizelUpdatePolicy.pending(old.snapshot(ID)));
    }

    @Test public void unresumedPauseEndsWithProcessDeathAtTheDeathTime() throws Exception {
        long t0 = System.currentTimeMillis() - 20_000;
        MizelStore s = active(t0);
        wav(s.chunkFile(ID, 0), Wav.CHUNK_SAMPLES);
        s.chunkDone(ID, 0, Wav.CHUNK_SAMPLES, t0 + 5_000);
        long found = t0 + 6_000;
        assertTrue(s.pauseForProcessDeath(ID, ORIGIN, "signaled", found, LIMIT));
        MizelJournal j = s.snapshot(ID);
        assertFalse(MizelUpdatePolicy.expiredAfterDeath(j, j.pausedAt + LIMIT - 1, LIMIT));
        assertTrue(MizelUpdatePolicy.expiredAfterDeath(j, j.pausedAt + LIMIT, LIMIT));
        long diedAt = j.pausedAt;
        long ended = s.recover(ID, j.pausedAt + LIMIT + 5_000);
        j = s.snapshot(ID);
        assertFalse(j.recording);
        assertEquals(MizelPolicy.REASON_PROCESS_DEATH, j.stopReason);
        assertEquals(0, j.finalSeq);
        assertEquals("", j.resumeCause);
        assertEquals("ended when the audio ended, not when the limit passed", diedAt, ended);
    }

    @Test public void updatePauseKeepsItsOwnCauseAndOldJournalsReadAsUpdates() throws Exception {
        MizelStore s = active(1_000);
        assertTrue(s.pauseForUpdate(ID, 122, ORIGIN, 2_000));
        assertEquals(MizelUpdatePolicy.CAUSE_UPDATE, s.snapshot(ID).resumeCause);
        assertFalse(MizelUpdatePolicy.afterProcessDeath(s.snapshot(ID)));
        // A journal written by 0.10.58 (no resumeCause) that was paused for an update stays an update pause.
        org.json.JSONObject legacy = s.snapshot(ID).json();
        legacy.remove("resumeCause");
        legacy.remove("exitReason");
        MizelJournal old = MizelJournal.from(legacy);
        assertEquals(MizelUpdatePolicy.CAUSE_UPDATE, old.resumeCause);
        assertFalse(MizelUpdatePolicy.afterProcessDeath(old));
        // pauseForProcessDeath never turns an update pause into something else.
        assertTrue(s.pauseForProcessDeath(ID, ORIGIN, "crash", 3_000, LIMIT));
        assertEquals(MizelUpdatePolicy.CAUSE_UPDATE, s.snapshot(ID).resumeCause);
    }

    @Test public void spokenSpans() {
        assertEquals("12 seconds", MizelPolicy.spoken(12_400));
        assertEquals("1 minute", MizelPolicy.spoken(61_000));
        assertEquals("30 minutes", MizelPolicy.spoken(LIMIT));
    }
}
