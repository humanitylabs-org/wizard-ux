package ai.wizards.os.recording;

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
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import ai.wizards.os.BuildConfig;
import ai.wizards.os.MainActivity;
import ai.wizards.os.device.DeviceBridge;

/**
 * The orb's recorder (gap #14). A foreground service of type microphone, so a take keeps going when the screen
 * locks or James leaves the app, with an ongoing notification that has Stop and Send. Audio goes straight to
 * disk as AAC ADTS (RecordingStore), so an app kill loses at most the last frame and the take is recovered on
 * the next start. The web shell drives it through WizardOSDevice.rec* (DeviceBridge, web/device.js).
 */
public class RecorderService extends Service {
    static final String TAG = "WizardRecorder";
    public static final String CH_RECORDING = "recording";
    static final String ACTION_START = "ai.wizards.os.rec.START";
    static final String ACTION_PAUSE = "ai.wizards.os.rec.PAUSE";
    static final String ACTION_RESUME = "ai.wizards.os.rec.RESUME";
    public static final String ACTION_STOP = "ai.wizards.os.rec.STOP";   // notification Stop: keep the take, send nothing
    public static final String ACTION_SEND = "ai.wizards.os.rec.SEND";   // notification Send
    static final String ACTION_CANCEL = "ai.wizards.os.rec.CANCEL";
    static final String EXTRA_ID = "id";
    static final int N_RECORDING = 7301, N_SAVED = 7302;

    /** The one live take (process-wide). */
    private static volatile String activeId, stopWanted;
    private static volatile boolean paused;
    private static volatile long startedAt, pausedMs, pauseStart;
    private static volatile int level; // 0..100 for the orb
    private static volatile String source = "";
    private static volatile Listener listener;
    private static RecorderService live;

    public interface Listener { void onRecorderEvent(String type, String id); }

    private MediaRecorder rec;
    private String holding; // a stopped take the app is still sending
    private Thread canned; // debug builds only: the emulator has no microphone
    private volatile boolean cannedRun;
    private PowerManager.WakeLock cpu;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable meter = new Runnable() {
        @Override public void run() {
            try { if (rec != null && !paused) level = Math.min(100, (int) (Math.sqrt(rec.getMaxAmplitude()) / 1.81)); } catch (RuntimeException ignored) { }
            if (rec != null) main.postDelayed(this, 90);
        }
    };

    /* ------------------------------------------------------------------ API for the bridge */

    public static void setListener(Listener l) { listener = l; }
    public static String active() { return activeId; }
    public static int level() { return level; }
    public static boolean isPaused() { return paused; }
    public static String source() { return source; }

    public static long elapsedMs() {
        if (activeId == null) return 0;
        long now = SystemClock.elapsedRealtime();
        return Math.max(0, now - startedAt - pausedMs - (paused ? now - pauseStart : 0));
    }

