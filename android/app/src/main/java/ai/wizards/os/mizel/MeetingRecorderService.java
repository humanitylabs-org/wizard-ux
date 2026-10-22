package ai.wizards.os.mizel;

import ai.wizards.os.audio.CaptureJournal;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.TimeZone;

import ai.wizards.os.MainActivity;
import ai.wizards.os.MicOwner;

/**
 * Mizel meeting recorder: a microphone foreground service that writes 5-second 16 kHz mono PCM16 WAV chunks to
 * filesDir/mizel/&lt;meetingId&gt;/me/&lt;seq&gt;.wav (temp file + rename) and hands each one to {@link MizelUploader}.
 * The journal (MizelStore) owns seq and media time, so a process death never loses or reuses a seq.
 *
 * Pause releases the microphone (AudioRecord stopped and released) and starts a 30-minute countdown; at zero the
 * meeting stops with reason pause_timeout. Stop queues {"final_seq":{"me":N},"reason":…}, which the uploader sends
 * only after every chunk up to N is acknowledged. After a process death the service never restarts the microphone
 * (Android 14 forbids a background mic start): it closes the meeting with reason process_death and says so.
 */
public class MeetingRecorderService extends Service {
    static final String TAG = MizelHub.TAG;
    public static final String ACTION_START = "ai.wizards.os.mizel.START";
    public static final String ACTION_PAUSE = "ai.wizards.os.mizel.PAUSE";
    public static final String ACTION_RESUME = "ai.wizards.os.mizel.RESUME";
    public static final String ACTION_STOP = "ai.wizards.os.mizel.STOP";
    static final String EXTRA_MEETING = "meetingId", EXTRA_REASON = "reason", EXTRA_REQ = "req";
    static final String CH_REC = "mizel", CH_ALERT = "mizel-alerts";
    static final int N_REC = 7303, N_ENDED_BASE = 7310; // distinct from orb recorder notification
    public static final String LIVE_PATH = "/mizel-live/#/m/";

    /** What the bridge and the notification read about the session in progress. */
    public static final class Live {
        public final String meetingId;
        public volatile boolean paused;
        public volatile long pausedAtWall;
        /** Committed samples (finished chunks) + samples in the chunk being written. */
        volatile long mediaSamples;
        volatile boolean stopping;

        Live(String id, long committed) { meetingId = id; mediaSamples = committed; }

        public long mediaMs() { return mediaSamples * 1000L / Wav.RATE; }
    }

    private static volatile Live live;
    private static volatile MeetingRecorderService instance;
    private static volatile MeetingBorrow borrow;

    public static Live live() { return live; }
    public static boolean serviceAlive() { return instance != null; }

    /** Bridge thread waits for actual pause/flush/release, never just a posted intent. */
    public static String beginBorrow(String eventId, String meetingId) {
        if (eventId == null || !eventId.matches("[A-Za-z0-9_-]{8,100}")) return "null";
        return onMain(() -> {
            MeetingRecorderService s = instance; Live l = live;
            if (s == null || l == null || !l.meetingId.equals(meetingId) || l.stopping) return "null";
            if (borrow != null && borrow.open()) return borrow.eventId.equals(eventId) ? s.borrowJson(borrow, "paused").toString() : "null";
            if (ai.wizards.os.recording.RecorderService.active() != null) return "null";
            boolean wasPaused = l.paused;
            s.pause(0, false); // internal loan pause is not a user override
            if (!l.paused || s.capture != null || MicOwner.holder() != null) return "null";
            MeetingBorrow b = new MeetingBorrow(eventId, meetingId, wasPaused, l.mediaMs(), System.currentTimeMillis());
            if (!s.saveBorrow(b, "paused")) {
                // No request was admitted: restore only the pause we introduced.
                if (!wasPaused) s.resume(0);
                return "null";
            }
            borrow = b;
            return s.borrowJson(b, "paused").toString();
        });
    }

    public static boolean permitsBorrow(String eventId) {
        MeetingBorrow b = borrow; Live l = live;
        return b != null && l != null && b.permits(eventId, l.meetingId, l.paused && !l.stopping, MicOwner.holder() == null);
    }

    public static boolean bindBorrow(String eventId, String takeId) {
        MeetingRecorderService s = instance; MeetingBorrow b = borrow;
        return s != null && b != null && b.bind(eventId, takeId) && s.saveBorrow(b, "capturing");
    }

