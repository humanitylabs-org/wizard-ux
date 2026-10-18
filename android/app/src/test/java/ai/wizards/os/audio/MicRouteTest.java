package ai.wizards.os.audio;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.media.AudioDeviceInfo;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

public class MicRouteTest {
    @Test
    public void picksTheBuiltInMicOverBluetooth() {
        int[] bluetoothFirst = {AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET,
                AudioDeviceInfo.TYPE_BUILTIN_MIC, AudioDeviceInfo.TYPE_TELEPHONY};
        assertEquals(2, MicRoute.pick(bluetoothFirst));
    }

    @Test
    public void noBuiltInMicLeavesTheSystemRoute() {
        assertEquals(-1, MicRoute.pick(new int[]{AudioDeviceInfo.TYPE_BLUETOOTH_SCO}));
        assertEquals(-1, MicRoute.pick(new int[0]));
        assertEquals(-1, MicRoute.pick(null));
    }

    @Test
    public void routeNamesAreReadable() {
        assertEquals("builtin_mic", MicRoute.typeName(AudioDeviceInfo.TYPE_BUILTIN_MIC));
        assertEquals("bluetooth_sco", MicRoute.typeName(AudioDeviceInfo.TYPE_BLUETOOTH_SCO));
    }

    @Test
    public void onlyAConfirmedOtherInputIsRefused() {
        assertEquals(MicRoute.BUILTIN, MicRoute.verdict(AudioDeviceInfo.TYPE_BUILTIN_MIC, true));
        assertEquals("Bluetooth call mic", MicRoute.EXTERNAL, MicRoute.verdict(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, true));
        assertEquals("Bluetooth LE mic", MicRoute.EXTERNAL, MicRoute.verdict(AudioDeviceInfo.TYPE_BLE_HEADSET, true));
        assertEquals("wired headset", MicRoute.EXTERNAL, MicRoute.verdict(AudioDeviceInfo.TYPE_WIRED_HEADSET, true));
        assertEquals("Android has not said yet", MicRoute.UNKNOWN, MicRoute.verdict(-1, true));
        assertEquals("phone reports no built-in mic", MicRoute.SYSTEM, MicRoute.verdict(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, false));
    }

    @Test
    public void retriesWithThePlainMicAndExplainsARefusal() {
        assertEquals(2, MicRoute.SOURCES.length);
        assertEquals(android.media.MediaRecorder.AudioSource.MIC, MicRoute.SOURCES[1]);
        assertEquals(MicRoute.EXTERNAL_MESSAGE, MicRoute.why(new java.io.IOException(MicRoute.EXTERNAL_MESSAGE), "busy"));
        assertEquals("busy", MicRoute.why(new java.io.IOException("other"), "busy"));
        assertTrue(MicRoute.EXTERNAL_MESSAGE.contains("phone's own mic"));
    }

    /**
     * 18 Oct 2026: the orb recorders opened the mic themselves and a Bluetooth speaker's mic took voice notes. Every
     * recorder now starts through MicRoute, which reads the route back and refuses anything but the phone's mic.
     */
    @Test
    public void everyRecorderStartsThroughMicRoute() throws Exception {
        File root = new File(System.getProperty("user.dir"), "src/main/java");
        assertTrue("source tree visible to the test", root.isDirectory());
        List<String> unenforced = new ArrayList<>();
        int recorders = 0;
        for (File f : files(root)) {
            if (f.getName().equals("MicRoute.java")) continue;
            String s = new String(Files.readAllBytes(f.toPath()), "UTF-8");
            boolean records = s.contains(".setAudioSource(") || s.contains("new AudioRecord(");
            if (!records) continue;
            recorders++;
            boolean viaRoute = s.contains("MicRoute.start(") || s.contains("MicRoute.startOnBuiltIn(");
            boolean selfStarts = s.contains("MediaRecorder.AudioSource.VOICE_RECOGNITION);") && s.contains(".setAudioSource(MediaRecorder");
            if (!viaRoute || selfStarts) unenforced.add(f.getName());
        }
        assertTrue("found the app's recorders", recorders >= 4);
        assertTrue("recorders that open the mic without MicRoute: " + unenforced, unenforced.isEmpty());
    }

    /** A take speech-to-text heard nothing in is kept (Settings → Cancelled recordings), never deleted. */
    @Test
    public void unheardTakesAreKept() throws Exception {
        File f = new File(System.getProperty("user.dir"), "src/main/java/ai/wizards/os/everywhere/EverywhereOutbox.java");
        String s = new String(Files.readAllBytes(f.toPath()), "UTF-8");
        assertTrue(s.contains("CancelledTakes.keepUnheard("));
        assertFalse("old path deleted the audio unconditionally",
                s.contains("items.remove(it.id); save(); }\n                meetingNote(it, \"event\", \"failed\", \"error\", \"No speech in that recording\");\n                //noinspection ResultOfMethodCallIgnored\n                audio.delete();"));
    }

    private static List<File> files(File dir) {
        List<File> out = new ArrayList<>();
        File[] kids = dir.listFiles();
        if (kids == null) return out;
        for (File k : kids) {
            if (k.isDirectory()) out.addAll(files(k));
            else if (k.getName().endsWith(".java")) out.add(k);
        }
        return out;
    }
}
