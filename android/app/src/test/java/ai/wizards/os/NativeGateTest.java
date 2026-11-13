package ai.wizards.os;

import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.util.LinkedHashMap;
import java.util.Map;
import static org.junit.Assert.*;

/** Browser owner boundary (issue 1430): the gate answers only the key holder and keeps each bridge's own answers. */
public class NativeGateTest {
    static final String KEY = "ab12".repeat(16);

    /** Stands in for WizardOSDevice: private like the shell's Bridge, with one method that is not exposed. */
    private static final class Device {
        int started;
        @JavascriptInterface public String recStart(String kind) { started++; return "{\"id\":\"" + kind + "\"}"; }
        @JavascriptInterface public int version() { return 3; }
        @JavascriptInterface public boolean recAudioGone(String id) { return "gone".equals(id); }
        @JavascriptInterface public void recPause(boolean on) { started += on ? 10 : 100; }
        @JavascriptInterface public String recRead(String id, int offset) { return id + "@" + offset; }
        @JavascriptInterface public long elapsed(long ms) { return ms * 2; }
        @JavascriptInterface public String nothing() { return null; }
        @JavascriptInterface public String broken() { throw new IllegalStateException("x"); }
        public String hidden() { started = -1; return "hidden"; }
    }

    private static NativeGate gate(Device d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("WizardOSDevice", d);
        m.put("WizardOSNative", null); // a bridge that isn't there is simply left out
        return new NativeGate(m, KEY);
    }

    @Test public void withoutTheKeyNothingRunsAndNothingIsListed() throws Exception {
        Device d = new Device();
        NativeGate g = gate(d);
        for (String k : new String[]{null, "", "ab12", KEY.toUpperCase(), KEY + "0"}) {
            assertNull(g.methods(k, "WizardOSDevice"));
            assertEquals("refused", new JSONObject(g.call(k, "WizardOSDevice", "recStart", "[\"mic\"]")).getString("e"));
        }
        assertEquals(0, d.started);
    }

    @Test public void theKeyHolderGetsTheSameAnswersAsTheBridge() throws Exception {
        Device d = new Device();
        NativeGate g = gate(d);
        JSONArray names = new JSONArray(g.methods(KEY, "WizardOSDevice"));
        assertTrue(names.toString().contains("\"recStart\""));
        assertFalse("not a bridge method", names.toString().contains("hidden"));
        assertFalse("Object's methods are not bridge methods", names.toString().contains("toString"));
        assertNull(g.methods(KEY, "WizardOSNative"));
        assertEquals("{\"id\":\"mic\"}", new JSONObject(g.call(KEY, "WizardOSDevice", "recStart", "[\"mic\"]")).getString("v"));
        assertEquals(1, d.started);
        assertEquals(3, new JSONObject(g.call(KEY, "WizardOSDevice", "version", "[]")).getInt("v"));
        assertTrue(new JSONObject(g.call(KEY, "WizardOSDevice", "recAudioGone", "[\"gone\"]")).getBoolean("v"));
        assertEquals("a@7", new JSONObject(g.call(KEY, "WizardOSDevice", "recRead", "[\"a\",7.9]")).getString("v"));
        assertEquals(1789000000000L * 2, new JSONObject(g.call(KEY, "WizardOSDevice", "elapsed", "[1789000000000]")).getLong("v"));
        JSONObject none = new JSONObject(g.call(KEY, "WizardOSDevice", "nothing", "[]"));
        assertTrue(none.has("v") && none.isNull("v"));
        assertEquals("a void method answers {} (undefined in the page)", "{}", g.call(KEY, "WizardOSDevice", "recPause", "[true]"));
        assertEquals(11, d.started);
    }

    @Test public void wrongCallsFailLikeTheBridgeAndNeverReachHiddenMethods() throws Exception {
        Device d = new Device();
        NativeGate g = gate(d);
        assertEquals("Method not found", new JSONObject(g.call(KEY, "WizardOSDevice", "hidden", "[]")).getString("e"));
        assertEquals("Method not found", new JSONObject(g.call(KEY, "WizardOSDevice", "recStart", "[]")).getString("e"));
        assertEquals("Method not found", new JSONObject(g.call(KEY, "WizardOSNative", "platform", "[]")).getString("e"));
        assertEquals("Method not found", new JSONObject(g.call(KEY, "Nope", "recStart", "[\"mic\"]")).getString("e"));
        assertEquals("invalid arguments", new JSONObject(g.call(KEY, "WizardOSDevice", "recStart", "{")).getString("e"));
        assertEquals("IllegalStateException", new JSONObject(g.call(KEY, "WizardOSDevice", "broken", "[]")).getString("e"));
        assertEquals("no hidden or failed call counted", 0, d.started);
    }

    @Test public void argumentsConvertTheWayTheJavaBridgeDoes() {
        assertNull(NativeGate.convert(String.class, JSONObject.NULL));
        assertEquals("1", NativeGate.convert(String.class, 1));
        assertEquals(Boolean.FALSE, NativeGate.convert(boolean.class, "yes"));
        assertEquals(0, NativeGate.convert(int.class, JSONObject.NULL));
        assertEquals(-2, NativeGate.convert(int.class, -2.7));
        assertEquals(0L, NativeGate.convert(long.class, "9"));
        assertEquals(1.5d, NativeGate.convert(double.class, 1.5));
    }

    @Test public void theShellScriptHoldsTheKeyAndRebuildsEachBridge() {
        String s = gate(new Device()).shim();
        assertTrue(s.contains("k='" + KEY + "'"));
        assertTrue(s.contains("[\"WizardOSDevice\"]"));
        assertTrue("the gate leaves the shell page's window", s.contains("delete window.WizardOSGate"));
        assertTrue("a bridge already there is never replaced", s.contains("window[n])continue"));
        assertTrue(s.contains("Object.freeze(o)"));
    }
}
