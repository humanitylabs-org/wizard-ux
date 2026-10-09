package ai.wizards.os.assist;

import ai.wizards.os.BuildConfig;
import ai.wizards.os.R;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import java.io.File;

import ai.wizards.os.everywhere.EverywhereOutbox;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * One capture engine for the whole app: the microphone, the pause detector and the trip to
 * Wizard voice. The lock-screen surface (an activity) and the corner orb (the assistant session
 * window) are just two views of it, so a recording survives moving from one to the other —
 * e.g. unlocking mid-sentence shrinks the full surface into the corner orb without a gap.
 */
final class VoiceCapture {
    static final String TAG = AssistLockActivity.TAG;

    interface View {
        void onBegin();
        void onLevel(float level);
        void onNothing();
        void onSending(String via);
        void onHeard(String text, long ms);
        void onError(String kind, String message);
        /** Wizard accepted it: the thread to open. */
        default void onDelivered(String sessionId) { }
        /** Wizard isn't reachable yet: it's saved on the phone and retrying by itself. */
        default void onQueued(String why) { }
        default void onPaused(boolean paused) { }
    }

    private static VoiceCapture instance;

    static synchronized VoiceCapture get(Context c) {
        if (instance == null) instance = new VoiceCapture(c.getApplicationContext());
        return instance;
    }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final CaptureStore store;
    private View view;
    private MediaRecorder recorder;
    private File recording;
    private File qaAudio;
    private SilenceDetector detector;
    private boolean listening;
    private boolean sending;
    private boolean paused;
    private final android.app.KeyguardManager keyguard;
    private long startedAt;

    private VoiceCapture(Context app) {
        this.app = app;
        this.store = new CaptureStore(app);
        this.keyguard = (android.app.KeyguardManager) app.getSystemService(Context.KEYGUARD_SERVICE);
    }

    CaptureStore store() { return store; }

    boolean listening() { return listening; }

    /** Only a live recording blocks a new one: anything already said is in the outbox and delivers by itself. */
    boolean busy() { return listening; }

    /** The view that receives events; a new view takes over from the old one. */
    void attach(View v) { view = v; }

    void detach(View v) { if (view == v) view = null; }