    /** File closure/release happens before this call. No upload/STT/assistant wait. */
    public static String endBorrow(String eventId, String outcome) {
        return onMain(() -> {
            MeetingRecorderService s = instance; MeetingBorrow b = borrow; Live l = live;
            if (s == null || b == null || !b.eventId.equals(eventId)) return "null";
            if (b.open() && (ai.wizards.os.recording.RecorderService.active() != null || MicOwner.holder() != null)) return "null";
            if (b.open()) {
                b.outcome = outcome;
                if (!s.saveBorrow(b, outcome)) return "null";
                b.close(eventId);
                // Notification Stop and pre-existing manual Pause always win.
                if (b.shouldResume() && l != null && l.meetingId.equals(b.meetingId) && l.paused && !l.stopping) s.resume(0);
            }
            String status = live != null && live.meetingId.equals(b.meetingId) ? (live.paused ? "paused" : "recording") : "stopped";
            s.saveBorrow(b, status);
            return s.borrowJson(b, status).toString();
        });
    }

    private org.json.JSONObject borrowJson(MeetingBorrow b, String status) {
        org.json.JSONObject o = new org.json.JSONObject();
        try { o.put("id", b.eventId).put("meetingId", b.meetingId).put("voiceTakeId", b.take())
            .put("atMediaMs", b.atMediaMs).put("pausedAt", b.pausedAt).put("pausedByHandoff", b.shouldResume()).put("userPaused", b.userPaused())
            .put("status", status).put("outcome", b.outcome).put("open", b.open()); } catch (org.json.JSONException ignored) { }
        return o;
    }
    private boolean saveBorrow(MeetingBorrow b, String status) {
        return writeReceipt(this, b.eventId, borrowJson(b, status));
    }

    /* Loan receipts ("meeting-handoffs-v1", one JSON string per interruption). The loan's own fields come from
     * borrowJson; a native borrower adds what the meeting transcript shows (source, kind, words, thread) with
     * annotate(). Every write bumps "rev"; native rows are posted to the meeting by MeetingEventSync until the
     * server confirms that revision ("acked"). One store, no parallel journal. */
    public static final String RECEIPTS = "meeting-handoffs-v1";
    private static final Object RECEIPT_LOCK = new Object();

    /** Merge {@code patch} into the stored receipt (JSONObject.NULL deletes a key) and bump its revision. */
    public static boolean writeReceipt(Context c, String eventId, org.json.JSONObject patch) {
        if (c == null || eventId == null || eventId.isEmpty()) return false;
        boolean ok, sync;
        synchronized (RECEIPT_LOCK) {
            android.content.SharedPreferences p = c.getSharedPreferences(RECEIPTS, MODE_PRIVATE);
            org.json.JSONObject cur = readReceipt(p, eventId);
            org.json.JSONObject next = MeetingEventProjection.merge(cur, patch);
            try { next.put("rev", cur.optLong("rev", 0) + 1); } catch (org.json.JSONException ignored) { }
            ok = p.edit().putString(eventId, next.toString()).commit();
            sync = ok && next.has("source");
        }
        if (sync) MeetingEventSync.kick(c);
        return ok;
    }

    /** A native borrower's notes for the transcript marker (words typed, thread, failure, ...). */
    public static boolean annotate(Context c, String eventId, org.json.JSONObject patch) {
        return writeReceipt(c, eventId, patch);
    }

    /** The server has this revision: remember it without bumping the revision. */
    static void markAcked(Context c, String eventId, long rev) {
        synchronized (RECEIPT_LOCK) {
            android.content.SharedPreferences p = c.getSharedPreferences(RECEIPTS, MODE_PRIVATE);
            org.json.JSONObject cur = readReceipt(p, eventId);
            if (cur.optLong("rev", 0) != rev) return; // changed meanwhile: the next pass posts the newer one
            try { cur.put("acked", rev); } catch (org.json.JSONException ignored) { }
            p.edit().putString(eventId, cur.toString()).commit();
        }
    }

    static java.util.List<org.json.JSONObject> receipts(Context c) {
        java.util.List<org.json.JSONObject> out = new java.util.ArrayList<>();
        synchronized (RECEIPT_LOCK) {
            android.content.SharedPreferences p = c.getSharedPreferences(RECEIPTS, MODE_PRIVATE);
            for (String k : p.getAll().keySet()) out.add(readReceipt(p, k));
        }
        return out;
    }

