package ai.wizards.os.mizel;

import ai.wizards.os.MicOwner;

/**
 * One voice take's hold on the single microphone, borrowed from a recording meeting when there is one.
 *
 * The floating orb, the side button and the in-app orb all record while Mizel may be recording a meeting. One
 * physical mic owner at a time still holds: the meeting pauses (capture joined, partial chunk flushed, AudioRecord
 * released and a durable receipt written) BEFORE the take's owner gets the mic, and the mic goes back to the meeting
 * once the take's file is closed and in custody, never after transcription, network or the assistant's reply.
 *
 * A meeting the owner had paused stays paused; a meeting stopped during the loan is never restarted (the meeting
 * side decides that from its own receipt). Pure Java so the hand-over can be unit-tested off-device.
 */
public final class MicLoan {
    /** The recording meeting, as seen by a borrower. The Android side is {@link MeetingLoans}. */
    public interface Meeting {
        /** The meeting that is recording or paused right now; null when there is none (or it is stopping). */
        String liveMeetingId();
        /** Pause + flush + release the meeting's mic for this event and persist the receipt. False: nothing changed. */
        boolean begin(String eventId, String meetingId);
        /** Bind the borrowed take to the open loan (persisted). False: the loan is gone. */
        boolean bind(String eventId, String takeId);
        /** Close the loan once the take's mic is released. Returns the meeting afterwards: recording/paused/stopped, or null. */
        String end(String eventId, String outcome);
    }

    public final String who, eventId, takeId, meetingId;
    public final boolean borrowed;
    private boolean ended, micReleased;
    private String meetingAfter;

    private static String refusal = "";

    private MicLoan(String who, String eventId, String takeId, String meetingId, boolean borrowed) {
        this.who = who; this.eventId = eventId; this.takeId = takeId; this.meetingId = meetingId; this.borrowed = borrowed;
    }

    /** Why the last {@link #acquire} returned null, in words for a toast. */
    public static synchronized String refusal() { return refusal; }

    /**
     * Takes the mic for {@code who}. With a meeting live, the meeting lends it (eventId names that interruption);
     * otherwise the mic must simply be free. Returns null when it cannot (see {@link #refusal()}).
     */
    public static synchronized MicLoan acquire(Meeting m, String who, String takeId, String eventId) {
        refusal = "";
        String mid = m == null ? null : m.liveMeetingId();
        if (mid != null) {
            if (m.begin(eventId, mid)) {
                if (MicOwner.tryAcquire(who)) {
                    if (m.bind(eventId, takeId)) return new MicLoan(who, eventId, takeId, mid, true);
                    MicOwner.release(who);
                }
                // We paused it; give it straight back (the meeting side restores only the pause it made).
                m.end(eventId, "start_failed");
                refusal = "Couldn’t take the microphone from the meeting. Try again.";
                return null;
            }
            // Not lent (meeting stopping, another loan open). A paused meeting has already freed the mic.
            if (MicOwner.tryAcquire(who)) return new MicLoan(who, null, takeId, null, false);
            refusal = MicOwner.holder() != null && !MicOwner.MEETING.equals(MicOwner.holder()) ? MicOwner.reason(who)
                    : "The meeting couldn’t pause for the orb. Pause it in Mizel, then try again.";
            return null;
        }
        if (MicOwner.tryAcquire(who)) return new MicLoan(who, null, takeId, null, false);
        refusal = MicOwner.reason(who);
        return null;
    }

    /**
     * The take's file is closed (or the take is gone): give the mic up and hand it back to the meeting. Safe to call
     * more than once; only the first call ends the loan. Returns the meeting's state afterwards (null: no meeting).
     */
    public synchronized String release(Meeting m, String outcome) {
        if (ended) return meetingAfter;
        ended = true;
        releaseMic();
        if (borrowed && m != null) meetingAfter = m.end(eventId, outcome);
        return meetingAfter;
    }

    /** The note engine closes the mic before the controller returns the meeting loan. Exactly once. */
    public synchronized void releaseMic() {
        if (micReleased) return;
        micReleased = true;
        MicOwner.release(who);
    }

    public synchronized boolean ended() { return ended; }

    /** Server projection status for a finished loan, by how the take ended. */
    public static String eventStatus(String outcome) {
        if ("stopped".equals(outcome)) return "captured";
        return "cancelled";
    }

    /** Tests only. */
    static synchronized void resetForTest() { refusal = ""; }
}
