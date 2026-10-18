package ai.wizards.os.audio;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * Every Wizard OS recording listens through the phone's own microphone (James's standing contract).
 *
 * Android otherwise follows the system input route: with a Bluetooth speaker or headset connected it can hand a
 * {@code VOICE_RECOGNITION} recording to that device's mic over SCO. The take then arrives near-silent and
 * band-limited (nothing above ~8 kHz) and speech-to-text invents words (18 Oct 2026).
 *
 * 0.9.27 asked for the built-in mic. 0.9.30 enforces it: after starting, the recorder's actual route is read back;
 * a take Android confirms on another input is stopped, retried once with the plain {@code MIC} source, and refused
 * if it still is not an allowed mic. Only the input is touched; Bluetooth playback keeps its route.
 * Which mic is allowed is the per-phone {@link MicPolicy} (default: the phone's own), set from Settings → Microphone.
 * Pure decisions live in {@link #pick} and {@link #verdict} for unit tests.
 */
public final class MicRoute {
    private static final String TAG = "WizardOSMic";

    public static final String BUILTIN = "builtin", EXTERNAL = "external", UNKNOWN = "unknown", SYSTEM = "system";
    /** What the person is told when Android keeps the mic on another device. */
    public static final String EXTERNAL_MESSAGE =
            "Android moved the microphone to a Bluetooth or external device. Wizard records only from the phone's own mic. Try again, or choose another mic in Settings → Microphone.";
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

    /** The mic a recording should hold to under the saved {@link MicPolicy}: the device to pin, or none. */
    static final class Choice {
        final MicPolicy policy; final AudioDeviceInfo device; final MicPolicy.Input input;
        Choice(MicPolicy policy, AudioDeviceInfo device, MicPolicy.Input input) { this.policy = policy; this.device = device; this.input = input; }
        String verdict(AudioDeviceInfo routed) { return policy.verdict(routed == null ? null : input(routed), input); }
    }

    static Choice choose(Context c) {
        MicPolicy p = MicPolicy.load(c);
        AudioDeviceInfo[] ins = inputs(c);
        List<MicPolicy.Input> list = new ArrayList<>();
        for (AudioDeviceInfo d : ins) list.add(input(d));
        int at = p.target(list);
        return at < 0 ? new Choice(p, null, null) : new Choice(p, ins[at], list.get(at));
    }

    private static AudioDeviceInfo[] inputs(Context c) {
        try {
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            return am == null ? new AudioDeviceInfo[0] : am.getDevices(AudioManager.GET_DEVICES_INPUTS);
        } catch (RuntimeException e) {
            Log.w(TAG, "input list failed", e);
            return new AudioDeviceInfo[0];
        }
    }

    static MicPolicy.Input input(AudioDeviceInfo d) {
        String addr = "";
        try { addr = d.getAddress(); } catch (RuntimeException ignored) { }
        CharSequence n = d.getProductName();
        return new MicPolicy.Input(typeName(d.getType()), n == null ? "" : n.toString(), addr);
    }

    /** The connected microphones and the saved policy, for Settings → Microphone. */
    public static String settingsJson(Context c) {
        try {
            JSONObject o = new JSONObject();
            o.put("v", MicPolicy.VERSION).put("policy", new JSONObject(MicPolicy.load(c).json()));
            JSONArray a = new JSONArray();
            for (AudioDeviceInfo d : inputs(c)) {
                MicPolicy.Input in = input(d);
                if (d.getType() == AudioDeviceInfo.TYPE_TELEPHONY || d.getType() == AudioDeviceInfo.TYPE_REMOTE_SUBMIX) continue;
                a.put(new JSONObject().put("type", in.type).put("name", in.name).put("address", in.address));
            }
            return o.put("inputs", a).toString();
        } catch (Exception e) {
            return "{\"v\":1,\"policy\":{\"v\":1,\"mode\":\"phone\"},\"inputs\":[]}";
        }
    }

    /**
     * Opens and starts a MediaRecorder on the mic the saved {@link MicPolicy} allows (by default the phone's own), or
     * throws. Tries each of {@link #SOURCES}; a take Android confirms on a disallowed input is stopped and released.
     */
    public static MediaRecorder start(Context c, Maker maker, Setup setup) throws IOException {
        Choice ch = choose(c);
        IOException last = new IOException("The microphone did not start");
        for (int src : SOURCES) {
            MediaRecorder r = maker.make();
            boolean started = false;
            try {
                setup.apply(r, src);
                if (ch.device != null && !r.setPreferredDevice(ch.device)) throw new IOException("Android refused the chosen microphone");
                r.prepare();
                r.start();
                started = true;
                AudioDeviceInfo routed = awaitRouted(r);
                String v = ch.verdict(routed);
                Log.i(TAG, "recorder policy=" + ch.policy.mode + " source=" + src + " routed=" + name(routed) + " -> " + v);
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
     * Pins a constructed AudioRecord to the mic the policy allows, starts it and reads back its route. False (already
     * stopped and released) when it could not start or Android confirmed a disallowed input; the caller tries its next source.
     */
    public static boolean startOnBuiltIn(Context c, AudioRecord r) {
        Choice ch = choose(c);
        if (ch.device != null && !r.setPreferredDevice(ch.device)) { Log.w(TAG, "audio record refused the chosen mic"); r.release(); return false; }
        try {
            r.startRecording();
        } catch (IllegalStateException e) {
            r.release();
            return false;
        }
        if (r.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) { r.release(); return false; }
        AudioDeviceInfo routed = awaitRouted(r);
        String v = ch.verdict(routed);
        Log.i(TAG, "audio record policy=" + ch.policy.mode + " routed=" + name(routed) + " -> " + v);
        if (!EXTERNAL.equals(v)) return true;
        try { r.stop(); } catch (IllegalStateException ignored) { }
        r.release();
        return false;
    }

    /**
     * What this app is recording through right now, as the page's browser recorder sees it (18 Oct 2026): the
     * WebView's getUserMedia never passes through {@link #start}, so after the page opens the mic it asks here.
     * "external" if any of this app's active recordings is on an input the saved policy does not allow.
     */
    public static String browserVerdict(Context c) {
        try {
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return UNKNOWN;
            Choice ch = choose(c);
            String out = UNKNOWN;
            for (android.media.AudioRecordingConfiguration cfg : am.getActiveRecordingConfigurations()) {
                AudioDeviceInfo d = cfg.getAudioDevice();
                String v = ch.verdict(d);
                Log.i(TAG, "browser recording policy=" + ch.policy.mode + " routed=" + name(d) + " -> " + v);
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