    private static org.json.JSONObject readReceipt(android.content.SharedPreferences p, String eventId) {
        try { Object v = p.getAll().get(eventId); return v instanceof String ? new org.json.JSONObject((String) v) : new org.json.JSONObject(); }
        catch (org.json.JSONException e) { return new org.json.JSONObject(); }
    }
    private static String onMain(java.util.concurrent.Callable<String> work) {
        if (Looper.myLooper() == Looper.getMainLooper()) { try { return work.call(); } catch (Exception e) { return "null"; } }
        java.util.concurrent.FutureTask<String> task = new java.util.concurrent.FutureTask<>(work);
        new Handler(Looper.getMainLooper()).post(task);
        try { return task.get(12, java.util.concurrent.TimeUnit.SECONDS); }
        catch (Exception e) { task.cancel(false); return "null"; } // ambiguous failure never grants a mic lease
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private MizelStore store;
    private MizelUploader uploader;
    private Capture capture;
    private PowerManager.WakeLock wake;
    private long drainDeadline;
    private int drainLastPending = -1;

    /* ------------------------------------------------------------------ entry points */

    /** Null if a meeting may start now, else the protocol error (and a toast says why). */
    static String canStart(Context c) {
        if (c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            return MizelProtocol.E_MIC_PERMISSION;
        // DeviceBridge's foreground voice/task recorder does not use the side-button MicOwner lease.
        if (ai.wizards.os.recording.RecorderService.active() != null) return MizelProtocol.E_MIC_BUSY;
        String h = MicOwner.holder();
        if (h != null && !MicOwner.MEETING.equals(h)) {
            Log.i(TAG, "start refused: mic held by " + h);
            Toast.makeText(c, MicOwner.reason(MicOwner.MEETING).replace("Finish that first.", "Finish that before recording a meeting."), Toast.LENGTH_LONG).show();
            return MizelProtocol.E_MIC_BUSY;
        }
        return null;
    }

    static void send(Context c, String action, String meetingId, String reason, int req, boolean foreground) {
        Intent i = new Intent(c, MeetingRecorderService.class).setAction(action).putExtra(EXTRA_MEETING, meetingId).putExtra(EXTRA_REQ, req);
        if (reason != null) i.putExtra(EXTRA_REASON, reason);
        try {
            if (foreground) c.startForegroundService(i); else c.startService(i);
        } catch (RuntimeException e) {
            Log.w(TAG, "could not reach the recorder service", e);
            MizelHub.done(req, MizelProtocol.E_START_FAILED);
        }
    }

    /**
     * Closes any session the journal says was open when the process died: adopt its chunk files, queue a stop with
     * reason process_death, tell James. Never restarts the microphone. Safe to call from anywhere, any time.
     */
    public static void recover(Context ctx) { recover(ctx, true); }

    /** {@code scheduleJob} false from inside the upload job itself (rescheduling the running job would restart it). */
    static void recover(Context ctx, boolean scheduleJob) {
        Context c = ctx.getApplicationContext();
        if (live != null) return;
        MizelStore s = MizelHub.store(c);
        boolean any = false;
        for (MizelJournal j : s.all()) {
            if (!j.recording) continue;
            long endedAt = s.recover(j.meetingId, System.currentTimeMillis());
            MicOwner.release(MicOwner.MEETING);
            Log.w(TAG, "recovered " + j.meetingId + " after process death: final_seq=" + s.get(j.meetingId).finalSeq
                    + " pending=" + s.pendingCount(j.meetingId) + " ended=" + endedAt);
            notifyEnded(c, j.meetingId, endedAt);
            any = true;
        }
        MizelUploader up = MizelUploader.get(c);
        up.kick();
        if (scheduleJob && (any || up.outstanding())) MizelUploadJob.schedule(c);
        if (any) MizelHub.pushState(c);
    }

    /* ------------------------------------------------------------------ lifecycle */

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        store = MizelHub.store(this);
        uploader = MizelUploader.get(this);
        channels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        String id = intent == null ? null : intent.getStringExtra(EXTRA_MEETING);
        int req = intent == null ? 0 : intent.getIntExtra(EXTRA_REQ, 0);
        if (a == null) {
            // START_STICKY restart after the process died (or a stray start): never re-open the microphone.
            Log.i(TAG, "service restarted without a command (live=" + (live != null) + ")");
            if (live == null) {
                recover(this);
                stopSelf();
                return START_NOT_STICKY;
            }
            return START_STICKY;
        }
        switch (a) {
            case ACTION_START: start(id, req); break;
            case ACTION_PAUSE: pause(req); break;
            case ACTION_RESUME: resume(req); break;
            case ACTION_STOP: {
                String r = intent.getStringExtra(EXTRA_REASON);
                stop(r == null ? MizelPolicy.REASON_USER : r, req);
                break;
            }
            default: MizelHub.done(req, MizelProtocol.E_BAD_REQUEST);
        }
        if (live == null && capture == null && drainDeadline == 0) stopSelf();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        Live l = live;
        if (l != null && !l.stopping) {
            // Destroyed by the system while a session was open: same as a process death, minus the death.
            Log.w(TAG, "service destroyed with a session open: closing it");
            stopCapture();
            live = null;
            recover(this);
        }
        MicOwner.release(MicOwner.MEETING);
        releaseWake();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ commands */

    private void start(String id, int req) {
        // A foreground start must call startForeground() promptly whatever happens next.
        if (!MizelPolicy.validMeetingId(id)) { refuseStart(req, MizelProtocol.E_BAD_MEETING_ID); return; }
        if (live != null) {
            boolean same = live.meetingId.equals(id);
            foreground();
            MizelHub.done(req, same ? null : MizelProtocol.E_BUSY_OTHER);
            return;
        }
        String admission = canStart(this); // Recheck after the asynchronous service-start hop.
        if (admission != null) { refuseStart(req, admission); return; }
        if (!MicOwner.tryAcquire(MicOwner.MEETING)) {
            Log.i(TAG, "start refused: mic held by " + MicOwner.holder());
            toast(MicOwner.reason(MicOwner.MEETING));
            refuseStart(req, MizelProtocol.E_MIC_BUSY);
            return;
        }
        recover(this); // any older session left open by a dead process is closed first
        MizelJournal j = store.beginSession(id, System.currentTimeMillis());
        Live l = new Live(id, j.mediaSamples);
        live = l;
        drainDeadline = 0;
        if (!foreground()) {
            live = null;
            store.abandonSession(id);
            MicOwner.release(MicOwner.MEETING);
            MizelHub.done(req, MizelProtocol.E_START_FAILED);
            stopSelf();
            return;
        }
        if (!startCapture(l)) {
            live = null;
            store.abandonSession(id);
            MicOwner.release(MicOwner.MEETING);
            stopForeground(STOP_FOREGROUND_REMOVE);
            toast("The microphone is busy. Try again in a moment.");
            MizelHub.done(req, MizelProtocol.E_MIC_BUSY);
            stopSelf();
            return;
        }
        acquireWake();
        Log.i(TAG, "recording " + id + " from seq " + j.nextSeq + " media_ms=" + l.mediaMs());
        MizelHub.done(req, null);
        main.post(ticker);
        MizelHub.pushState(this);
    }

    private void refuseStart(int req, String err) {
        // We were started with startForegroundService(): satisfy Android, then leave quietly.
        try {
            startForegroundCompat(buildRecording(null), true);
        } catch (RuntimeException ignored) { }
        if (live == null) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }
        MizelHub.done(req, err);
    }

    private void pause(int req) {
        pause(req, true);
    }
    private void pause(int req, boolean user) {
        Live l = live;
        if (l == null) { MizelHub.done(req, MizelProtocol.E_NOT_RECORDING); return; }
        if (user && borrow != null && borrow.open() && borrow.meetingId.equals(l.meetingId)) {
            borrow.userPause(); // fail closed in memory even if persistence fails
            if (!saveBorrow(borrow, "paused")) { MizelHub.done(req, MizelProtocol.E_MIC_BUSY); return; }
        }
        if (l.paused) { MizelHub.done(req, null); return; }
        if (!stopCapture()) { MizelHub.done(req, MizelProtocol.E_MIC_BUSY); return; }
        long now = System.currentTimeMillis();
        l.paused = true;
        l.pausedAtWall = now;
        store.setPaused(l.meetingId, true, now);
        MicOwner.release(MicOwner.MEETING);
        releaseWake();
        long timeout = MizelConfig.pauseTimeoutMs(this);
        main.removeCallbacks(pauseTimeout);
        main.postDelayed(pauseTimeout, timeout);
        Log.i(TAG, "paused " + l.meetingId + " media_ms=" + l.mediaMs() + " (mic released; auto-stop in " + timeout + " ms)");
        refreshNotification(true);
        MizelHub.done(req, null);
        MizelHub.pushState(this);
    }

    private void resume(int req) {
        Live l = live;
        if (l == null) { MizelHub.done(req, MizelProtocol.E_NOT_RECORDING); return; }
        if (!l.paused) { MizelHub.done(req, null); return; }
        if ((borrow != null && borrow.open()) || ai.wizards.os.recording.RecorderService.active() != null) {
            MizelHub.done(req, MizelProtocol.E_MIC_BUSY); return;
        }
        if (!MicOwner.tryAcquire(MicOwner.MEETING)) {
            Log.i(TAG, "resume refused: mic held by " + MicOwner.holder());
            toast(MicOwner.reason(MicOwner.MEETING));
            MizelHub.done(req, MizelProtocol.E_MIC_BUSY);
            return;
        }
        if (!startCapture(l)) {
            MicOwner.release(MicOwner.MEETING);
            toast("The microphone is busy. Try again in a moment.");
            MizelHub.done(req, MizelProtocol.E_MIC_BUSY);
            return;
        }
        main.removeCallbacks(pauseTimeout);
        l.paused = false;
        l.pausedAtWall = 0;
        store.setPaused(l.meetingId, false, System.currentTimeMillis());
        acquireWake();
        Log.i(TAG, "resumed " + l.meetingId + " media_ms=" + l.mediaMs());
        refreshNotification(true);
        MizelHub.done(req, null);
        MizelHub.pushState(this);
    }

    private void stop(String reason, int req) {
        Live l = live;
        if (l == null) { MizelHub.done(req, MizelProtocol.E_NOT_RECORDING); return; }
        l.stopping = true;
        main.removeCallbacks(pauseTimeout);
        if (!stopCapture()) { l.stopping = false; MizelHub.done(req, MizelProtocol.E_MIC_BUSY); return; }
        if (borrow != null && borrow.open()) { borrow.close(borrow.eventId); saveBorrow(borrow, "meeting_stopped"); }
        MizelJournal j = store.requestStop(l.meetingId, reason, System.currentTimeMillis());
        live = null;
        MicOwner.release(MicOwner.MEETING);
        releaseWake();
        Log.i(TAG, "stopped " + l.meetingId + " reason=" + reason + " final_seq=" + (j == null ? -1 : j.finalSeq)
                + " media_ms=" + (j == null ? 0 : j.mediaMs()) + " pending=" + store.pendingCount(l.meetingId));
        uploader.kick();
        MizelHub.done(req, null);
        MizelHub.pushState(this);
        // Stay in front while the last chunks and the stop go out; then hand the rest to a network job.
        drainDeadline = SystemClock.elapsedRealtime() + MizelConfig.drainGraceMs(this);
        drainLastPending = -1;
        MizelUploadJob.schedule(this);
        main.post(drainWatch);
    }

    private final Runnable pauseTimeout = () -> {
        Live l = live;
        if (l == null || !l.paused) return;
        Log.i(TAG, "paused too long: stopping " + l.meetingId + " (pause_timeout)");
        stop(MizelPolicy.REASON_PAUSE_TIMEOUT, 0);
    };

    private final Runnable drainWatch = new Runnable() {
        @Override public void run() {
            if (live != null) { drainDeadline = 0; return; }
            int pend = 0; boolean stopPending = false;
            for (MizelJournal j : store.all()) { pend += j.pending.size(); stopPending |= j.stopPending(); }
            if (pend == 0 && !stopPending) {
                Log.i(TAG, "all meeting audio delivered; recorder service done");
                finishDrain();
                return;
            }
            if (pend != drainLastPending) { // progress: give it more time
                drainLastPending = pend;
                drainDeadline = SystemClock.elapsedRealtime() + MizelConfig.drainGraceMs(MeetingRecorderService.this);
            }
            if (SystemClock.elapsedRealtime() > drainDeadline) {
                Log.i(TAG, "uploads stalled with " + pend + " chunk(s) left: handing over to the network job");
                MizelUploadJob.schedule(MeetingRecorderService.this);
                finishDrain();
                return;
            }
            showDraining(pend);
            main.postDelayed(this, 1000);
        }
    };

    private void finishDrain() {
        drainDeadline = 0;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /** Once a second while a session is open: state push + notification refresh. */
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (live == null) return;
            MizelHub.pushState(MeetingRecorderService.this);
            refreshNotification(false);
            main.postDelayed(this, 1000);
        }
    };

