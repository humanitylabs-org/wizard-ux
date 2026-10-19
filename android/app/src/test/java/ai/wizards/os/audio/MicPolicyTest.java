package ai.wizards.os.audio;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;

import org.json.JSONObject;
import org.junit.Test;

/** Settings → Microphone (18 Oct 2026): phone mic by default, a person's own choice when they make one. */
public class MicPolicyTest {
    private static final MicPolicy.Input PHONE = new MicPolicy.Input("builtin_mic", "Pixel", "bottom");
    private static final MicPolicy.Input SPEAKER = new MicPolicy.Input("bluetooth_sco", "JBL Flip 6", "AA:BB:CC:00:11:22");
    private static final MicPolicy.Input HEADSET = new MicPolicy.Input("bluetooth_sco", "Jabra Elite", "11:22:33:44:55:66");

    @Test
    public void defaultIsThePhoneMicAndBadInputNeverLosesIt() {
        for (String s : new String[]{null, "", "{", "[]", "{\"mode\":\"bogus\"}", "{\"mode\":\"prefer\",\"prefer\":[]}", "{\"mode\":\"prefer\",\"prefer\":[{\"type\":\"\"}]}"})
            assertEquals(String.valueOf(s), MicPolicy.PHONE, MicPolicy.parse(s).mode);
        List<MicPolicy.Input> ins = Arrays.asList(SPEAKER, PHONE);
        assertEquals("phone mode pins the phone mic over a connected speaker", 1, MicPolicy.DEFAULT.target(ins));
        assertEquals(MicRoute.EXTERNAL, MicPolicy.DEFAULT.verdict(SPEAKER, PHONE));
        assertEquals(MicRoute.BUILTIN, MicPolicy.DEFAULT.verdict(PHONE, PHONE));
        assertEquals(MicRoute.UNKNOWN, MicPolicy.DEFAULT.verdict(null, PHONE));
        assertEquals("no built-in mic reported: Android's route", MicRoute.SYSTEM, MicPolicy.DEFAULT.verdict(SPEAKER, null));
    }

    @Test
    public void anyLetsAndroidPickIncludingBluetooth() {
        MicPolicy any = MicPolicy.parse("{\"v\":1,\"mode\":\"any\"}");
        assertEquals(-1, any.target(Arrays.asList(SPEAKER, PHONE)));
        assertEquals("allowed", any.verdict(SPEAKER, null));
    }

    @Test
    public void preferUsesTheRememberedMicWhenConnectedElseThePhone() {
        MicPolicy p = MicPolicy.parse("{\"v\":1,\"mode\":\"prefer\",\"prefer\":[{\"type\":\"bluetooth_sco\",\"name\":\"Jabra Elite\",\"address\":\"11:22:33:44:55:66\"}]}");
        assertEquals(MicPolicy.PREFER, p.mode);
        assertEquals("headset connected: use it", 2, p.target(Arrays.asList(PHONE, SPEAKER, HEADSET)));
        assertEquals("chosen", p.verdict(HEADSET, HEADSET));
        assertEquals("headset gone: phone mic, never the speaker", 1, p.target(Arrays.asList(SPEAKER, PHONE)));
        assertEquals(MicRoute.EXTERNAL, p.verdict(SPEAKER, PHONE));
        assertEquals("a different speaker on the same profile is not the headset", MicRoute.EXTERNAL, p.verdict(SPEAKER, HEADSET));
    }

    @Test
    public void namesMatchWhenAndroidHidesTheAddress() {
        MicPolicy p = MicPolicy.parse("{\"mode\":\"prefer\",\"prefer\":[{\"type\":\"bluetooth_sco\",\"name\":\"jabra elite\"}]}");
        assertEquals(1, p.target(Arrays.asList(PHONE, new MicPolicy.Input("bluetooth_sco", "Jabra Elite", ""))));
    }

    @Test
    public void roundTripsThroughJson() throws Exception {
        MicPolicy p = MicPolicy.parse("{\"mode\":\"prefer\",\"prefer\":[{\"type\":\"usb\",\"name\":\"Rode\"},{\"type\":\"bluetooth_sco\",\"address\":\"AA\"}]}");
        JSONObject o = new JSONObject(p.json());
        assertEquals(1, o.getInt("v"));
        assertEquals("prefer", o.getString("mode"));
        assertEquals(2, o.getJSONArray("prefer").length());
        assertEquals(p.json(), MicPolicy.parse(p.json()).json());
        assertTrue(MicPolicy.DEFAULT.json().contains("\"mode\":\"phone\""));
    }
}
