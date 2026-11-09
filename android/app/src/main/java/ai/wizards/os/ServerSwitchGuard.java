package ai.wizards.os;

import ai.wizards.os.mizel.MeetingEventProjection;
import ai.wizards.os.mizel.MizelJournal;
import ai.wizards.os.mizel.MizelStore;
import ai.wizards.os.mizel.Wav;

import android.content.Context;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Fail closed rather than re-home a recording/share captured for a different owner, but only for work that is
 * genuinely unfinished. Finished meetings (every chunk acknowledged, stop sent) kept for the "keep after ready"
 * window, and bare store/index/empty-folder files, never block a switch.
 *
 * Finished meetings are left in place on a switch: nothing is uploaded for them any more (no pending chunk, stop
 * already sent), so they cannot be re-homed to the new owner, and MizelStore.prune removes them on its normal
 * schedule. We never delete anything on a switch, so nothing unsent can be lost.
 */
final class ServerSwitchGuard {
    private ServerSwitchGuard() {}

    /** What is still unfinished, in the order we check it. */
    enum Reason {
        RECORDING("A recording is still in progress"),
        MESSAGE("A message hasn't been sent yet"),
        SHARE("A shared file hasn't been sent yet"),
        SAVED_RECORDING("A recording hasn't been sent yet"),
        MEETING_RECORDING("A meeting is still being recorded"),
        MEETING_UPLOAD("A meeting is still uploading"),
        MEETING_SYNC("A meeting is still syncing");

        final String say;
        Reason(String say) { this.say = say; }
    }

    /** The facts the guard reads, so each reason can be tested without a phone. */
    interface Facts {
        boolean recording();
        boolean messageUnsent();
        boolean sharePending();
        boolean savedRecordingPending();
        /** Unfinished meeting work, or null. */
        Reason meeting();
    }

    static boolean hasLocalWork(Context c) { return blocker(c) != null; }

    /** The first unfinished thing, or null when switching is safe. */
    static Reason blocker(Context c) { return first(facts(c)); }

    /** Plain words for the toast; falls back to a generic line when nothing is blocking (e.g. a double connect). */
    static String say(Reason r) {
        if (r == Reason.SAVED_RECORDING) return r.say + ". Send or delete it, then try again."; // the page shows it (#1220)
        return r == null ? "Couldn't switch just now. Try again."
                : r.say + ". Let it finish, then try again.";
    }

    static Reason first(Facts f) {
        if (f.recording()) return Reason.RECORDING;
        if (f.messageUnsent()) return Reason.MESSAGE;
        if (f.sharePending()) return Reason.SHARE;
        if (f.savedRecordingPending()) return Reason.SAVED_RECORDING;
        return f.meeting();
    }

    private static Facts facts(Context c) {
        return new Facts() {
            @Override public boolean recording() { return ai.wizards.os.update.Updater.recording(c); }
            @Override public boolean messageUnsent() { return !ai.wizards.os.everywhere.EverywhereOutbox.get(c).unsent().isEmpty(); }
            @Override public boolean sharePending() { return ai.wizards.os.share.ShareQueue.get(c).pending(); }
            // Only takes never handed to the page block; the rest stay with this Wizard on a switch (#1220).
            @Override public boolean savedRecordingPending() { return !ai.wizards.os.recording.RecordingStore.get(c).unsent(ServerSettings.origin(c)).isEmpty(); }
            @Override public Reason meeting() {
                return meetingWork(new File(c.getFilesDir(), "mizel"), ai.wizards.os.mizel.MeetingRecorderService.receipts(c));
            }
        };
    }

    /**
     * Unfinished meeting work under {@code mizelRoot}, read-only (never opens or repairs the store):
     * a live or paused session, chunks not yet acknowledged, a stop not yet sent, a native loan receipt the
     * server has not confirmed for a meeting still on the phone, or audio files with no readable journal.
     */
    static Reason meetingWork(File mizelRoot, List<JSONObject> receipts) {
        Set<String> local = new HashSet<>();
        File[] dirs = mizelRoot.listFiles(File::isDirectory);
        Reason found = null;
        if (dirs != null) for (File d : dirs) {
            local.add(d.getName());
            Reason r = meeting(d);
            if (r != null && (found == null || r.ordinal() < found.ordinal())) found = r;
        }
        if (found != null) return found;
        // A receipt for a meeting no longer on the phone can never be confirmed against local work; ignore it.
        if (receipts != null) for (JSONObject r : receipts)
            if (MeetingEventProjection.pending(r) && local.contains(r.optString("meetingId"))) return Reason.MEETING_SYNC;
        return null;
    }

    private static Reason meeting(File dir) {
        File journal = new File(dir, "journal.json");
        if (journal.isFile()) {
            try {
                MizelJournal j = MizelJournal.from(new JSONObject(new String(MizelStore.readAll(new FileInputStream(journal)), StandardCharsets.UTF_8)));
                if (j.recording) return Reason.MEETING_RECORDING;
                if (!j.pending.isEmpty()) return Reason.MEETING_UPLOAD;
                if (j.stopPending()) return Reason.MEETING_SYNC;
                return null; // finished: every chunk acknowledged (or refused for good) and the stop sent
            } catch (Exception unreadable) {
                // fall through: judge by the audio itself
            }
        }
        return hasAudio(dir) ? Reason.MEETING_UPLOAD : null;
    }

    /** Any non-empty chunk file (finished or torn); headers alone and bookkeeping files are not audio. */
    private static boolean hasAudio(File f) {
        if (f.isFile()) {
            String n = f.getName();
            return (n.endsWith(".wav") || n.endsWith(".wav.tmp")) && f.length() > Wav.HEADER;
        }
        File[] kids = f.listFiles();
        if (kids == null) return false;
        for (File k : kids) if (hasAudio(k)) return true;
        return false;
    }
}
