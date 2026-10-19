package ai.wizards.os.audio;

import android.content.Context;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.SystemClock;

import ai.wizards.os.MicOwner;
import java.io.File;
import java.io.IOException;

/** One native voice-note lifecycle for both orbs. Controllers own UI and delivery, never the microphone. */
public final class NoteRecorder {
    private NoteRecorder() { }

    public interface Listener { void onMicLost(Take take, int what); }

    /** A pre-service reservation also covers foreground-start/metadata failures before there is a recorder. */
    public static final class Reservation implements AutoCloseable {
        private final Runnable release;
        private boolean closed, used;
        Reservation(Runnable release) { this.release = release; }
        synchronized void use() throws IOException {
            if (closed || used) throw new IOException("Microphone reservation already used");
            used = true;
        }
        @Override public synchronized void close() {
            if (closed) return;
            closed = true;
            release.run();
        }
    }

    public static Reservation reserve(String owner) throws IOException {
        return reserve(owner, () -> MicOwner.release(owner));
    }

    /** A meeting loan supplies its idempotent mic release; returning the meeting itself stays in the controller. */
    public static Reservation reserve(String owner, Runnable release) throws IOException {
        if (!MicOwner.tryAcquire(owner)) throw new IOException(MicOwner.reason(owner));
        return new Reservation(release);
    }

    public static Take start(Context c, String owner, String id, String source, File dir, Listener listener) throws IOException {
        return start(c, reserve(owner), id, source, dir, listener);
    }

    public static Take start(Context c, Reservation reservation, String id, String source, File dir, Listener listener) throws IOException {
        try {
            // Adopt legacy files before creating this take. Do not overwrite an interrupted recording.
            CaptureJournal journal = CaptureJournal.get(c);
            return open(reservation, journal, id, source, new File(dir, id + ".aac"), false,
                    file -> platform(c, file), SystemClock::elapsedRealtime, listener);
        } catch (IOException | RuntimeException e) {
            reservation.close();
            throw e;
        }
    }

    /** Debug controllers supply staged audio/writers; they must join the writer before stopping this take. */
    public static Take staged(Context c, Reservation reservation, String id, String source, File file) throws IOException {
        try {
            if (!ai.wizards.os.BuildConfig.DEBUG) throw new IOException("Staged audio is debug-only");
            return open(reservation, CaptureJournal.get(c), id, source, file, true,
                    f -> null, SystemClock::elapsedRealtime, null);
        } catch (IOException | RuntimeException e) {
            reservation.close();
            throw e;
        }
    }

    // Small fakeable hardware/clock boundary: tests exercise the real lifecycle and on-disk journal.
    interface Clock { long now(); }
    interface Errors { void lost(int what); }
    interface Driver {
        void stop();
        void release();
        void pause();
        void resume();
        int amplitude();
        String routed();
        void errors(Errors errors);
    }
    interface Factory { Driver start(File file) throws IOException; }

    static Take open(Reservation reservation, CaptureJournal journal, String id, String source, File file,
                     boolean staged, Factory factory, Clock clock, Listener listener) throws IOException {
        reservation.use();
        Take take = null;
        boolean created = false;
        try {
            if (journal.entry(id) != null) throw new IOException("Recording identity already exists");
            File dir = file.getParentFile();
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot keep recording");
            if (!staged && !file.createNewFile()) throw new IOException("Recording already exists");
            created = true;
            // Custody precedes hardware start: a failed prepare/start can still have written real audio.
            journal.register(id, source, "note", file, System.currentTimeMillis());
            take = new Take(reservation, journal, id, source, file, clock, listener);
            take.driver = factory.start(file);
            if (take.driver != null) {
                take.route = take.driver.routed();
                take.driver.errors(take::micLost);
            }
            return take;
        } catch (IOException | RuntimeException e) {
            try {
                if (take != null) take.abandon();
                else if (created) { journal.stopped(id); journal.releaseIfEmpty(file, source); }
            } catch (RuntimeException cleanup) { e.addSuppressed(cleanup); }
            finally { reservation.close(); }
            throw e;
        }
    }

