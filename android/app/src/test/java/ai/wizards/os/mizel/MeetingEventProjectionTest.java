package ai.wizards.os.mizel;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/** Native loan receipts → the meeting transcript markers (PUT /mizel-live/orb-events). */
public class MeetingEventProjectionTest {
    static JSONObject receipt() throws Exception {
        return new JSONObject().put("id", "orb-1b2c3d4e").put("meetingId", "mt_74d9bc5e8f8e").put("voiceTakeId", "wos-dict-abc12345")
                .put("atMediaMs", 61_000).put("pausedAt", 1_792_311_890_064L).put("pausedByHandoff", true)
                .put("status", "capturing").put("open", true).put("rev", 3);
    }

    @Test
    public void inAppOrbReceiptsAreLeftToTheShellJournal() throws Exception {
        assertNull("no source: written by the in-app orb, projected by orb-handoff.js", MeetingEventProjection.body(receipt()));
        assertFalse(MeetingEventProjection.pending(receipt()));
    }

    @Test
    public void voiceTypingBecomesALocalDictationMarker() throws Exception {
        JSONObject r = receipt().put("source", "everywhere").put("kind", "dictation").put("target", "Messages")
                .put("event", "local").put("text", "see you at five").put("endedAt", 1_792_311_895_000L);
        JSONObject b = MeetingEventProjection.body(r);
        assertNotNull(b);
        assertEquals("local", b.getString("status"));
        assertEquals("dictation", b.getString("kind"));
        assertEquals("Messages", b.getString("target"));
        assertEquals("Voice typing into Messages · see you at five", b.getString("question"));
        assertEquals("native-mt_74d9bc5e8f8e", b.getString("captureId"));
        assertEquals(61_000, b.getLong("atMediaMs"));
        assertEquals(3, b.getLong("clientRevision"));
        assertEquals("wos-dict-abc12345", b.getString("voiceTakeId"));
        assertFalse("dictation is never a delivery", b.has("deliveryKey"));
        assertTrue(MeetingEventProjection.pending(r));
        r.put("acked", 3);
        assertFalse("server confirmed this revision", MeetingEventProjection.pending(r));
        r.put("rev", 4);
        assertTrue("a newer note posts again", MeetingEventProjection.pending(r));
    }

    @Test
    public void voiceTypingMarkerBeforeWordsAndWhenCopied() throws Exception {
        JSONObject r = receipt().put("source", "everywhere").put("kind", "dictation").put("event", "captured");
        assertEquals("Voice typing", MeetingEventProjection.body(r).getString("question"));
        r.put("text", "hello").put("inserted", "copied").put("target", "Chrome");
        assertEquals("Voice typing into Chrome (copied) · hello", MeetingEventProjection.body(r).getString("question"));
    }

    @Test
    public void askCarriesTheThreadLinkForAskedArchimedes() throws Exception {
        JSONObject r = receipt().put("source", "side").put("kind", "ask").put("event", "sent").put("text", "what did we agree")
                .put("threadId", "wizard_1792_abc").put("runId", "wizardq_1").put("deliveryKey", "wos-side-xyz98765").put("audioFileId", "drop_1");
        JSONObject b = MeetingEventProjection.body(r);
        assertEquals("sent", b.getString("status"));
        assertEquals("ask", b.getString("kind"));
        assertEquals("what did we agree", b.getString("question"));
        assertEquals("wizard_1792_abc", b.getString("threadId"));
        assertEquals("wos-side-xyz98765", b.getString("deliveryKey"));
        assertEquals("drop_1", b.getString("audioFileId"));
        assertFalse(b.getBoolean("steered"));
    }

    @Test
    public void unknownOrUnsafeValuesAreNotPosted() throws Exception {
        assertNull(MeetingEventProjection.body(receipt().put("source", "everywhere").put("event", "answered")));
        assertNull(MeetingEventProjection.body(receipt().put("source", "everywhere").put("event", "local").put("meetingId", "../x")));
        JSONObject b = MeetingEventProjection.body(receipt().put("source", "everywhere").put("event", "queued").put("threadId", "bad id!"));
        assertFalse(b.has("threadId"));
    }

    @Test
    public void readBackMustMatchIdentityAndRevision() throws Exception {
        JSONObject sent = MeetingEventProjection.body(receipt().put("source", "everywhere").put("event", "paused"));
        JSONObject saved = new JSONObject(sent.toString());
        assertTrue(MeetingEventProjection.confirms(saved, sent));
        assertFalse(MeetingEventProjection.confirms(new JSONObject(sent.toString()).put("clientRevision", 2), sent));
        assertFalse(MeetingEventProjection.confirms(new JSONObject(sent.toString()).put("captureId", "other"), sent));
        assertFalse(MeetingEventProjection.confirms(null, sent));
    }

    @Test
    public void mergeKeepsLoanFieldsAndDeletesOnNull() throws Exception {
        JSONObject m = MeetingEventProjection.merge(receipt().put("source", "everywhere").put("error", "x"),
                new JSONObject().put("status", "recording").put("error", JSONObject.NULL));
        assertEquals("recording", m.getString("status"));
        assertEquals("everywhere", m.getString("source"));
        assertFalse(m.has("error"));
        assertEquals("orb-1b2c3d4e", m.getString("id"));
    }
}