    /* ------------------------------------------------------------------ capture */

    private boolean startCapture(Live l) {
        Capture c = new Capture(l);
        if (!c.open()) return false;
        capture = c;
        c.start();
        return true;
    }

    private boolean stopCapture() {
        Capture c = capture;
        if (c != null && !c.finish()) return false;
        capture = null;
        return true;
    }

    /** Owns one AudioRecord between start/resume and pause/stop; writes chunks on its own thread. */
    private final class Capture extends Thread {
        private final Live l;
        private AudioRecord rec;
        private volatile boolean running = true;
        private volatile boolean custodyFailed;
        private RandomAccessFile out;
        private int seq;
        private long chunkSamples;
        private long committed;
        private int levelPeak;
        private long levelSamples;

        Capture(Live l) { super("mizel-capture"); this.l = l; }

        /** Debug (.qa) builds on an emulator without a usable microphone: a paced synthetic tone stands in. */
        private boolean fake;
        private long fakeT0, fakeSent;

        boolean open() {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return false;
            if (MizelConfig.qaFakeMic(MeetingRecorderService.this) == 2) return openFake("forced");
            int min = AudioRecord.getMinBufferSize(Wav.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int size = Math.max(min, Wav.RATE * 2); // ≥ 1 s of slack
            for (int src : new int[]{MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC}) {
                try {
                    AudioRecord r = new AudioRecord(src, Wav.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size);
                    if (r.getState() != AudioRecord.STATE_INITIALIZED) { r.release(); continue; }
                    // The phone's mic, never a Bluetooth speaker's: a source Android routes elsewhere is dropped.
                    if (!ai.wizards.os.audio.MicRoute.startOnBuiltIn(MeetingRecorderService.this, r)) continue;
                    rec = r;
                    int next = store.currentSeq(l.meetingId);
                    CaptureJournal.get(MeetingRecorderService.this).register(CaptureJournal.chunkId(l.meetingId, next),
                            "meeting", "meeting_chunk", store.tmpFile(l.meetingId, next), System.currentTimeMillis());
                    Log.i(TAG, "AudioRecord open source=" + src + " buffer=" + size + " via " + ai.wizards.os.audio.MicRoute.routed(r));
                    return true;
                } catch (SecurityException | IllegalStateException | IllegalArgumentException e) {
                    if (rec != null) {
                        try { rec.stop(); } catch (IllegalStateException ignored) { }
                        rec.release(); rec = null;
                    }
                    Log.w(TAG, "AudioRecord source " + src + " failed", e);
                }
            }
            return MizelConfig.qaFakeMic(MeetingRecorderService.this) == 1 && openFake("no AudioRecord");
        }

        private boolean openFake(String why) {
            fake = true;
            fakeT0 = SystemClock.elapsedRealtime();
            Log.w(TAG, "QA build: synthetic microphone (" + why + ")");
            return true;
        }

        private int read(short[] buf) {
            if (!fake) return rec.read(buf, 0, buf.length);
            long due = (SystemClock.elapsedRealtime() - fakeT0) * Wav.RATE / 1000 - fakeSent;
            if (due < buf.length) { SystemClock.sleep(Math.max(1, (buf.length - due) * 1000 / Wav.RATE)); return 0; }
            for (int i = 0; i < buf.length; i++) {
                long t = fakeSent + i;
                buf[i] = (short) (6000 * Math.sin(2 * Math.PI * 440 * t / Wav.RATE) * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / (Wav.RATE * 2.0))));
            }
            fakeSent += buf.length;
            return buf.length;
        }

