package ai.wizards.shell.recorder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import ai.wizards.shell.BuildConfig;

/**
 * The shell's one native recorder: a microphone-type foreground service with an ongoing notification, so a take
 * keeps going with the screen locked or another app in front. Trimmed from android/app's RecorderService +
 * NoteRecorder: audio goes straight to disk as AAC ADTS ({@link TakeStore}), so an app kill loses at most the last
 * frame and the take is offered again on the next start. Driven only through the device.recording capability.
 */
public class RecorderService extends Service {
    static final String TAG = "ShellRecorder";
    private static final String CHANNEL = "recording";
    private static final String ACTION_START = "ai.wizards.shell.rec.START";
    private static final String ACTION_STOP = "ai.wizards.shell.rec.STOP"; // notification Stop: keep the take
    private static final String EXTRA_ID = "id";
    private static final int N_RECORDING = 4101;

    private static final Object LOCK = new Object();
    private static TakeStore store;
    private static volatile String activeId, activeOrigin, activeRef = "", lastId = "", lastState = "", lastOrigin = "";
    private static volatile boolean paused;
    private static volatile long startedAt, pausedMs, pauseStart;
    private static volatile int level;
    private static volatile RecorderService live;
    private static CountDownLatch started;
    private static volatile String startError;

    private MediaRecorder rec;
    private Thread canned;
    private volatile boolean cannedRun;
    private PowerManager.WakeLock cpu;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable meter = new Runnable() {
        @Override public void run() {
            MediaRecorder r = rec;
            try { if (r != null && !paused) level = Math.min(100, (int) (Math.sqrt(r.getMaxAmplitude()) / 1.81)); } catch (RuntimeException ignored) { }
            if (rec != null) main.postDelayed(this, 100);
        }
    };

    /* ------------------------------------------------------------------ API for the capability (background thread) */

    public static TakeStore store(Context c) {
        synchronized (LOCK) {
            if (store == null) store = new TakeStore(new File(c.getApplicationContext().getFilesDir(), "takes"));
            return store;
        }
    }

    public static String active() { return activeId; }

    public static long elapsedMs() {
        if (activeId == null) return 0;
        long now = SystemClock.elapsedRealtime();
        return Math.max(0, now - startedAt - pausedMs - (paused ? now - pauseStart : 0));
    }

    /** Whether the live take belongs to {@code origin}. */
    public static boolean owns(String id, String origin) {
        return id != null && id.equals(activeId) && origin != null && origin.equals(activeOrigin);
    }

    /**
     * {id, ref, state: recording|paused|idle|busy, ms, level, last: {id, state}} for the page's poll. Another Wizard's
     * live take shows only as "busy" (the microphone is taken), never its id.
     */
    public static JSONObject status(String origin) {
        JSONObject o = new JSONObject();
        try {
            String id = activeId;
            boolean mine = id != null && origin != null && origin.equals(activeOrigin);
            String state = id == null ? "idle" : !mine ? "busy" : paused ? "paused" : "recording";
            o.put("id", mine ? id : JSONObject.NULL).put("ref", mine ? activeRef : "").put("state", state)
                    .put("ms", mine ? elapsedMs() : 0).put("level", mine && !paused ? level : 0)
                    .put("last", origin != null && origin.equals(lastOrigin)
                            ? new JSONObject().put("id", lastId).put("state", lastState) : new JSONObject().put("id", "").put("state", ""));
        } catch (org.json.JSONException ignored) { }
        return o;
    }

    /** Starts a take and waits until the recorder is really running. Never call on the main thread. */
    public static String start(Context c, String proposedId, String kind, String ref, String origin) throws IOException {
        CountDownLatch latch;
        String id;
        synchronized (LOCK) {
            if (activeId != null) throw new IOException("Already recording");
            id = store(c).create(proposedId, kind, ref, origin, System.currentTimeMillis());
            activeId = id; activeOrigin = origin; activeRef = TakeStore.cleanRef(ref); paused = false; pausedMs = 0; level = 0; startError = null;
            startedAt = SystemClock.elapsedRealtime();
            latch = started = new CountDownLatch(1);
        }
        try {
            c.startForegroundService(new Intent(c, RecorderService.class).setAction(ACTION_START).putExtra(EXTRA_ID, id));
        } catch (RuntimeException e) {
            synchronized (LOCK) { activeId = null; activeOrigin = null; }
            store(c).finish(id, "failed", 0, System.currentTimeMillis());
            throw new IOException("The recorder could not start");
        }
        try { if (!latch.await(5, TimeUnit.SECONDS)) startError = "The recorder did not start"; }
        catch (InterruptedException e) { startError = "Interrupted"; }
        if (startError != null) {
            onMain(() -> { RecorderService s = live; if (s != null && id.equals(activeId)) s.finish("failed"); });
            throw new IOException(startError);
        }
        return id;
    }

