package ai.wizards.os.call;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Where a call's sound goes on the phone (wizard-messenger issue 445, Messenger switch `calls`): the earpiece, the
 * loudspeaker, wired headphones or a Bluetooth headset. Element Call picks one from the list this gives it (its
 * "controlled audio devices" mode, the way Element's own Android app hosts it: earpiece for a voice call, speaker for
 * video, a headset whenever one is connected) and names its pick back; Android then routes the call there.
 * Only {@link CallActivity} uses it, and only while a call window is open.
 */
public final class CallAudio {
    /** One place sound can go: Android's device id, its type and its product name. */
    public static final class Out {
        public final int id, type;
        public final String name;
        public Out(int id, int type, String name) { this.id = id; this.type = type; this.name = name == null ? "" : name; }
    }

    /** Preference order (most preferred first), as Element Call expects it: Android's own choice first (a headset when
     *  one is connected, else the speaker, as for a video call), the earpiece last; Element Call moves a voice call to
     *  the earpiece itself. -1 = not a place for call audio. */
    static int rank(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_HEARING_AID:
                return 0;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
                return 1;
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                return 2;
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
                return 3;
            default:
                return -1;
        }
    }

    static boolean headset(int type) { int r = rank(type); return r == 0 || r == 1; }

    /** The usable outputs, most preferred first, one per kind of earpiece and speaker (Android may list them twice). */
    public static List<Out> usable(List<Out> all) {
        List<Out> out = new ArrayList<>();
        for (int r = 0; r <= 3; r++) {
            for (Out o : all) {
                if (rank(o.type) != r) continue;
                boolean dup = false;
                for (Out k : out) if (k.id == o.id || ((r >= 2) && k.type == o.type)) dup = true;
                if (!dup) out.add(o);
            }
        }
        return out;
    }

    static String label(Out o) {
        switch (o.type) {
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "Phone";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "Speaker";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "Headphones";
            default: return o.name.trim().isEmpty() ? "Bluetooth" : o.name.trim();
        }
    }

    /** Element Call's OutputDevice list (controls.setAvailableAudioDevices) for these outputs. */
    public static String json(List<Out> outs) {
        JSONArray a = new JSONArray();
        try {
            for (Out o : outs) {
                a.put(new JSONObject().put("id", String.valueOf(o.id)).put("name", label(o))
                        .put("isEarpiece", o.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
                        .put("isSpeaker", o.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
                        .put("isExternalHeadset", headset(o.type)));
            }
        } catch (JSONException ignored) { }
        return a.toString();
    }

    private final AudioManager am;
    private final Runnable changed;
    private final Handler main = new Handler(Looper.getMainLooper());
    private int savedMode = AudioManager.MODE_NORMAL;
    private boolean started;
    private final AudioDeviceCallback callback = new AudioDeviceCallback() {
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { changed.run(); }
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { changed.run(); }
    };

    public CallAudio(Context c, Runnable changed) {
        this.am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        this.changed = changed;
    }

    /** The call starts: Android's call audio mode, and a fresh list whenever a headset comes or goes. */
    public void start() {
        if (am == null || started) return;
        started = true;
        savedMode = am.getMode();
        am.setMode(AudioManager.MODE_IN_COMMUNICATION);
        am.registerAudioDeviceCallback(callback, main);
    }

    /** What Android can route a call to right now (unsorted). */
    public List<Out> outputs() {
        List<Out> all = new ArrayList<>();
        if (am == null) return all;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) all.add(of(d));
        } else {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) all.add(of(d));
        }
        return all;
    }

    private static Out of(AudioDeviceInfo d) { return new Out(d.getId(), d.getType(), String.valueOf(d.getProductName())); }

    /** The id of the output the call uses now, or -1. */
    public int current() {
        if (am == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return -1;
        AudioDeviceInfo d = am.getCommunicationDevice();
        return d == null ? -1 : d.getId();
    }

    /** Element Call picked an output (its id from {@link #json}). True when Android took it. */
    @SuppressWarnings("deprecation")
    public boolean select(String id) {
        if (am == null || !started) return false;
        int want;
        try { want = Integer.parseInt(String.valueOf(id).trim()); } catch (NumberFormatException e) { return false; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) if (d.getId() == want) return am.setCommunicationDevice(d);
            return false;
        }
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
            if (d.getId() != want) continue;
            int r = rank(d.getType());
            if (r < 0) return false;
            boolean bt = d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO;
            if (bt) { am.setSpeakerphoneOn(false); am.startBluetoothSco(); am.setBluetoothScoOn(true); }
            else { am.setBluetoothScoOn(false); am.stopBluetoothSco(); am.setSpeakerphoneOn(d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER); }
            return true;
        }
        return false;
    }

    /** The call window closed: everything back as it was. */
    @SuppressWarnings("deprecation")
    public void stop() {
        if (am == null || !started) return;
        started = false;
        am.unregisterAudioDeviceCallback(callback);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice();
        else { am.setBluetoothScoOn(false); am.stopBluetoothSco(); am.setSpeakerphoneOn(false); }
        am.setMode(savedMode == AudioManager.MODE_IN_COMMUNICATION ? AudioManager.MODE_NORMAL : savedMode);
    }
}
