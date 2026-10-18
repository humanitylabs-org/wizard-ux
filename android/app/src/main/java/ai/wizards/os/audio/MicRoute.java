package ai.wizards.os.audio;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import android.util.Log;

import java.io.IOException;

/**
 * Every Wizard OS recording listens through the phone's own microphone (James's standing contract).
 *
 * Android otherwise follows the system input route: with a Bluetooth speaker or headset connected it can hand a
 * {@code VOICE_RECOGNITION} recording to that device's mic over SCO. The take then arrives near-silent and
 * band-limited (nothing above ~8 kHz) and speech-to-text invents words (18 Oct 2026).
 *
 * 0.9.27 asked for the built-in mic. 0.9.28 enforces it: after starting, the recorder's actual route is read back;
 * a take Android confirms on another input is stopped, retried once with the plain {@code MIC} source, and refused
 * if it still is not the phone's mic. Only the input is touched; Bluetooth playback keeps its route.
 * Pure decisions live in {@link #pick} and {@link #verdict} for unit tests.
 */
public final class MicRoute {
    private static final String TAG = "WizardOSMic";

    public static final String BUILTIN = "builtin", EXTERNAL = "external", UNKNOWN = "unknown", SYSTEM = "system";
    /** What the person is told when Android keeps the mic on another device. */
    public static final String EXTERNAL_MESSAGE =
            "Android moved the microphone to a Bluetooth or external device. Wizard records only from the phone's own mic. Try again.";
    /** Sources tried in order: the speech-tuned one, then the plain mic, which Android less often hands to Bluetooth. */
    public static final int[] SOURCES = {MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC};

    private MicRoute() {}

    /** Index of the built-in microphone among the given input device types, or -1 when the phone reports none. */
    public static int pick(int[] types) {
        if (types == null) return -1;
        for (int i = 0; i < types.length; i++) if (types[i] == AudioDeviceInfo.TYPE_BUILTIN_MIC) return i;
        return -1;
    }

    /**
     * Whether a started recorder may keep going. {@code routedType} is the device type Android reports, or -1 when it
     * has not said. Only a confirmed non-built-in route is refused; a phone that reports no built-in mic at all
     * keeps the system route rather than never recording.
     */
    public static String verdict(int routedType, boolean builtInAvailable) {
        if (!builtInAvailable) return SYSTEM;
        if (routedType < 0) return UNKNOWN;
        return routedType == AudioDeviceInfo.TYPE_BUILTIN_MIC ? BUILTIN : EXTERNAL;
    }

    /** The phone's built-in microphone, or null. */
    public static AudioDeviceInfo builtIn(Context c) {
        try {
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return null;
            AudioDeviceInfo[] ins = am.getDevices(AudioManager.GET_DEVICES_INPUTS);
            int[] types = new int[ins.length];
            for (int i = 0; i < ins.length; i++) types[i] = ins[i].getType();
            int at = pick(types);
            return at < 0 ? null : ins[at];
        } catch (RuntimeException e) {
            Log.w(TAG, "input list failed", e);
            return null;
        }
    }

    /** Builds a fresh, unconfigured recorder. */
    public interface Maker { MediaRecorder make(); }

    /** Configures a fresh recorder for {@code source}: set the source first, then format, encoder and output file. */
    public interface Setup { void apply(MediaRecorder r, int source) throws Exception; }

    /**
     * Opens and starts a MediaRecorder on the phone's built-in mic, or throws. Tries each of {@link #SOURCES}; a take
     * Android confirms on another input is stopped and released, never returned.
     */
    public static MediaRecorder start(Context c, Maker maker, Setup setup) throws IOException {
        AudioDeviceInfo mic = builtIn(c);
        IOException last = new IOException("The microphone did not start");
        for (int src : SOURCES) {
            MediaRecorder r = maker.make();
            boolean started = false;
            try {
                setup.apply(r, src);
                if (mic != null && !r.setPreferredDevice(mic)) throw new IOException("Android refused the phone's microphone");
                r.prepare();
                r.start();
                started = true;
                int type = type(awaitRouted(r));
                String v = verdict(type, mic != null);
                Log.i(TAG, "recorder source=" + src + " routed=" + typeName(type) + " -> " + v);
                if (!EXTERNAL.equals(v)) return r;
                last = new IOException(EXTERNAL_MESSAGE);
            } catch (Exception e) {
                Log.w(TAG, "recorder source=" + src + " failed: " + e);
                if (!EXTERNAL_MESSAGE.equals(last.getMessage()))
                    last = e instanceof IOException ? (IOException) e : new IOException(String.valueOf(e.getMessage()), e);
            }
            try { if (started) r.stop(); } catch (RuntimeException ignored) { }
            r.release();
        }
        throw last;
    }