    public static void pause(boolean on) {
        onMain(() -> { RecorderService s = live; if (s != null) s.setPaused(on); });
    }

    /** Ends the live take with {@code state} (stopped or cancelled) and describes what is kept. */
    public static JSONObject end(Context c, String id, String state) { return end(c, id, state, false); }

    /** {@code send}: stopped by the floating orb's tap, so the Wizard sends it (status last.state "sent"). */
    public static JSONObject end(Context c, String id, String state, boolean send) {
        if (id == null || !id.equals(activeId)) return null;
        final JSONObject[] out = new JSONObject[1];
        onMain(() -> { RecorderService s = live; if (s != null && id.equals(activeId)) out[0] = s.finish(state, send); });
        if (out[0] == null && id.equals(activeId)) {
            // No service (it died between calls): close the books on disk anyway; the bytes stay.
            synchronized (LOCK) { activeId = null; activeOrigin = null; activeRef = ""; }
            out[0] = store(c).finish(id, state, elapsedMs(), System.currentTimeMillis(), send);
        }
        return out[0];
    }

    private static void onMain(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) { r.run(); return; }
        CountDownLatch done = new CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(() -> { try { r.run(); } finally { done.countDown(); } });
        try { done.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
    }

    /* ------------------------------------------------------------------ service */

    @Override public void onCreate() {
        super.onCreate();
        live = this;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows while the Wizard is recording");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        String id = intent == null ? null : intent.getStringExtra(EXTRA_ID);
        if (ACTION_START.equals(a)) {
            if (!foreground()) { fail("Android refused the recording notification"); return START_NOT_STICKY; }
            if (id == null || !id.equals(activeId)) { release(); return START_NOT_STICKY; }
            begin(id);
        } else if (ACTION_STOP.equals(a) && id != null && id.equals(activeId)) {
            finish("stopped");
        } else if (activeId == null) {
            // A stale notification tap, or Android restarting us after a kill: the take on disk is recovered by the page.
            if (foreground()) release();
        }
        return START_NOT_STICKY;
    }

    private void fail(String why) {
        startError = why;
        CountDownLatch l = started;
        if (l != null) l.countDown();
    }

    private void begin(String id) {
        File out = store(this).audio(id);
        File qa = new File(getFilesDir(), "qa_mic.aac");
        try {
            if (BuildConfig.DEBUG && qa.isFile()) startCanned(qa, out); // the emulator has no microphone
            else startMic(out);
        } catch (Exception e) {
            Log.w(TAG, "recorder failed: " + e);
            fail("The microphone did not start");
            return;
        }
        cpu = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WizardShell:recording");
        cpu.acquire(2 * 60 * 60 * 1000L); // a take never runs past two hours
        Log.i(TAG, "recording " + id);
        notifyRecording();
        CountDownLatch l = started;
        if (l != null) l.countDown();
    }

