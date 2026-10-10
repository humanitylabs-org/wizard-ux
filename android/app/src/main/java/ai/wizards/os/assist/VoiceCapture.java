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
import java.util.ArrayList;
import java.util.List;

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
    /** Screenshots taken with the corner orb's Screen button while talking; they ride with this take. */
    static final int MAX_SHOTS = 4;
    private final List<byte[]> shots = new ArrayList<>();

    private VoiceCapture(Context app) {
        this.app = app;
        this.store = new CaptureStore(app);
        this.keyguard = (android.app.KeyguardManager) app.getSystemService(Context.KEYGUARD_SERVICE);
        recoverOrphans(app, null); // a take cut off by a kill / update / crash in the previous process
    }

    /* ---------------------------------------------------------------- crash-proof takes (0.8.6) */

    /**
     * Side-button takes record straight into files/side-takes/ as AAC ADTS: every frame on disk is playable on its
     * own, so if the process dies mid-take (an app update, Android reclaiming memory, a crash) everything said up to
     * that moment survives. On the next start the orphan is handed to the outbox and sent like any other take.
     * Cancel and "nothing heard" delete the file, so only real, unfinished takes are recovered.
     */
    static File takesDir(Context c) {
        File d = new File(c.getFilesDir(), "side-takes");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    private static boolean recovered;

    /** Boot / app-updated receiver: recover a cut-off take without waiting for the next side-button press. */
    public static void recoverAfterRestart(Context c) { get(c); }

    /** Sends any take a dead process left behind (once per process). {@code live}: this process's own take, skipped. */
    static synchronized void recoverOrphans(Context c, File live) {
        if (recovered) return;
        recovered = true;
        File[] fs = takesDir(c).listFiles();
        if (fs == null) return;
        int n = 0;
        for (File f : fs) {
            if (f.equals(live) || !f.getName().endsWith(".aac")) continue;
            if (!TakeRecovery.worthSending(f.length())) { //noinspection ResultOfMethodCallIgnored
                f.delete(); continue; }
            try {
                EverywhereOutbox.get(c).enqueueRecording(f, EverywhereOutbox.SRC_SIDE, null, false);
                n++;
                Log.i(TAG, "recovered an unfinished take bytes=" + f.length() + " -> outbox");
            } catch (Exception e) { Log.w(TAG, "could not recover " + f.getName(), e); }
        }
        if (n > 0) {
            final int count = n;
            new Handler(Looper.getMainLooper()).post(() -> android.widget.Toast.makeText(c.getApplicationContext(),
                    count == 1 ? "Recovered your unfinished message · sending to Wizard" : "Recovered " + count + " unfinished messages · sending to Wizard",
                    android.widget.Toast.LENGTH_LONG).show());
        }
    }

    CaptureStore store() { return store; }

    boolean listening() { return listening; }

    int shotCount() { return shots.size(); }

    /** Attach a screenshot to the take in progress (max four). False when nothing is being recorded or it is full. */
    boolean addShot(byte[] png) {
        if (!listening || png == null || png.length == 0 || shots.size() >= MAX_SHOTS) return false;
        shots.add(png);
        Log.i(TAG, "screenshot attached " + shots.size() + " bytes=" + png.length);
        return true;
    }

    /**
     * The surface went away mid-take (Back, Home, screen off, another app). What was said is never lost:
     * if any speech was heard it is sent, exactly as if the pause had ended it; an empty take is dropped.
     * Only the Cancel button throws a take away on purpose.
     */
    void finishOnDismiss(String via) {
        DismissPolicy.Action a = DismissPolicy.onDismiss(listening, detector != null && detector.heardSpeech(), qaAudio != null);
        if (a == DismissPolicy.Action.NONE) return;
        Log.i(TAG, "dismissed while listening via=" + via + " action=" + a);
        if (a == DismissPolicy.Action.SEND) send(via);
        else discard();
    }

    /**
     * The surface was dismissed. A message still on its way finishes by itself in the outbox (saved on the phone
     * first), silently: no "still sending" / "sent" toasts hanging around (James, 10 Oct: snappy, no lingering).
     * Only trouble speaks up (queued toast, and the outbox's Not sent notification).
     */
    void noteDismissed() {
        if (sending && !reported) Log.i(TAG, "dismissed while sending; the outbox finishes it");
    }

    /** True once a take has been handed to the outbox (the surfaces close themselves right after). */
    boolean sending() { return sending; }

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
        if (!ai.wizards.os.MicOwner.tryAcquire(ai.wizards.os.MicOwner.SIDE)) { // one mic owner: a meeting may be recording
            String why = ai.wizards.os.MicOwner.reason(ai.wizards.os.MicOwner.SIDE);
            Log.i(TAG, "start refused: mic held by " + ai.wizards.os.MicOwner.holder());
            android.widget.Toast.makeText(app, why, android.widget.Toast.LENGTH_LONG).show();
            emitError("mic", why);
            return;
        }
        try {
            // ADTS on internal storage: what was said survives the process dying mid-take (see recoverOrphans)
            recording = new File(takesDir(app), "side-" + System.currentTimeMillis() + ".aac");
            MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(app) : new MediaRecorder();
            r.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION);
            r.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS);
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
                ai.wizards.os.MicOwner.release(ai.wizards.os.MicOwner.SIDE);
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
        ai.wizards.os.MicOwner.release(ai.wizards.os.MicOwner.SIDE);
        final File qa = qaAudio;
        final File audio = qa != null ? qa : recording;
        if (qa != null && recording != null) //noinspection ResultOfMethodCallIgnored
            recording.delete(); // QA stand-in audio was used; the emulator's own file is not a take to recover
        recording = null;
        if ((!ok && qa == null) || audio == null || !audio.isFile() || audio.length() < 512) {
            if (audio != null && qa == null) //noinspection ResultOfMethodCallIgnored
                audio.delete();
            if (view != null) view.onNothing();
            return;
        }
        boolean locked = keyguard != null && keyguard.isKeyguardLocked();
        Log.i(TAG, "sending via=" + via + " ms=" + heldMs + " locked=" + locked + " shots=" + shots.size() + (qa != null ? " qa_audio=" + qa.getName() : ""));
        // Same path as the floating orb: saved on the phone first, then words → Wizard, retried until it lands.
        // No draft, no confirm: holding the side button and talking is sending.
        final EverywhereOutbox.Item it;
        try {
            it = outbox().enqueueRecording(audio, EverywhereOutbox.SRC_SIDE, shots.isEmpty() ? null : new ArrayList<>(shots), locked);
        } catch (Exception e) {
            Log.e(TAG, "could not keep the recording", e);
            emitError("net", "Couldn’t save that recording on the phone.");
            return;
        }
        shots.clear();
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
        else toast("Saved on your phone · sends when Wizard is back");
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
                    else toast("Didn’t catch that");
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
        shots.clear();
        main.removeCallbacks(meter);
        if (qaSend != null) main.removeCallbacks(qaSend);
        dropRecorder();
        ai.wizards.os.MicOwner.release(ai.wizards.os.MicOwner.SIDE);
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

    /** The surface is gone (Back/Home) but the message is still on its way: say how it ended. */
    private void toast(String msg) {
        main.post(() -> {
            Log.i(TAG, "toast: " + msg);
            android.widget.Toast.makeText(app, msg, android.widget.Toast.LENGTH_SHORT).show();
        });
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

    /** Debug builds only: files/qa_autosend_ms.txt overrides the QA auto-send delay (0 = never; QA ends the take). */
    static long qaAutoSendMs(Context c, long dflt) {
        if (!BuildConfig.DEBUG) return dflt;
        File f = new File(c.getFilesDir(), "qa_autosend_ms.txt");
        if (!f.isFile()) return dflt;
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[32];
            int n = in.read(b);
            return n > 0 ? Long.parseLong(new String(b, 0, n, java.nio.charset.StandardCharsets.US_ASCII).trim()) : dflt;
        } catch (Exception e) { return dflt; }
    }
}