    public static final class Take {
        private final Reservation reservation;
        private final CaptureJournal journal;
        private final String id, source;
        private final File file;
        private final Clock clock;
        private final Listener listener;
        private final long started;
        private Driver driver;
        private String route = "unknown";
        private boolean closed, paused, empty, notified, disposed, cancelledKept;
        private long pauseAt, pausedMs, duration;

        private Take(Reservation reservation, CaptureJournal journal, String id, String source, File file, Clock clock, Listener listener) {
            this.reservation = reservation; this.journal = journal; this.id = id; this.source = source;
            this.file = file; this.clock = clock; this.listener = listener; started = clock.now();
        }

        public File file() { return file; }
        public synchronized String routed() { return route; }
        public synchronized long elapsedMs() {
            return closed ? duration : Math.max(0, (paused ? pauseAt : clock.now()) - started - pausedMs);
        }
        public synchronized int getMaxAmplitude() { return closed || paused || driver == null ? 0 : driver.amplitude(); }
        public synchronized void pause() {
            if (closed || paused) return;
            if (driver != null) driver.pause();
            pauseAt = clock.now(); paused = true;
        }
        public synchronized void resume() {
            if (closed || !paused) return;
            if (driver != null) driver.resume();
            pausedMs += clock.now() - pauseAt; paused = false;
        }

        private void close() {
            if (closed) return;
            duration = elapsedMs(); closed = true;
            Driver d = driver; driver = null;
            try {
                if (d != null) {
                    try { d.stop(); } catch (RuntimeException ignored) { /* Keep any complete ADTS frames. */ }
                    finally { try { d.release(); } catch (RuntimeException ignored) { } }
                }
                journal.stopped(id);
            } finally { reservation.close(); }
        }

        /** An empty/header-only take has no speech to hand off; all real bytes stay in custody. Idempotent. */
        public synchronized File stop() {
            close();
            if (disposed) return null;
            if (file.length() < CaptureJournal.NOTHING_BYTES) {
                empty = true;
                journal.releaseIfEmpty(file, source);
            }
            return empty ? null : file;
        }
        public synchronized boolean cancel(long ms) {
            close();
            if (disposed) return cancelledKept;
            if (empty) { disposed = true; return false; }
            cancelledKept = journal.cancel(file, source, ms);
            disposed = true;
            return cancelledKept;
        }
        public synchronized void abandon() {
            close();
            if (disposed) return;
            journal.releaseIfEmpty(file, source);
            disposed = true;
        }
        private void micLost(int what) {
            synchronized (this) {
                if (closed || notified) return;
                notified = true;
                // Close/release even if the UI listener throws. Never let a late error touch a newer take.
                stop();
            }
            if (listener != null) listener.onMicLost(this, what);
        }
    }

    @SuppressWarnings("deprecation")
    private static Driver platform(Context c, File file) throws IOException {
        MediaRecorder r = MicRoute.start(c,
                () -> Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(c) : new MediaRecorder(),
                (m, src) -> {
                    m.setAudioSource(src);
                    m.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS);
                    m.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                    m.setAudioChannels(1);
                    m.setAudioSamplingRate(44100);
                    m.setAudioEncodingBitRate(64000);
                    m.setOutputFile(file.getAbsolutePath());
                });
        return new Driver() {
            public void stop() { r.stop(); }
            public void release() { r.release(); }
            public void pause() { r.pause(); }
            public void resume() { r.resume(); }
            public int amplitude() { return r.getMaxAmplitude(); }
            public String routed() { return MicRoute.routed(r); }
            public void errors(Errors errors) { r.setOnErrorListener((mr, what, extra) -> errors.lost(what)); }
        };
    }
}
