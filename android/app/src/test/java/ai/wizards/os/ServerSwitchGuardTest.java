package ai.wizards.os;

import static org.junit.Assert.*;

import ai.wizards.os.ServerSwitchGuard.Reason;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** The server-switch guard blocks only genuinely unfinished work and names it in plain words. */
public class ServerSwitchGuardTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static final class F implements ServerSwitchGuard.Facts {
        boolean recording, message, share, saved; Reason meeting;
        @Override public boolean recording() { return recording; }
        @Override public boolean messageUnsent() { return message; }
        @Override public boolean sharePending() { return share; }
        @Override public boolean savedRecordingPending() { return saved; }
        @Override public Reason meeting() { return meeting; }
    }

    private File mizel() throws Exception { return tmp.newFolder("mizel"); }

    private File meeting(File root, String id, String journal) throws Exception {
        File d = new File(root, id); assertTrue(new File(d, "me").mkdirs());
        if (journal != null) write(new File(d, "journal.json"), journal);
        return d;
    }
    private static void write(File f, String s) throws Exception {
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(s.getBytes(StandardCharsets.UTF_8)); }
    }
    private static String journal(boolean recording, String pending, String stopReason, boolean stopSent, long readyAt) {
        return "{\"v\":1,\"meetingId\":\"mt_abc\",\"recording\":" + recording + ",\"pending\":" + pending
                + ",\"stopReason\":" + (stopReason == null ? "null" : "\"" + stopReason + "\"") + ",\"stopSent\":" + stopSent
                + ",\"readyAt\":" + readyAt + ",\"nextSeq\":3,\"acked\":3,\"finalSeq\":2}";
    }
    private static final String NONE = "[]", ONE = "[{\"seq\":2,\"startMs\":0,\"samples\":80000}]";

    /* ---- the reported bug: leftovers must not block ---- */

    @Test public void emptyMizelFolderAllows() throws Exception {
        assertNull(ServerSwitchGuard.meetingWork(mizel(), null));
    }
    @Test public void missingMizelFolderAllows() {
        assertNull(ServerSwitchGuard.meetingWork(new File(tmp.getRoot(), "nope"), null));
    }
    @Test public void bareIndexFilesAndEmptyDirsAllow() throws Exception {
        File root = mizel();
        write(new File(root, "index.json"), "{}");
        meeting(root, "mt_empty", null);
        File d = meeting(root, "mt_notes", null);
        write(new File(d, "notes.txt"), "x");
        assertNull(ServerSwitchGuard.meetingWork(root, null));
    }
    @Test public void finishedRetainedMeetingAllows() throws Exception {
        File root = mizel();
        File d = meeting(root, "mt_abc", journal(false, NONE, "user", true, 1_000L));
        write(new File(d, "me/000000.wav"), new String(new byte[2000], StandardCharsets.ISO_8859_1)); // kept audio
        assertNull(ServerSwitchGuard.meetingWork(root, null));
    }
    @Test public void finishedMeetingWithoutReadyStampStillAllows() throws Exception {
        File root = mizel();
        meeting(root, "mt_abc", journal(false, NONE, "user", true, 0));
        assertNull("uploaded and stopped: only the status check is left", ServerSwitchGuard.meetingWork(root, null));
    }

    /* ---- genuinely unfinished meeting work blocks, with the right reason ---- */

    @Test public void unackedChunkBlocksAsUploading() throws Exception {
        File root = mizel();
        meeting(root, "mt_abc", journal(false, ONE, "user", false, 0));
        assertEquals(Reason.MEETING_UPLOAD, ServerSwitchGuard.meetingWork(root, null));
    }
    @Test public void liveOrPausedSessionBlocks() throws Exception {
        File root = mizel();
        meeting(root, "mt_abc", journal(true, NONE, null, false, 0));
        assertEquals(Reason.MEETING_RECORDING, ServerSwitchGuard.meetingWork(root, null));
    }
    @Test public void unsentStopBlocksAsSyncing() throws Exception {
        File root = mizel();
        meeting(root, "mt_abc", journal(false, NONE, "user", false, 0));
        assertEquals(Reason.MEETING_SYNC, ServerSwitchGuard.meetingWork(root, null));
    }
    @Test public void worstMeetingWinsAmongSeveral() throws Exception {
        File root = mizel();
        meeting(root, "mt_done", journal(false, NONE, "user", true, 5));
        meeting(root, "mt_stop", journal(false, NONE, "user", false, 0));
        meeting(root, "mt_live", journal(true, NONE, null, false, 0));
        assertEquals(Reason.MEETING_RECORDING, ServerSwitchGuard.meetingWork(root, null));
    }
    @Test public void unreadableJournalWithAudioBlocksButWithoutAudioAllows() throws Exception {
        File root = mizel();
        File d = meeting(root, "mt_bad", "{not json");
        assertNull(ServerSwitchGuard.meetingWork(root, null));
        write(new File(d, "me/000001.wav.tmp"), new String(new byte[500], StandardCharsets.ISO_8859_1));
        assertEquals("audio on disk is never abandoned", Reason.MEETING_UPLOAD, ServerSwitchGuard.meetingWork(root, null));
    }
    @Test public void audioWithNoJournalBlocks() throws Exception {
        File root = mizel();
        File d = meeting(root, "mt_orphan", null);
        write(new File(d, "me/000000.wav"), new String(new byte[2000], StandardCharsets.ISO_8859_1));
        assertEquals(Reason.MEETING_UPLOAD, ServerSwitchGuard.meetingWork(root, null));
    }

    /* ---- meeting-event (marker) receipts ---- */

    private static JSONObject receipt(String meetingId, long rev, long acked) throws Exception {
        return new JSONObject().put("source", "orb").put("id", "ev1").put("meetingId", meetingId).put("event", "sent")
                .put("atMediaMs", 10).put("rev", rev).put("acked", acked);
    }
    @Test public void unconfirmedMarkerForLocalMeetingBlocksAsSyncing() throws Exception {
        File root = mizel();
        meeting(root, "mt_abc", journal(false, NONE, "user", true, 1));
        assertEquals(Reason.MEETING_SYNC, ServerSwitchGuard.meetingWork(root, Collections.singletonList(receipt("mt_abc", 2, 1))));
    }
    @Test public void confirmedOrStaleMarkerAllows() throws Exception {
        File root = mizel();
        meeting(root, "mt_abc", journal(false, NONE, "user", true, 1));
        assertNull("confirmed", ServerSwitchGuard.meetingWork(root, Collections.singletonList(receipt("mt_abc", 2, 2))));
        assertNull("meeting already pruned from the phone", ServerSwitchGuard.meetingWork(root, Collections.singletonList(receipt("mt_gone", 2, 1))));
    }

    /* ---- the other reasons, and their order ---- */

    @Test public void nothingPendingAllows() {
        assertNull(ServerSwitchGuard.first(new F()));
    }
    @Test public void activeRecordingBlocks() {
        F f = new F(); f.recording = true;
        assertEquals(Reason.RECORDING, ServerSwitchGuard.first(f));
    }
    @Test public void outboxPendingBlocks() {
        F f = new F(); f.message = true;
        assertEquals(Reason.MESSAGE, ServerSwitchGuard.first(f));
    }
    @Test public void sharePendingBlocks() {
        F f = new F(); f.share = true;
        assertEquals(Reason.SHARE, ServerSwitchGuard.first(f));
    }
    @Test public void savedRecordingPendingBlocks() {
        F f = new F(); f.saved = true;
        assertEquals(Reason.SAVED_RECORDING, ServerSwitchGuard.first(f));
    }
    @Test public void meetingReasonPassesThrough() {
        F f = new F(); f.meeting = Reason.MEETING_UPLOAD;
        assertEquals(Reason.MEETING_UPLOAD, ServerSwitchGuard.first(f));
    }
    @Test public void activeRecordingOutranksOtherWork() {
        F f = new F(); f.recording = f.message = f.share = f.saved = true; f.meeting = Reason.MEETING_SYNC;
        assertEquals(Reason.RECORDING, ServerSwitchGuard.first(f));
    }

    /* ---- the words James reads ---- */

    @Test public void everyReasonNamesItselfInPlainWords() {
        List<String> seen = new ArrayList<>();
        for (Reason r : Reason.values()) {
            String s = ServerSwitchGuard.say(r);
            assertTrue(s, s.endsWith("Let it finish, then try again."));
            assertFalse(s, s.contains("Couldn't switch yet. Let any recording or upload finish"));
            assertFalse("distinct", seen.contains(s)); seen.add(s);
        }
        assertEquals("A recording is still in progress. Let it finish, then try again.", ServerSwitchGuard.say(Reason.RECORDING));
        assertEquals("A shared file hasn't been sent yet. Let it finish, then try again.", ServerSwitchGuard.say(Reason.SHARE));
        assertEquals("A meeting is still uploading. Let it finish, then try again.", ServerSwitchGuard.say(Reason.MEETING_UPLOAD));
        assertEquals("A meeting is still syncing. Let it finish, then try again.", ServerSwitchGuard.say(Reason.MEETING_SYNC));
        assertEquals("Couldn't switch just now. Try again.", ServerSwitchGuard.say(null));
    }
}
