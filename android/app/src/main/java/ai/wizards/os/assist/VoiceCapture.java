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
    private long startedAt;

    private VoiceCapture(Context app) {
        this.app = app;
        this.store = new CaptureStore(app);
    }

    CaptureStore store() { return store; }

    boolean listening() { return listening; }

    boolean busy() { return listening || sending; }

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
        if (autoSendMs > 0) main.postDelayed(() -> send("qa"), autoSendMs);
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
            if (qaAudio == null) {
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
        final File own = recording;
        recording = null;
        if (!ok && qa == null) {
            if (own != null) //noinspection ResultOfMethodCallIgnored
                own.delete();
            if (view != null) view.onNothing();
            return;
        }
        Log.i(TAG, "sending via=" + via + " ms=" + heldMs + (qa != null ? " qa_audio=" + qa.getName() : ""));
        sending = true;
        if (view != null) view.onSending(via);
        io.execute(() -> {
            try {
                Transcriber.Result t = Transcriber.transcribe(audio);
                if (own != null) //noinspection ResultOfMethodCallIgnored
                    own.delete();
                main.post(() -> {
                    sending = false;
                    if (t.text.isEmpty()) {
                        if (view != null) view.onNothing();
                        return;
                    }
                    store.add(t.text, System.currentTimeMillis());
                    Log.i(TAG, "transcribed ms=" + t.ms + " chars=" + t.text.length());
                    if (view != null) view.onHeard(t.text, t.ms);
                });
            } catch (Exception e) {
                if (own != null) //noinspection ResultOfMethodCallIgnored
                    own.delete();
                Log.w(TAG, "transcribe failed: " + e.getMessage());
                main.post(() -> {
                    sending = false;
                    emitError("net", "Couldn’t reach Wizard voice. Is Tailscale on?");
                });
            }
        });
    }

    /** Stop and throw the recording away (Back, cancel, screen off). Never sends. */
    void discard() {
        listening = false;
        main.removeCallbacks(meter);
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