        @Override
        public void run() {
            short[] buf = new short[Wav.RATE / 10]; // 100 ms
            byte[] bytes = new byte[buf.length * 2];
            committed = store.mediaSamples(l.meetingId);
            int errors = 0;
            LivePcmFrames pcm = new LivePcmFrames((data, at) -> {
                if (MizelHub.wantsPcm()) MizelHub.pushPcm(MizelProtocol.pcmPush(l.meetingId, data, at));
            });
            try {
                while (running) {
                    int n = read(buf);
                    if (n < 0) {
                        Log.w(TAG, "AudioRecord read error " + n);
                        if (++errors > 20) break;
                        SystemClock.sleep(50);
                        continue;
                    }
                    errors = 0;
                    if (n == 0) continue;
                    int off = 0;
                    while (off < n) {
                        if (out == null) openChunk();
                        int take = (int) Math.min(n - off, Wav.CHUNK_SAMPLES - chunkSamples);
                        for (int i = 0; i < take; i++) {
                            short s = buf[off + i];
                            bytes[2 * i] = (byte) s;
                            bytes[2 * i + 1] = (byte) (s >> 8);
                            int a = s < 0 ? -s : s;
                            if (a > levelPeak) levelPeak = a;
                        }
                        out.write(bytes, 0, take * 2);
                        chunkSamples += take;
                        off += take;
                        l.mediaSamples = committed + chunkSamples;
                        if (chunkSamples >= Wav.CHUNK_SAMPLES) closeChunk();
                    }
                    if (MizelHub.wantsPcm()) pcm.append(buf, n, l.mediaSamples - n); else pcm.reset();
                    levelSamples += n;
                    if (levelSamples >= Wav.RATE / 5) { // ~5 level pushes a second
                        MizelHub.push(MizelProtocol.levelPush(Math.min(1f, levelPeak / 12000f)));
                        levelPeak = 0;
                        levelSamples = 0;
                    }
                }
            } catch (IOException e) {
                custodyFailed = true;
                Log.e(TAG, "chunk write failed", e);
            } finally {
                pcm.flush();
                try { if (out != null) closeChunk(); } catch (IOException e) { custodyFailed = true; Log.e(TAG, "last chunk failed", e); }
                if (rec != null) {
                    try { rec.stop(); } catch (IllegalStateException ignored) { }
                    rec.release();
                }
                Log.i(TAG, "AudioRecord released (" + l.meetingId + ")");
            }
        }