    public static boolean micAllowed(Context c) {
        return c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    /** Starts a take and returns its id; "" when the mic is not allowed. A running take is returned as-is. */
    public static synchronized String start(Context c, String kind) {
        if (!micAllowed(c)) return "";
        if (activeId != null) return activeId;
        String id = RecordingStore.get(c).create(kind);
        activeId = id; stopWanted = null; paused = false; pausedMs = 0; level = 0; source = "";
        startedAt = SystemClock.elapsedRealtime();
        Intent i = new Intent(c, RecorderService.class).setAction(ACTION_START).putExtra(EXTRA_ID, id);
        try { c.startForegroundService(i); }
        catch (RuntimeException e) { Log.w(TAG, "start: " + e); activeId = null; RecordingStore.get(c).delete(id); return ""; }
        return id;
    }

    public static void pause(Context c, boolean on) { command(c, on ? ACTION_PAUSE : ACTION_RESUME); }
    public static void cancel(Context c, String id) { if (id != null && id.equals(activeId)) command(c, ACTION_CANCEL); }

    private static void command(Context c, String action) {
        if (activeId == null) return;
        try { c.startService(new Intent(c, RecorderService.class).setAction(action).putExtra(EXTRA_ID, activeId)); }
        catch (RuntimeException e) { Log.w(TAG, action + ": " + e); }
    }

    /** The app's "send": stop the take now and wait (bridge thread, never the UI thread) until the file is closed. */
    public static void stopNow(String id, String via) {
        if (id == null || !id.equals(activeId)) return;
        stopWanted = id;
        final CountDownLatch done = new CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(() -> {
            RecorderService s = live;
            if (s != null && id.equals(activeId) && (s.rec != null || s.canned != null)) s.finishTake("stopped", via);
            done.countDown();
        });
        try {
            done.await(3, TimeUnit.SECONDS);
            for (int i = 0; i < 30 && id.equals(activeId); i++) Thread.sleep(100); // still starting: begin() honours stopWanted
        } catch (InterruptedException ignored) { }
    }

    /* ------------------------------------------------------------------ service */

    @Override
    public void onCreate() {
        super.onCreate();
        live = this;
        channel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? null : intent.getAction();
        String id = intent == null ? null : intent.getStringExtra(EXTRA_ID);
        if (a == null || activeId == null) { // a stale tap, or restarted after a kill: the take on disk is recovered by the app
            if (ACTION_START.equals(a)) foreground();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        switch (a) {
            case ACTION_START:
                holding = null;
                main.removeCallbacksAndMessages(null);
                if (!foreground()) { finishTake("failed", "fgs"); return START_NOT_STICKY; }
                begin(id);
                break;
            case ACTION_PAUSE:
                if (!paused && (rec != null || canned != null)) {
                    try { if (rec != null) rec.pause(); paused = true; pauseStart = SystemClock.elapsedRealtime(); } catch (RuntimeException ignored) { }
                }
                notifyRecording();
                break;
            case ACTION_RESUME:
                if (paused) {
                    try { if (rec != null) rec.resume(); pausedMs += SystemClock.elapsedRealtime() - pauseStart; paused = false; } catch (RuntimeException ignored) { }
                }
                notifyRecording();
                break;
            case ACTION_STOP:
            case ACTION_SEND:
                if (id != null && id.equals(activeId)) {
                    boolean send = ACTION_SEND.equals(a);
                    String take = activeId;
                    if (send) RecordingStore.get(this).set(take, "send", true);
                    finishTake("stopped", send ? "notification-send" : "notification-stop");
                    Listener l = listener;
                    if (l != null) l.onRecorderEvent(send ? "send" : "stopped", take);
                    else savedNotice(take, send);
                }
                break;
            case ACTION_CANCEL:
                if (id != null && id.equals(activeId)) {
                    String take = activeId;
                    finishTake("cancelled", "app");
                    RecordingStore.get(this).delete(take);
                }
                break;
            default:
                break;
        }
        return START_NOT_STICKY;
    }

    private void begin(String id) {
        if (id == null || !id.equals(activeId)) { stopSelf(); return; }
        File out = RecordingStore.get(this).audio(id);
        File qa = new File(getFilesDir(), "qa_mic.aac");
        if (BuildConfig.DEBUG && qa.isFile()) {
            startCanned(qa, out);
        } else {
            try {
                MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : legacyRecorder();
                r.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION);
                r.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS);
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                r.setAudioChannels(1);
                r.setAudioSamplingRate(44100);
                r.setAudioEncodingBitRate(64000);
                r.setOutputFile(out.getAbsolutePath());
                r.prepare();
                r.start();
                rec = r;
                source = "mic";
            } catch (Exception e) {
                Log.w(TAG, "recorder failed: " + e);
                RecordingStore.get(this).set(id, "error", String.valueOf(e.getMessage()));
                finishTake("failed", "error");
                RecordingStore.get(this).delete(id);
                Listener l = listener;
                if (l != null) l.onRecorderEvent("error", id);
                return;
            }
            main.post(meter);
        }
        PowerManager pm = getSystemService(PowerManager.class);
        cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WizardOS:recording");
        cpu.acquire(2 * 60 * 60 * 1000L); // a take never runs past two hours
        RecordingStore.get(this).set(id, "source", source);
        Log.i(TAG, "recording " + id + " source=" + source);
        notifyRecording();
        if (id.equals(stopWanted)) finishTake("stopped", "app");
    }

    /** QA builds: stream a canned AAC file to disk at roughly real time, so lifecycle QA works without a mic. */
    private void startCanned(File qa, File out) {
        source = "qa";
        cannedRun = true;
        canned = new Thread(() -> {
            byte[] src;
            try (FileInputStream in = new FileInputStream(qa)) { src = ai.wizards.os.device.Http.readAll(in); }
            catch (IOException e) { return; }
            try (FileOutputStream w = new FileOutputStream(out, true)) {
                int off = 0;
                while (cannedRun) {
                    if (!paused) {
                        int n = Math.min(2000, src.length - off); // ~32 kbit/s in 250 ms steps
                        w.write(src, off, n); w.flush();
                        off = (off + n) % src.length;
                        level = 20 + (int) (Math.random() * 40);
                    } else level = 0;
                    Thread.sleep(250);
                }
                w.getFD().sync();
            } catch (IOException | InterruptedException ignored) { }
        }, "wizard-qa-mic");
        canned.start();
    }

