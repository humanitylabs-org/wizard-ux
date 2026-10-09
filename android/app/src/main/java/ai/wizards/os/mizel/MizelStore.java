package ai.wizards.os.mizel;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * All meeting journals and chunk files under filesDir/mizel. Plain Java (no Android types) so the crash-safety
 * rules are unit-tested off-device:
 *  - a chunk is written to &lt;seq&gt;.wav.tmp, fsynced, renamed to &lt;seq&gt;.wav, and only then entered in the journal;
 *  - the journal is replaced atomically (temp file, fsync, rename);
 *  - after a process death, complete-but-unjournalled files and the torn .tmp are adopted in seq order, so no audio
 *    already on disk is lost and no seq is reused.
 */
public final class MizelStore {
    private static final Pattern CHUNK = Pattern.compile("(\\d{6})\\.wav(\\.tmp)?");
    private final File root;
    private final Map<String, MizelJournal> journals = new LinkedHashMap<>();
    public interface Log { void log(String msg); }
    private Log log = m -> { };

    public MizelStore(File root) {
        this.root = root;
        //noinspection ResultOfMethodCallIgnored
        root.mkdirs();
        load();
    }

    public void setLog(Log l) { log = l == null ? m -> { } : l; }

    public File root() { return root; }

    public File meetingDir(String id) { return new File(root, id); }

    public File meDir(String id) { return new File(meetingDir(id), "me"); }

    public static String name(int seq) { return String.format(Locale.US, "%06d", seq); }

    public File chunkFile(String id, int seq) { return new File(meDir(id), name(seq) + ".wav"); }

    public File tmpFile(String id, int seq) { return new File(meDir(id), name(seq) + ".wav.tmp"); }

    /* ------------------------------------------------------------------ load / save */

    private synchronized void load() {
        journals.clear();
        File[] dirs = root.listFiles(File::isDirectory);
        if (dirs == null) return;
        Arrays.sort(dirs);
        for (File d : dirs) {
            File f = new File(d, "journal.json");
            if (!f.isFile()) continue;
            try {
                MizelJournal j = MizelJournal.from(new JSONObject(new String(readAll(new FileInputStream(f)), StandardCharsets.UTF_8)));
                if (!MizelPolicy.validMeetingId(j.meetingId) || !j.meetingId.equals(d.getName())) continue;
                journals.put(j.meetingId, j);
            } catch (Exception e) {
                log.log("journal unreadable in " + d.getName() + ": " + e);
                //noinspection ResultOfMethodCallIgnored
                f.renameTo(new File(d, "journal.broken-" + System.currentTimeMillis() + ".json"));
            }
        }
    }

    private void save(MizelJournal j) {
        try {
            File d = meetingDir(j.meetingId);
            //noinspection ResultOfMethodCallIgnored
            d.mkdirs();
            File tmp = new File(d, "journal.json.tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(j.json().toString().getBytes(StandardCharsets.UTF_8));
                o.getFD().sync();
            }
            if (!tmp.renameTo(new File(d, "journal.json"))) throw new IOException("rename failed");
        } catch (Exception e) {
            log.log("journal save failed for " + j.meetingId + ": " + e);
        }
    }

    public synchronized MizelJournal get(String id) { return journals.get(id); }

    public synchronized List<MizelJournal> all() { return new ArrayList<>(journals.values()); }

    /** A copy for readers outside the lock (the uploader reads the chunk list, then works without the lock). */
    public synchronized MizelJournal snapshot(String id) {
        MizelJournal j = journals.get(id);
        if (j == null) return null;
        try { return MizelJournal.from(j.json()); } catch (Exception e) { return null; }
    }

    /* ------------------------------------------------------------------ the recording session */

    /** Opens (or continues) a capture session. A stop not yet sent is superseded by the new session's own stop. */
    public synchronized MizelJournal beginSession(String id, long now) {
        MizelJournal j = journals.get(id);
        if (j == null) {
            j = new MizelJournal();
            j.meetingId = id;
            j.createdAt = now;
            journals.put(id, j);
        }
        //noinspection ResultOfMethodCallIgnored
        meDir(id).mkdirs();
        j.recording = true;
        j.paused = false;
        j.pausedAt = 0;
        j.lastBeatAt = now;
        if (j.stopReason != null) {
            log.log("new session on " + id + " replaces " + (j.stopSent ? "a sent" : "an unsent") + " stop (" + j.stopReason + ")");
            j.stopReason = null; j.stopSent = false; j.finalSeq = -1; j.stopAttempts = 0; j.stopNextAt = 0;
            j.readyAt = 0; j.statusCheckedAt = 0; j.endedAt = 0;
        }
        save(j);
        return j;
    }

