package ai.wizards.os.mizel;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * One meeting's persisted journal (filesDir/mizel/&lt;meetingId&gt;/journal.json). The journal, not memory, is the
 * source of truth for seq numbers, media time and what is still to upload, so a process death never reuses or
 * skips a seq. Plain data + JSON; all mutation happens under {@link MizelStore}'s lock.
 */
public final class MizelJournal {
    /** A finished chunk file waiting for the server's acknowledgement. */
    public static final class Chunk {
        public int seq;
        public long startMs, samples;
        public int attempts;
        public long nextAt;

        JSONObject json() throws JSONException {
            return new JSONObject().put("seq", seq).put("startMs", startMs).put("samples", samples).put("attempts", attempts).put("nextAt", nextAt);
        }

        static Chunk from(JSONObject o) {
            Chunk c = new Chunk();
            c.seq = o.optInt("seq"); c.startMs = o.optLong("startMs"); c.samples = o.optLong("samples");
            c.attempts = o.optInt("attempts"); c.nextAt = o.optLong("nextAt");
            return c;
        }
    }

    public String meetingId;
    public long createdAt;
    /** The seq the next chunk gets. Persisted only after a chunk file is complete and renamed. */
    public int nextSeq;
    /** Audio recorded so far, in samples at 16 kHz (media time; paused time is not in here). */
    public long mediaSamples;
    /** A capture session is open (recording or paused). True on disk after a process death → recovery. */
    public boolean recording;
    public boolean paused;
    public long pausedAt;
    /** Wall time of the last chunk written; "Recording ended unexpectedly at HH:MM" uses it. */
    public long lastBeatAt;
    public final List<Chunk> pending = new ArrayList<>();
    public int acked;
    public int lastAckedSeq = -1;
    public final List<Integer> dropped = new ArrayList<>();
    /** A stop has been asked for (user / pause_timeout / process_death); sent once every chunk ≤ finalSeq is acked. */
    public String stopReason;
    public int finalSeq = -1;
    public boolean stopSent;
    public long stopSentAt, stopNextAt, endedAt;
    public int stopAttempts;
    /** Server reported status "ready" (or the meeting is gone) at this time; local audio is pruned a day later. */
    public long readyAt, statusCheckedAt;

    public long mediaMs() { return mediaSamples * 1000L / Wav.RATE; }

    public boolean stopPending() { return stopReason != null && !stopSent; }

    public int lowestPendingSeq() {
        int lo = -1;
        for (Chunk c : pending) if (lo < 0 || c.seq < lo) lo = c.seq;
        return lo;
    }

    public Chunk chunk(int seq) {
        for (Chunk c : pending) if (c.seq == seq) return c;
        return null;
    }

    public JSONObject json() throws JSONException {
        JSONArray p = new JSONArray();
        for (Chunk c : pending) p.put(c.json());
        JSONArray d = new JSONArray();
        for (int s : dropped) d.put(s);
        return new JSONObject().put("v", 1).put("meetingId", meetingId).put("createdAt", createdAt).put("nextSeq", nextSeq)
                .put("mediaSamples", mediaSamples).put("mediaMs", mediaMs()).put("recording", recording).put("paused", paused)
                .put("pausedAt", pausedAt).put("lastBeatAt", lastBeatAt).put("pending", p).put("acked", acked)
                .put("lastAckedSeq", lastAckedSeq).put("dropped", d).put("stopReason", stopReason == null ? JSONObject.NULL : stopReason)
                .put("finalSeq", finalSeq).put("stopSent", stopSent).put("stopSentAt", stopSentAt).put("stopNextAt", stopNextAt)
                .put("stopAttempts", stopAttempts).put("endedAt", endedAt).put("readyAt", readyAt).put("statusCheckedAt", statusCheckedAt);
    }

    public static MizelJournal from(JSONObject o) {
        MizelJournal j = new MizelJournal();
        j.meetingId = o.optString("meetingId");
        j.createdAt = o.optLong("createdAt");
        j.nextSeq = o.optInt("nextSeq");
        j.mediaSamples = o.optLong("mediaSamples");
        j.recording = o.optBoolean("recording");
        j.paused = o.optBoolean("paused");
        j.pausedAt = o.optLong("pausedAt");
        j.lastBeatAt = o.optLong("lastBeatAt");
        JSONArray p = o.optJSONArray("pending");
        if (p != null) for (int i = 0; i < p.length(); i++) { JSONObject c = p.optJSONObject(i); if (c != null) j.pending.add(Chunk.from(c)); }
        j.acked = o.optInt("acked");
        j.lastAckedSeq = o.optInt("lastAckedSeq", -1);
        JSONArray d = o.optJSONArray("dropped");
        if (d != null) for (int i = 0; i < d.length(); i++) j.dropped.add(d.optInt(i));
        j.stopReason = o.isNull("stopReason") ? null : o.optString("stopReason", null);
        j.finalSeq = o.optInt("finalSeq", -1);
        j.stopSent = o.optBoolean("stopSent");
        j.stopSentAt = o.optLong("stopSentAt");
        j.stopNextAt = o.optLong("stopNextAt");
        j.stopAttempts = o.optInt("stopAttempts");
        j.endedAt = o.optLong("endedAt");
        j.readyAt = o.optLong("readyAt");
        j.statusCheckedAt = o.optLong("statusCheckedAt");
        return j;
    }
}