        private void openChunk() throws IOException {
            seq = store.currentSeq(l.meetingId);
            File tmp = store.tmpFile(l.meetingId, seq);
            //noinspection ResultOfMethodCallIgnored
            tmp.getParentFile().mkdirs();
            CaptureJournal.get(MeetingRecorderService.this).register(CaptureJournal.chunkId(l.meetingId, seq),
                    "meeting", "meeting_chunk", tmp, System.currentTimeMillis());
            out = new RandomAccessFile(tmp, "rw");
            out.setLength(0);
            out.write(Wav.header(0)); // placeholder; a dead process leaves a fixable file behind
            chunkSamples = 0;
        }

        private void closeChunk() throws IOException {
            RandomAccessFile f = out;
            out = null;
            if (f == null) return;
            long samples = chunkSamples;
            chunkSamples = 0;
            File tmp = store.tmpFile(l.meetingId, seq);
            if (samples == 0) {
                f.close();
                // No receipt/discard. Leave this placeholder in place, recoverable, rather than deleting on failure.
                CaptureJournal.get(MeetingRecorderService.this).stopped(CaptureJournal.chunkId(l.meetingId, seq));
                return;
            }
            f.seek(0);
            f.write(Wav.header(samples * Wav.BYTES_PER_SAMPLE));
            f.getFD().sync();
            f.close();
            File done = store.chunkFile(l.meetingId, seq);
            if (!tmp.renameTo(done)) throw new IOException("rename " + tmp + " failed");
            MizelJournal.Chunk c = store.chunkDone(l.meetingId, seq, samples, System.currentTimeMillis());
            committed += samples;
            l.mediaSamples = committed;
            if (c != null) Log.i(TAG, "chunk " + l.meetingId + " seq=" + c.seq + " start_ms=" + c.startMs + " samples=" + samples);
            uploader.kick();
        }