    /** Start failed before any audio: forget a brand-new meeting entirely, else just close the session. */
    public synchronized void abandonSession(String id) {
        MizelJournal j = journals.get(id);
        if (j == null) return;
        j.recording = false; j.paused = false;
        if (j.nextSeq == 0 && j.stopReason == null && j.pending.isEmpty()) {
            journals.remove(id);
            deleteTree(meetingDir(id));
            return;
        }
        save(j);
    }

    /** The seq the chunk now being written uses (= nextSeq; it becomes permanent when the chunk is done). */
    public synchronized int currentSeq(String id) {
        MizelJournal j = journals.get(id);
        return j == null ? -1 : j.nextSeq;
    }

    public synchronized long mediaSamples(String id) {
        MizelJournal j = journals.get(id);
        return j == null ? 0 : j.mediaSamples;
    }

    /**
     * The chunk file for {@code seq} is complete (renamed from .tmp); journal it. start_ms is the media time before
     * this chunk. Returns the journalled chunk, or null if the seq was not the expected one.
     */
    public synchronized MizelJournal.Chunk chunkDone(String id, int seq, long samples, long now) {
        MizelJournal j = journals.get(id);
        if (j == null || seq != j.nextSeq) { log.log("chunkDone out of order " + id + " seq=" + seq); return null; }
        MizelJournal.Chunk c = new MizelJournal.Chunk();
        c.seq = seq;
        c.startMs = j.mediaSamples * 1000L / Wav.RATE;
        c.samples = samples;
        j.pending.add(c);
        j.nextSeq = seq + 1;
        j.mediaSamples += samples;
        j.lastBeatAt = now;
        save(j);
        return c;
    }

    public synchronized void setPaused(String id, boolean paused, long at) {
        MizelJournal j = journals.get(id);
        if (j == null) return;
        j.paused = paused;
        j.pausedAt = paused ? at : 0;
        j.lastBeatAt = at;
        save(j);
    }

    /** Ends the session and queues the stop call: final_seq is the last chunk written. */
    public synchronized MizelJournal requestStop(String id, String reason, long now) {
        MizelJournal j = journals.get(id);
        if (j == null) return null;
        j.recording = false;
        j.paused = false;
        j.pausedAt = 0;
        j.stopReason = reason;
        j.finalSeq = j.nextSeq - 1;
        j.stopSent = false;
        j.stopAttempts = 0;
        j.stopNextAt = 0;
        j.endedAt = now;
        save(j);
        return j;
    }