    @SuppressWarnings("deprecation")
    private static MediaRecorder legacyRecorder() { return new MediaRecorder(); }

    /** Stops the recorder and the service; the file stays for the app to collect. Main thread. */
    private void finishTake(String state, String via) {
        String id = activeId;
        if (rec != null) {
            try { rec.stop(); } catch (RuntimeException ignored) { } // too short: the file may be empty
            try { rec.release(); } catch (RuntimeException ignored) { }
            rec = null;
        }
        if (canned != null) {
            cannedRun = false;
            try { canned.join(1500); } catch (InterruptedException ignored) { }
            canned = null;
        }
        main.removeCallbacks(meter);
        if (cpu != null && cpu.isHeld()) cpu.release();
        cpu = null;
        if (id != null) {
            RecordingStore st = RecordingStore.get(this);
            st.set(id, "ms", elapsedMs());
            st.set(id, "stoppedAt", System.currentTimeMillis());
            st.set(id, "via", via);
            st.set(id, "state", state);
        }
        activeId = null; stopWanted = null; paused = false; level = 0;
        Log.i(TAG, "take " + id + " " + state + " via=" + via);
        if (id != null && listener != null && "stopped".equals(state)) {
            // The app takes it from here (transcribe, outbox). Stay in the foreground until it says it has the take
            // safe (recDone), so a screen that is off or an app in the background can't freeze the send half-way.
            holding = id;
            getSystemService(NotificationManager.class).notify(N_RECORDING, sending());
            main.postDelayed(() -> { if (activeId == null) release(); }, 120_000);
            return;
        }
        release();
    }

    private void release() {
        holding = null;
        main.removeCallbacksAndMessages(null);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /** The app has the take safe (in the outbox, or handled): end the "Sending" hold. */
    public static void done(String id) {
        new Handler(Looper.getMainLooper()).post(() -> {
            RecorderService s = live;
            if (s != null && id != null && id.equals(s.holding) && activeId == null) s.release();
        });
    }

    private Notification sending() {
        return new Notification.Builder(this, CH_RECORDING)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Sending to Wizard…")
                .setContentText("Your recording is saved on this phone")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

    @Override
    public void onDestroy() {
        if (rec != null || canned != null) finishTake("interrupted", "destroyed");
        if (live == this) live = null;
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // James swiped Wizard OS away mid-take: the recording keeps going (it is his, and the notification has
        // Stop and Send). Nothing to do here; the service is foreground and outlives the task.
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    /* ------------------------------------------------------------------ notifications */

    static void channel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_RECORDING) != null) return;
        NotificationChannel ch = new NotificationChannel(CH_RECORDING, "Recording", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows while the orb is recording, with Stop and Send");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private Notification build() {
        PendingIntent open = PendingIntent.getActivity(this, 31, new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(this, CH_RECORDING)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(paused ? "Recording paused" : "Recording for Wizard")
                .setContentText(paused ? "Tap Send when you’re done" : "Keeps going with the screen off · Send when you’re done")
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(null, "Stop", action(ACTION_STOP, 32)).build())
                .addAction(new Notification.Action.Builder(null, "Send", action(ACTION_SEND, 33)).build());
        if (!paused) b.setUsesChronometer(true).setWhen(System.currentTimeMillis() - elapsedMs());
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private PendingIntent action(String a, int req) {
        return PendingIntent.getService(this, req, new Intent(this, RecorderService.class).setAction(a).putExtra(EXTRA_ID, activeId),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
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
        if (activeId == null) return;
        getSystemService(NotificationManager.class).notify(N_RECORDING, build());
    }

    /** The app is not open: say the take is safe, and let a tap finish the job in Wizard OS. */
    private void savedNotice(String id, boolean send) {
        if (id == null) return;
        Intent i = new Intent(this, MainActivity.class).setAction(DeviceBridge.ACTION_RECOVER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 34, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CH_RECORDING)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(send ? "Recording saved · tap to send" : "Recording saved")
                .setContentText(send ? "Open Wizard OS and it sends" : "Open Wizard OS to send or delete it")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        getSystemService(NotificationManager.class).notify(N_SAVED, n);
    }

    public static void clearSavedNotice(Context c) {
        c.getSystemService(NotificationManager.class).cancel(N_SAVED);
    }
}