    @SuppressWarnings("deprecation")
    private void startMic(File out) throws IOException {
        MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC);
            r.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS);
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            r.setAudioChannels(1);
            r.setAudioSamplingRate(44100);
            r.setAudioEncodingBitRate(64000);
            r.setOutputFile(out.getAbsolutePath());
            AudioDeviceInfo builtIn = builtInMic();
            if (builtIn != null) r.setPreferredDevice(builtIn); // the phone's own mic, not a Bluetooth headset's
            r.setOnErrorListener((m, what, extra) -> main.post(() -> { if (rec == m) finish("interrupted"); }));
            r.prepare();
            r.start();
        } catch (IOException | RuntimeException e) {
            try { r.release(); } catch (RuntimeException ignored) { }
            throw e instanceof IOException ? (IOException) e : new IOException(e);
        }
        rec = r;
        main.post(meter);
    }

    private AudioDeviceInfo builtInMic() {
        try {
            for (AudioDeviceInfo d : getSystemService(AudioManager.class).getDevices(AudioManager.GET_DEVICES_INPUTS))
                if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) return d;
        } catch (RuntimeException ignored) { }
        return null;
    }

    /** Debug builds only: stream a canned AAC file to disk at roughly real time, so lifecycle QA works without a mic. */
    private void startCanned(File qa, File out) throws IOException {
        byte[] src;
        try (InputStream in = new FileInputStream(qa); java.io.ByteArrayOutputStream all = new java.io.ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) != -1; ) all.write(buf, 0, n);
            src = all.toByteArray();
        }
        if (src.length == 0) throw new IOException("empty qa audio");
        cannedRun = true;
        canned = new Thread(() -> {
            try (FileOutputStream w = new FileOutputStream(out, true)) {
                int off = 0;
                while (cannedRun) {
                    if (!paused) {
                        int n = Math.min(2000, src.length - off); // ~64 kbit/s in 250 ms steps
                        w.write(src, off, n);
                        w.flush();
                        off = (off + n) % src.length;
                        level = 20 + (int) (Math.random() * 40);
                    } else level = 0;
                    Thread.sleep(250);
                }
                w.getFD().sync();
            } catch (IOException | InterruptedException ignored) { }
        }, "shell-qa-mic");
        canned.start();
    }

    private void setPaused(boolean on) {
        if (activeId == null || on == paused) return;
        try {
            if (rec != null) { if (on) rec.pause(); else rec.resume(); }
            if (on) pauseStart = SystemClock.elapsedRealtime(); else pausedMs += SystemClock.elapsedRealtime() - pauseStart;
            paused = on;
        } catch (RuntimeException e) { Log.w(TAG, "pause: " + e); }
        notifyRecording();
    }

    /** Stops the recorder and the service; the file stays in custody until the page acknowledges it. Main thread. */
    private JSONObject finish(String state) { return finish(state, false); }

    private JSONObject finish(String state, boolean send) {
        String id = activeId;
        long ms = elapsedMs();
        if (canned != null) {
            cannedRun = false;
            try { canned.join(1500); } catch (InterruptedException ignored) { }
            canned = null;
        }
        MediaRecorder r = rec;
        rec = null;
        if (r != null) {
            try { r.stop(); } catch (RuntimeException ignored) { /* keep any complete ADTS frames */ }
            try { r.release(); } catch (RuntimeException ignored) { }
        }
        main.removeCallbacks(meter);
        if (cpu != null && cpu.isHeld()) cpu.release();
        cpu = null;
        JSONObject out = null;
        synchronized (LOCK) {
            activeId = null; paused = false; level = 0;
            if (id != null) { lastId = id; lastState = send ? "sent" : state; lastOrigin = activeOrigin == null ? "" : activeOrigin; }
            activeOrigin = null; activeRef = "";
        }
        if (id != null) out = store(this).finish(id, state, ms, System.currentTimeMillis(), send);
        Log.i(TAG, "take " + id + " " + state);
        release();
        return out;
    }

    private void release() {
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        if (activeId != null && (rec != null || canned != null)) finish("interrupted");
        if (live == this) live = null;
        super.onDestroy();
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        // Swiped away mid-take: the recording keeps going (the notification has Stop); the service outlives the task.
        super.onTaskRemoved(rootIntent);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    /* ------------------------------------------------------------------ notification */

    private Notification build() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) open = new Intent();
        PendingIntent tap = PendingIntent.getActivity(this, 41, open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 42, new Intent(this, RecorderService.class).setAction(ACTION_STOP).putExtra(EXTRA_ID, activeId),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(paused ? "Recording paused" : "Recording for your Wizard")
                .setContentText(paused ? "Open the Wizard to carry on or send" : "Keeps going with the screen off · open the Wizard to send")
                .setContentIntent(tap)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(null, "Stop", stop).build());
        if (!paused) b.setUsesChronometer(true).setWhen(System.currentTimeMillis() - elapsedMs());
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private boolean foreground() {
        try {
            if (Build.VERSION.SDK_INT >= 30) startForeground(N_RECORDING, build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(N_RECORDING, build());
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "foreground: " + e);
            return false;
        }
    }

    private void notifyRecording() {
        if (activeId != null) getSystemService(NotificationManager.class).notify(N_RECORDING, build());
    }
}
