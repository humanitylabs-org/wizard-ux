package ai.wizards.os.mizel;

/** One explicitly authorized borrower. Pure policy; persistence belongs to the service.
 * A restart does NOT reconstruct authority from a saved event: recovered audio stays paused/stopped.
 */
public final class MeetingBorrow {
    public final String eventId, meetingId;
    public final boolean resumeAfter;
    public final long atMediaMs, pausedAt;
    private String takeId;
    private boolean closed;
    public String outcome = "pending";

    public MeetingBorrow(String eventId, String meetingId, boolean wasPaused, long atMediaMs, long pausedAt) {
        this.eventId = eventId; this.meetingId = meetingId; this.resumeAfter = !wasPaused;
        this.atMediaMs = atMediaMs; this.pausedAt = pausedAt;
    }
    public synchronized boolean permits(String event, String meeting, boolean paused, boolean micFree) {
        return !closed && takeId == null && eventId.equals(event) && meetingId.equals(meeting) && paused && micFree;
    }
    public synchronized boolean bind(String event, String take) {
        if (closed || takeId != null || !eventId.equals(event) || take == null || take.isEmpty()) return false;
        takeId = take; return true;
    }
    public synchronized String take() { return takeId; }
    public synchronized boolean close(String event) {
        if (closed || !eventId.equals(event)) return false;
        closed = true; return true;
    }
    public synchronized boolean open() { return !closed; }
}
