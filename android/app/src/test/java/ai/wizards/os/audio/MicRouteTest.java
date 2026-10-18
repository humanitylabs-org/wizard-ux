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

    /** 18 Oct 2026: the orb recorder lacked the pin and a Bluetooth speaker's mic took voice notes. Every recorder pins. */
    @Test
    public void everyRecorderPinsTheBuiltInMic() throws Exception {
        File root = new File(System.getProperty("user.dir"), "src/main/java");
        assertTrue("source tree visible to the test", root.isDirectory());
        List<String> unpinned = new ArrayList<>();
        int recorders = 0;
        for (File f : files(root)) {
            String s = new String(Files.readAllBytes(f.toPath()), "UTF-8");
            boolean records = s.contains(".setAudioSource(") || s.contains("new AudioRecord(");
            if (!records) continue;
            recorders++;
            if (!s.contains("MicRoute.pin(") && !s.contains("preferBuiltInMic(")) unpinned.add(f.getName());
        }
        assertTrue("found the app's recorders", recorders >= 4);
        assertTrue("recorders without the built-in mic pin: " + unpinned, unpinned.isEmpty());
        assertFalse(unpinned.contains("RecorderService.java"));
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
