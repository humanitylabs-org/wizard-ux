package ai.wizards.os.call;

import android.media.AudioDeviceInfo;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.*;

/** wizard-messenger issue 445: the call window's output list for Element Call and which pages may open one. */
public class CallAudioTest {
    private static CallAudio.Out o(int id, int type, String name) { return new CallAudio.Out(id, type, name); }

    @Test public void headsetsComeFirstThenSpeakerThenEarpiece() {
        List<CallAudio.Out> all = Arrays.asList(
                o(2, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, "Pixel"),
                o(7, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, "Pixel"),
                o(9, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "Pixel Buds"),
                o(11, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, "USB-C"),
                o(13, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE, "Pixel"),
                o(14, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, "Pixel Buds"),
                o(15, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, "Pixel"));
        List<CallAudio.Out> u = CallAudio.usable(all);
        assertEquals(4, u.size());
        assertEquals(9, u.get(0).id);
        assertEquals(11, u.get(1).id);
        assertEquals(2, u.get(2).id); // a second speaker entry is dropped
        assertEquals(7, u.get(3).id);
    }

    @Test public void elementCallGetsItsOutputDeviceShape() throws Exception {
        JSONArray a = new JSONArray(CallAudio.json(CallAudio.usable(Arrays.asList(
                o(2, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, "Pixel"),
                o(7, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE, "Pixel"),
                o(9, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "Pixel Buds")))));
        assertEquals(3, a.length());
        JSONObject bt = a.getJSONObject(0), spk = a.getJSONObject(1), ear = a.getJSONObject(2);
        assertEquals("9", bt.getString("id"));
        assertEquals("Pixel Buds", bt.getString("name"));
        assertTrue(bt.getBoolean("isExternalHeadset"));
        assertFalse(bt.getBoolean("isEarpiece"));
        assertEquals("7", ear.getString("id"));
        assertTrue(ear.getBoolean("isEarpiece"));
        assertFalse(ear.getBoolean("isSpeaker"));
        assertEquals("Speaker", spk.getString("name"));
        assertTrue(spk.getBoolean("isSpeaker"));
        assertFalse(spk.getBoolean("isExternalHeadset"));
    }

    @Test public void anUnnamedBluetoothHeadsetIsCalledBluetooth() throws Exception {
        JSONArray a = new JSONArray(CallAudio.json(Arrays.asList(o(4, AudioDeviceInfo.TYPE_BLE_HEADSET, " "))));
        assertEquals("Bluetooth", a.getJSONObject(0).getString("name"));
    }

    @Test public void onlyThisWizardsOwnPagesOpenACallWindow() {
        String box = "https://box.tail1234.ts.net";
        assertTrue(CallActivity.allowed(box, box + "/messenger/call/k/abc/join/#/x?roomId=!r"));
        assertTrue(CallActivity.allowed(box, "https://BOX.tail1234.ts.net:443/messenger/call/"));
        assertFalse(CallActivity.allowed(box, "https://evil.example/messenger/call/"));
        assertFalse(CallActivity.allowed(box, "http://box.tail1234.ts.net/messenger/call/"));
        assertFalse(CallActivity.allowed(box, "https://box.tail1234.ts.net:8443/messenger/call/"));
        assertFalse(CallActivity.allowed(box, "javascript:alert(1)"));
        assertFalse(CallActivity.allowed(box, "https://user@box.tail1234.ts.net/messenger/call/"));
        assertFalse(CallActivity.allowed("", box + "/messenger/call/"));
        assertFalse(CallActivity.allowed(box, null));
    }
}