    /**
     * The process died with this session open. Adopt every chunk file already on disk (including the torn one being
     * written), close the session and queue a stop with reason process_death. Returns when the audio ended.
     */
    public synchronized long recover(String id, long now) {
        MizelJournal j = journals.get(id);
        if (j == null) return now;
        long endedAt = Math.max(j.lastBeatAt, j.paused ? j.pausedAt : 0);
        File[] files = meDir(id).listFiles();
        List<int[]> found = new ArrayList<>(); // {seq, isTmp}
        if (files != null) for (File f : files) {
            Matcher m = CHUNK.matcher(f.getName());
            if (!m.matches()) continue;
            int seq = Integer.parseInt(m.group(1));
            if (seq < j.nextSeq) {
                if (m.group(2) != null) //noinspection ResultOfMethodCallIgnored
                    f.delete(); // a stale temp for a chunk that was already completed
                continue;
            }
            found.add(new int[]{seq, m.group(2) != null ? 1 : 0});
            endedAt = Math.max(endedAt, f.lastModified());
        }
        found.sort((a, b) -> a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));
        for (int[] f : found) {
            int seq = f[0];
            File done = chunkFile(id, seq);
            try {
                if (f[1] == 1) {
                    File tmp = tmpFile(id, seq);
                    if (done.isFile()) { //noinspection ResultOfMethodCallIgnored
                        tmp.delete(); continue; }
                    long data;
                    try (RandomAccessFile r = new RandomAccessFile(tmp, "rw")) { data = Wav.fixHeader(r); r.getFD().sync(); }
                    if (data <= 0) { //noinspection ResultOfMethodCallIgnored
                        tmp.delete(); continue; }
                    if (!tmp.renameTo(done)) throw new IOException("rename failed");
                }
                if (seq < j.nextSeq || j.chunk(seq) != null) continue;
                long data;
                try (RandomAccessFile r = new RandomAccessFile(done, "rw")) { data = Wav.fixHeader(r); }
                if (data <= 0) { //noinspection ResultOfMethodCallIgnored
                    done.delete(); continue; }
                if (seq != j.nextSeq) log.log("recover " + id + ": gap before seq " + seq + " (expected " + j.nextSeq + ")");
                MizelJournal.Chunk c = new MizelJournal.Chunk();
                c.seq = seq;
                c.startMs = j.mediaSamples * 1000L / Wav.RATE;
                c.samples = Wav.samples(data);
                j.pending.add(c);
                j.nextSeq = seq + 1;
                j.mediaSamples += c.samples;
                log.log("recover " + id + ": adopted seq " + seq + " samples=" + c.samples);
            } catch (IOException e) {
                log.log("recover " + id + ": could not adopt seq " + seq + ": " + e);
            }
        }
        j.recording = false;
        j.paused = false;
        j.pausedAt = 0;
        j.stopReason = MizelPolicy.REASON_PROCESS_DEATH;
        j.finalSeq = j.nextSeq - 1;
        j.stopSent = false;
        j.stopAttempts = 0;
        j.stopNextAt = 0;
        j.endedAt = endedAt;
        save(j);
        return endedAt;
    }

    /* ------------------------------------------------------------------ uploads */

    public synchronized void acked(String id, int seq) {
        MizelJournal j = journals.get(id);
        if (j == null) return;
        MizelJournal.Chunk c = j.chunk(seq);
        if (c == null) return;
        j.pending.remove(c);
        j.acked++;
        j.lastAckedSeq = Math.max(j.lastAckedSeq, seq);
        save(j);
    }

    /** The server refused this chunk for good (e.g. 404 meeting gone): it no longer blocks the queue or the stop. */
    public synchronized void dropped(String id, int seq) {
        MizelJournal j = journals.get(id);
        if (j == null) return;
        MizelJournal.Chunk c = j.chunk(seq);
        if (c == null) return;
        j.pending.remove(c);
        j.dropped.add(seq);
        save(j);
    }

    public synchronized long chunkFailed(String id, int seq, long now) {
        MizelJournal j = journals.get(id);
        MizelJournal.Chunk c = j == null ? null : j.chunk(seq);
        if (c == null) return 0;
        c.attempts++;
        long d = MizelPolicy.backoff(c.attempts);
        c.nextAt = now + d;
        save(j);
        return d;
    }

    public synchronized void stopSent(String id, long now) {
        MizelJournal j = journals.get(id);
        if (j == null) return;
        j.stopSent = true;
        j.stopSentAt = now;
        save(j);
    }

    public synchronized long stopFailed(String id, long now) {
        MizelJournal j = journals.get(id);
        if (j == null) return 0;
        j.stopAttempts++;
        long d = MizelPolicy.backoff(j.stopAttempts);
        j.stopNextAt = now + d;
        save(j);
        return d;
    }

    /** Retry everything now (network came back / the app opened). */
    public synchronized void resetBackoff() {
        for (MizelJournal j : journals.values()) {
            boolean changed = false;
            for (MizelJournal.Chunk c : j.pending) if (c.nextAt > 0) { c.nextAt = 0; changed = true; }
            if (j.stopNextAt > 0) { j.stopNextAt = 0; changed = true; }
            if (changed) save(j);
        }
    }

    public synchronized void statusChecked(String id, long now, boolean ready) {
        MizelJournal j = journals.get(id);
        if (j == null) return;
        j.statusCheckedAt = now;
        if (ready && j.readyAt == 0) j.readyAt = now;
        save(j);
    }

    /** Deletes meetings whose audio the server has had (status ready) for a day. Returns the ids removed. */
    public synchronized List<String> prune(long now) { return prune(now, MizelPolicy.KEEP_AFTER_READY_MS); }

    public synchronized List<String> prune(long now, long keepMs) {
        List<String> gone = new ArrayList<>();
        for (MizelJournal j : new ArrayList<>(journals.values())) {
            if (j.recording || !j.pending.isEmpty()) continue;
            if (!MizelPolicy.prunable(j.stopSent, j.readyAt, now, keepMs)) continue;
            journals.remove(j.meetingId);
            deleteTree(meetingDir(j.meetingId));
            gone.add(j.meetingId);
        }
        return gone;
    }

    public synchronized int pendingCount(String id) {
        MizelJournal j = journals.get(id);
        return j == null ? 0 : j.pending.size();
    }

    /* ------------------------------------------------------------------ util */

    static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    public static byte[] readAll(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] b = new byte[16384]; int n;
            while ((n = i.read(b)) > 0) o.write(b, 0, n);
            return o.toByteArray();
        }
    }
}