    /**
     * Pins a constructed AudioRecord to the built-in mic, starts it and reads back its route. False (already stopped and
     * released) when it could not start or Android confirmed another input; the caller tries its next source.
     */
    public static boolean startOnBuiltIn(Context c, AudioRecord r) {
        AudioDeviceInfo mic = builtIn(c);
        if (mic != null && !r.setPreferredDevice(mic)) { Log.w(TAG, "audio record refused the built-in mic"); r.release(); return false; }
        try {
            r.startRecording();
        } catch (IllegalStateException e) {
            r.release();
            return false;
        }
        if (r.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) { r.release(); return false; }
        int type = type(awaitRouted(r));
        String v = verdict(type, mic != null);
        Log.i(TAG, "audio record routed=" + typeName(type) + " -> " + v);
        if (!EXTERNAL.equals(v)) return true;
        try { r.stop(); } catch (IllegalStateException ignored) { }
        r.release();
        return false;
    }

    /**
     * What this app is recording through right now, as the page's browser recorder sees it (18 Oct 2026): the
     * WebView's getUserMedia never passes through {@link #start}, so after the page opens the mic it asks here.
     * Returns {@link #verdict} over this app's active recordings: "external" if any is on another input.
     */
    public static String browserVerdict(Context c) {
        try {
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return UNKNOWN;
            boolean mic = builtIn(c) != null;
            String out = UNKNOWN;
            for (android.media.AudioRecordingConfiguration cfg : am.getActiveRecordingConfigurations()) {
                AudioDeviceInfo d = cfg.getAudioDevice();
                String v = verdict(d == null ? -1 : d.getType(), mic);
                Log.i(TAG, "browser recording routed=" + name(d) + " -> " + v);
                if (EXTERNAL.equals(v)) return EXTERNAL;
                if (!UNKNOWN.equals(v)) out = v;
            }
            return out;
        } catch (RuntimeException e) {
            Log.w(TAG, "recording list failed", e);
            return UNKNOWN;
        }
    }

    /** The message for a failed start: the Bluetooth refusal in plain words, otherwise {@code fallback}. */
    public static String why(Throwable e, String fallback) {
        return e != null && EXTERNAL_MESSAGE.equals(e.getMessage()) ? EXTERNAL_MESSAGE : fallback;
    }

    private static AudioDeviceInfo awaitRouted(MediaRecorder r) {
        for (int i = 0; i < 15; i++) {
            try { AudioDeviceInfo d = r.getRoutedDevice(); if (d != null) return d; } catch (RuntimeException e) { return null; }
            SystemClock.sleep(20);
        }
        return null;
    }

    private static AudioDeviceInfo awaitRouted(AudioRecord r) {
        for (int i = 0; i < 15; i++) {
            try { AudioDeviceInfo d = r.getRoutedDevice(); if (d != null) return d; } catch (RuntimeException e) { return null; }
            SystemClock.sleep(20);
        }
        return null;
    }

    private static int type(AudioDeviceInfo d) { return d == null ? -1 : d.getType(); }

    /** What the recorder is actually listening through, for logs and the take's metadata. */
    public static String routed(MediaRecorder r) {
        try { return name(r.getRoutedDevice()); } catch (RuntimeException e) { return "unknown"; }
    }

    public static String routed(AudioRecord r) {
        try { return name(r.getRoutedDevice()); } catch (RuntimeException e) { return "unknown"; }
    }

    static String name(AudioDeviceInfo d) {
        return d == null ? "unknown" : typeName(d.getType());
    }

    public static String typeName(int type) {
        switch (type) {
            case -1: return "unknown";
            case AudioDeviceInfo.TYPE_BUILTIN_MIC: return "builtin_mic";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return "bluetooth_sco";
            case AudioDeviceInfo.TYPE_BLE_HEADSET: return "bluetooth_le";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "wired_headset";
            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_USB_DEVICE: return "usb";
            case AudioDeviceInfo.TYPE_TELEPHONY: return "telephony";
            default: return "type_" + type;
        }
    }
}
