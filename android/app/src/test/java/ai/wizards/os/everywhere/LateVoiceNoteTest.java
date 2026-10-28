package ai.wizards.os.everywhere;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

/** Uses the actual persisted Item transition used immediately before native run admission. */
public class LateVoiceNoteTest {
    private static final long NOW = 1_800_000_000_000L;

    private EverywhereOutbox.Item note(long age) {
        EverywhereOutbox.Item it = new EverywhereOutbox.Item();
        it.id = "wos-ev-original-key"; it.sessionId = "wizard_original_thread";
        it.createdAt = NOW - age; it.text = "words recorded days ago";
        it.audioPath = "/private/retained.aac";
        return it;
    }

    // a voice note recorded days ago asks before sending
    @Test public void a_voice_note_recorded_days_ago_asks_before_sending() throws Exception {
        EverywhereOutbox.Item it = note(3 * 24 * 60 * 60 * 1000L);
        it.body = "frozen unaccepted request"; // having prepared bytes is not a server receipt
        assertTrue(it.holdLate(NOW));
        assertEquals("held", it.state); assertTrue(it.lateHeld); assertFalse(it.lateSendApproved);
        assertTrue(it.error.startsWith("Recorded ")); assertTrue(it.error.endsWith(" · not sent yet"));
        assertEquals("/private/retained.aac", it.audioPath);
        EverywhereOutbox.Item reloaded = EverywhereOutbox.Item.from(new JSONObject(it.json().toString()));
        assertEquals("held", reloaded.state); assertTrue(reloaded.lateHeld);
        assertFalse(reloaded.lateSendApproved); assertTrue(reloaded.publicJson().getBoolean("lateHeld"));
        assertEquals(it.createdAt, reloaded.publicJson().getLong("createdAt"));
        assertFalse("no private file paths in shell projection", reloaded.publicJson().has("audioPath"));
    }

    @Test public void fresh_item_sends_without_a_hold() {
        assertFalse(note(EverywherePolicy.LATE_MESSAGE_MS - 1).holdLate(NOW));
        assertFalse(note(EverywherePolicy.LATE_MESSAGE_MS).holdLate(NOW));
        assertTrue(note(EverywherePolicy.LATE_MESSAGE_MS + 1).holdLate(NOW));
    }

    @Test public void approved_sends_once_and_retains_original_delivery_identity() throws Exception {
        EverywhereOutbox.Item it = note(3 * 24 * 60 * 60 * 1000L);
        it.body = "frozen original request";
        assertTrue(it.holdLate(NOW)); assertTrue(it.approveLate());
        assertFalse("double Send before pump cannot claim the item again", it.approveLate());
        assertEquals("waiting", it.state); assertFalse(it.holdLate(NOW));
        EverywhereOutbox.Item reloaded = EverywhereOutbox.Item.from(new JSONObject(it.json().toString()));
        assertTrue(reloaded.lateSendApproved); assertFalse(reloaded.holdLate(NOW + 24 * 60 * 60 * 1000L));
        assertEquals("wos-ev-original-key", reloaded.id); assertEquals("wizard_original_thread", reloaded.sessionId);
        assertEquals("frozen original request", reloaded.body);
        reloaded.runId = "accepted-run"; reloaded.sentAt = NOW; reloaded.state = "sent";
        assertFalse(reloaded.approveLate()); assertFalse(reloaded.holdLate(NOW));
    }

    @Test public void dictation_and_already_accepted_items_are_unchanged() {
        EverywhereOutbox.Item dictation = note(3 * 24 * 60 * 60 * 1000L);
        dictation.source = EverywhereOutbox.SRC_DICTATION;
        assertFalse(dictation.holdLate(NOW));
        EverywhereOutbox.Item accepted = note(3 * 24 * 60 * 60 * 1000L);
        accepted.runId = "already-accepted"; assertFalse(accepted.holdLate(NOW));
        accepted.runId = ""; accepted.sentAt = NOW; assertFalse(accepted.holdLate(NOW));
    }

    @Test public void a_take_crossing_six_hours_during_preparation_is_held_before_post() {
        EverywhereOutbox.Item it = note(EverywherePolicy.LATE_MESSAGE_MS);
        assertFalse(it.holdLate(NOW));
        assertTrue(it.holdLate(NOW + 1)); assertEquals("held", it.state);
    }
}