    /**
     * Start listening. qa is a debug-only canned recording (the emulator has no microphone);
     * autoSendMs > 0 sends it automatically.
     */
    void start(File qa, long autoSendMs) {
        if (listening) return;
        discard();
        qaAudio = qa;
        if (qa == null && app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            emitError("mic", "Open Wizard OS once and allow the microphone.");
            return;
        }
        try {
            recording = new File(app.getCacheDir(), "wizard-lock-" + SystemClock.elapsedRealtime() + ".m4a");
            MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(app) : new MediaRecorder();
            r.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION);
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            r.setAudioChannels(1);
            r.setAudioSamplingRate(32000);
            r.setAudioEncodingBitRate(64000);
            r.setOutputFile(recording.getAbsolutePath());
            preferBuiltInMic(r);
            r.prepare();
            r.start();
            recorder = r;
        } catch (Exception e) {
            dropRecorder();
            if (qa == null) {
                Log.w(TAG, "recorder failed", e);
                emitError("mic", "The microphone is busy. Try again in a moment.");
                return;
            }
            Log.i(TAG, "qa: no emulator mic, using qa_audio");
        }
        listening = true;
        startedAt = SystemClock.elapsedRealtime();
        detector = SilenceDetector.standard();
        Log.i(TAG, "listening");
        if (view != null) view.onBegin();
        main.post(meter);
        paused = false;
        if (autoSendMs > 0) main.postDelayed(qaSend = () -> { if (paused) main.postDelayed(qaSend, 500); else send("qa"); }, autoSendMs);
    }

    private void preferBuiltInMic(MediaRecorder r) {
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
                r.setPreferredDevice(d);
                return;
            }
        }
    }

    private final Runnable meter = new Runnable() {
        @Override
        public void run() {
            if (!listening) return;
            int amp = 0;
            MediaRecorder r = recorder;
            if (r != null) {
                try {
                    amp = r.getMaxAmplitude();
                } catch (IllegalStateException e) {
                    return;
                }
            }
            if (view != null) view.onLevel(Math.min(1f, amp / 12000f));
            if (qaAudio == null && !paused) {
                SilenceDetector.Result res = detector.feed(amp, SystemClock.elapsedRealtime());
                if (res == SilenceDetector.Result.SEND) {
                    send("pause");
                    return;
                }
                if (res == SilenceDetector.Result.NOTHING_HEARD) {
                    Log.i(TAG, "nothing heard");
                    discard();
                    if (view != null) view.onNothing();
                    return;
                }
            }
            main.postDelayed(this, 90);
        }
    };

    void send(String via) {
        if (!listening) return;
        listening = false;
        main.removeCallbacks(meter);
        if (paused && recorder != null) try { recorder.resume(); } catch (IllegalStateException ignored) { }
        paused = false;
        MediaRecorder r = recorder;
        recorder = null;
        long heldMs = SystemClock.elapsedRealtime() - startedAt;
        boolean ok = r != null;
        if (r != null) {
            try {
                r.stop();
            } catch (RuntimeException e) {
                ok = false; // stop() throws when nothing was captured
            }
            r.release();
        }
        final File qa = qaAudio;
        final File audio = qa != null ? qa : recording;
        recording = null;
        if ((!ok && qa == null) || audio == null || !audio.isFile() || audio.length() < 512) {
            if (audio != null && qa == null) //noinspection ResultOfMethodCallIgnored
                audio.delete();
            if (view != null) view.onNothing();
            return;
        }
        boolean locked = keyguard != null && keyguard.isKeyguardLocked();
        Log.i(TAG, "sending via=" + via + " ms=" + heldMs + " locked=" + locked + (qa != null ? " qa_audio=" + qa.getName() : ""));
        // Same path as the floating orb: saved on the phone first, then words → Wizard, retried until it lands.
        // No draft, no confirm: holding the side button and talking is sending.
        final EverywhereOutbox.Item it;
        try {
            it = outbox().enqueueRecording(audio, EverywhereOutbox.SRC_SIDE, null, locked);
        } catch (Exception e) {
            Log.e(TAG, "could not keep the recording", e);
            emitError("net", "Couldn’t save that recording on the phone.");
            return;
        }
        pendingId = it.id;
        reported = false;
        sending = true;
        if (view != null) view.onSending(via);
        main.removeCallbacks(slow);
        main.postDelayed(slow, 15000);
    }

    /* ---------------------------------------------------------------- following the message */

    private String pendingId;
    private boolean reported;
    private EverywhereOutbox ob;

    private EverywhereOutbox outbox() {
        if (ob == null) {
            ob = EverywhereOutbox.get(app);
            ob.addListener(follow);
        }
        return ob;
    }

    /** Wizard is slow to answer: say it's safe on the phone and free the button. The outbox keeps going. */
    private final Runnable slow = () -> {
        if (pendingId == null || reported) return;
        EverywhereOutbox.Item it = ob == null ? null : ob.item(pendingId);
        queued(it != null && !it.error.isEmpty() ? it.error : "Still sending");
    };

    private void queued(String why) {
        reported = true;
        sending = false;
        Log.i(TAG, "queued: " + why);
        if (view != null) view.onQueued(why);
    }

    private final EverywhereOutbox.Listener follow = new EverywhereOutbox.Listener() {
        @Override
        public void onWords(EverywhereOutbox.Item it, String text) {
            if (!it.id.equals(pendingId)) return;
            store.add(text, System.currentTimeMillis());
            Log.i(TAG, "transcribed chars=" + text.length());
            if (view != null && !reported) view.onHeard(text, SystemClock.elapsedRealtime() - startedAt);
        }

        @Override
        public void onSent(EverywhereOutbox.Item it) {
            if (!it.id.equals(pendingId)) return;
            pendingId = null;
            sending = false;
            main.removeCallbacks(slow);
            Log.i(TAG, "delivered session=" + it.sessionId);
            if (view != null) view.onDelivered(it.sessionId);
        }

        @Override
        public void onOutboxChanged() {
            main.post(() -> {
                if (pendingId == null || ob == null) return;
                EverywhereOutbox.Item it = ob.item(pendingId);
                if (it == null || "empty".equals(it.state)) {     // nothing intelligible in the recording
                    pendingId = null; sending = false; main.removeCallbacks(slow);
                    if (view != null) view.onNothing();
                    return;
                }
                if (!reported && it.attempts > 0 && ("waiting".equals(it.state) || "failed".equals(it.state))) queued(it.error);
            });
        }
    };

    private Runnable qaSend;

    boolean paused() { return paused; }

    /** Pause / resume the recording (the Pause control). The pause detector stops its clock while paused. */
    void togglePause() {
        if (!listening) return;
        long now = SystemClock.elapsedRealtime();
        try {
            if (!paused) { if (recorder != null) recorder.pause(); detector.pause(now); }
            else { if (recorder != null) recorder.resume(); detector.resume(now); }
        } catch (IllegalStateException e) { Log.w(TAG, "pause failed", e); return; }
        paused = !paused;
        Log.i(TAG, paused ? "paused" : "resumed");
        if (view != null) view.onPaused(paused);
    }

    /** Stop and throw the recording away (Back, cancel, screen off). Never sends. */
    void discard() {
        listening = false;
        paused = false;
        main.removeCallbacks(meter);
        if (qaSend != null) main.removeCallbacks(qaSend);
        dropRecorder();
        if (recording != null) {
            //noinspection ResultOfMethodCallIgnored
            recording.delete();
            recording = null;
        }
    }

    private void dropRecorder() {
        if (recorder != null) {
            try { recorder.stop(); } catch (RuntimeException ignored) { }
            recorder.release();
            recorder = null;
        }
    }

    private void emitError(String kind, String msg) {
        if (view != null) view.onError(kind, msg);
    }

    /* ---------------------------------------------------------------- debug-only QA hook */

    /**
     * Debug builds only: a QA run stages files/qa_next.m4a; the next listen uses it (the emulator
     * has no microphone) and auto-sends after 2.5 s. Consumed once. Release builds never read it.
     */
    static File takeQaNext(Context c) {
        if (!BuildConfig.DEBUG) return null;
        File f = new File(c.getFilesDir(), "qa_next.m4a");
        if (!f.isFile()) return null;
        File used = new File(c.getFilesDir(), "qa_used.m4a");
        //noinspection ResultOfMethodCallIgnored
        used.delete();
        return f.renameTo(used) ? used : null;
    }
}