        /** Stop reading, flush the partial chunk, release the microphone. Blocks until done. */
        boolean finish() {
            running = false;
            try { join(3000); } catch (InterruptedException ignored) { }
            if (isAlive()) {
                Log.w(TAG, "capture thread slow to stop; stopping AudioRecord");
                if (rec != null) try { rec.stop(); } catch (IllegalStateException ignored) { }
                try { join(2000); } catch (InterruptedException ignored) { }
            }
            return !isAlive() && !custodyFailed;
        }
    }

    /* ------------------------------------------------------------------ notifications */

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_REC) == null) {
            NotificationChannel rec = new NotificationChannel(CH_REC, "Meeting recording", NotificationManager.IMPORTANCE_LOW);
            rec.setDescription("Shows while Mizel records a meeting, with Pause, Resume and Stop");
            rec.setShowBadge(false);
            nm.createNotificationChannel(rec);
        }
        if (nm.getNotificationChannel(CH_ALERT) == null) {
            NotificationChannel al = new NotificationChannel(CH_ALERT, "Meeting recording problems", NotificationManager.IMPORTANCE_HIGH);
            al.setDescription("A meeting recording ended unexpectedly");
            nm.createNotificationChannel(al);
        }
    }

    static PendingIntent openMeeting(Context c, String id, int req) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(MizelConfig.origin(c) + LIVE_PATH + (id == null ? "" : Uri.encode(id))))
                .setClass(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent action(String a, int req) {
        Live l = live;
        Intent i = new Intent(this, MeetingRecorderService.class).setAction(a).putExtra(EXTRA_MEETING, l == null ? null : l.meetingId);
        return PendingIntent.getService(this, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildRecording(Live l) {
        Notification.Builder b = new Notification.Builder(this, CH_REC)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        if (l == null) return b.setContentTitle("Mizel").setContentText("Starting…").build();
        b.setContentIntent(openMeeting(this, l.meetingId, 1));
        boolean ticking = !MizelConfig.qaStaticNotification(this);
        if (l.paused) {
            long ends = l.pausedAtWall + MizelConfig.pauseTimeoutMs(this);
            b.setContentTitle("Meeting paused · " + MizelPolicy.duration(l.mediaMs()) + " recorded")
                    .setContentText("Microphone off. Ends by itself in " + MizelPolicy.duration(Math.max(0, ends - System.currentTimeMillis())))
                    .setWhen(ends).setShowWhen(true).setUsesChronometer(ticking).setChronometerCountDown(true)
                    .addAction(new Notification.Action.Builder(null, "Resume", action(ACTION_RESUME, 3)).build())
                    .addAction(new Notification.Action.Builder(null, "Stop", action(ACTION_STOP, 4)).build());
        } else {
            b.setContentTitle("Recording meeting")
                    .setContentText("Mizel is listening · tap to open")
                    .setWhen(System.currentTimeMillis() - l.mediaMs()).setShowWhen(true).setUsesChronometer(ticking)
                    .addAction(new Notification.Action.Builder(null, "Pause", action(ACTION_PAUSE, 2)).build())
                    .addAction(new Notification.Action.Builder(null, "Stop", action(ACTION_STOP, 4)).build());
        }
        return b.build();
    }

    private boolean foreground() {
        try {
            startForegroundCompat(buildRecording(live), true);
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "startForeground refused", e);
            return false;
        }
    }

    private void startForegroundCompat(Notification n, boolean mic) {
        if (Build.VERSION.SDK_INT >= 30) startForeground(N_REC, n, mic ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE);
        else startForeground(N_REC, n);
    }

    private long lastNoteAt;

    private void refreshNotification(boolean force) {
        Live l = live;
        if (l == null) return;
        long now = SystemClock.elapsedRealtime();
        long every = MizelConfig.qaStaticNotification(this) ? 5000 : l.paused ? 1000 : 15_000;
        if (!force && now - lastNoteAt < every) return; // the chronometer counts by itself
        lastNoteAt = now;
        getSystemService(NotificationManager.class).notify(N_REC, buildRecording(l));
    }

    private void showDraining(int pend) {
        Notification n = new Notification.Builder(this, CH_REC)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setOngoing(true).setOnlyAlertOnce(true)
                .setContentTitle("Saving meeting")
                .setContentText(pend == 0 ? "Finishing…" : "Uploading " + pend + " piece" + (pend == 1 ? "" : "s") + " of audio")
                .build();
        getSystemService(NotificationManager.class).notify(N_REC, n);
    }

    static void notifyEnded(Context c, String id, long at) {
        channels(c);
        String hhmm = MizelPolicy.clock(at, TimeZone.getDefault());
        Notification n = new Notification.Builder(c, CH_ALERT)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("Recording ended unexpectedly at " + hhmm)
                .setContentText("Everything recorded until then is saved and uploading.")
                .setContentIntent(openMeeting(c, id, 5))
                .setAutoCancel(true)
                .build();
        try { c.getSystemService(NotificationManager.class).notify(N_ENDED_BASE + (id.hashCode() & 0x7), n); }
        catch (RuntimeException e) { Log.w(TAG, "could not post the ended notice", e); }
        Log.i(TAG, "notified: Recording ended unexpectedly at " + hhmm + " (" + id + ")");
    }

    /* ------------------------------------------------------------------ util */

    private void acquireWake() {
        if (wake == null) {
            wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WizardOS:mizel");
            wake.setReferenceCounted(false);
        }
        try { wake.acquire(4 * 60 * 60_000L); }
        catch (RuntimeException e) { Log.w(TAG, "wake lock refused; recording continues without it", e); }
    }

    private void releaseWake() {
        if (wake != null && wake.isHeld()) wake.release();
    }

    private void toast(String s) { main.post(() -> Toast.makeText(this, s, Toast.LENGTH_LONG).show()); }
}
