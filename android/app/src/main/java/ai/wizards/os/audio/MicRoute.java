package ai.wizards.os.audio;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

/**
 * Every Wizard OS recording listens through the phone's own microphone.
 *
 * Android otherwise follows the system input route: with a Bluetooth speaker or headset connected it can hand a
 * {@code VOICE_RECOGNITION} recording to that device's mic over SCO. The take then arrives near-silent and
 * band-limited (nothing above ~8 kHz) and speech-to-text invents words (18 Oct 2026). Pinning the built-in mic
 * changes only the input; Bluetooth playback keeps its route. Pure selection lives in {@link #pick} for unit tests.
 */
public final class MicRoute {
    private static final String TAG = "WizardOSMic";

    private MicRoute() {}

    /** Index of the built-in microphone among the given input device types, or -1 when the phone reports none. */
    public static int pick(int[] types) {
        if (types == null) return -1;
        for (int i = 0; i < types.length; i++) if (types[i] == AudioDeviceInfo.TYPE_BUILTIN_MIC) return i;
        return -1;
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

    /** Pins {@code r} to the built-in mic. Call before {@code prepare()}. */
    public static boolean pin(Context c, MediaRecorder r) {
        AudioDeviceInfo d = builtIn(c);
        boolean ok = d != null && r.setPreferredDevice(d);
        Log.i(TAG, "recorder pinned to built-in mic: " + ok);
        return ok;
    }

    /** Pins {@code r} to the built-in mic. Call before {@code startRecording()}. */
    public static boolean pin(Context c, AudioRecord r) {
        AudioDeviceInfo d = builtIn(c);
        boolean ok = d != null && r.setPreferredDevice(d);
        Log.i(TAG, "audio record pinned to built-in mic: " + ok);
        return ok;
    }

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
