package ai.wizards.os;

import android.content.Context;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * The shell's native bridges under the browser owner boundary (wizard-os#133, wizard-ux issue 1430).
 *
 * {@code addJavascriptInterface} puts an object into every frame of the WebView, sandboxed app windows included, and a
 * call carries no caller. With the boundary on, MainActivity therefore registers no {@code WizardOSNative} or
 * {@code WizardOSDevice} at all. It registers this gate instead, which answers only calls that carry a key, and gives
 * that key to the shell's own origin through a document-start script ({@link #shim}). An app frame is sandboxed under
 * the boundary (opaque origin), so the script never runs there: it sees no {@code WizardOSNative} or
 * {@code WizardOSDevice}, and its calls on the gate have no effect. The shell's own page gets both objects back,
 * rebuilt by the script with the same method names, the same arguments and the same (synchronous) answers.
 *
 * Off (the default; no box has the boundary on until the hostile-app test has run): MainActivity registers the two
 * bridges exactly as before and this class is not used.
 */
public final class NativeGate {
    public static final String NAME = "WizardOSGate";
    private static final String PREFS = "wizard_browser_boundary";
    private static final String REFUSED = "{\"e\":\"refused\"}";

    private final byte[] key;
    private final String keyText;
    private final Map<String, Object> bridges = new LinkedHashMap<>();
    private final Map<String, Map<String, List<Method>>> methods = new LinkedHashMap<>();

    public NativeGate(Map<String, Object> bridges) { this(bridges, newKey()); }

    NativeGate(Map<String, Object> named, String keyText) {
        this.keyText = keyText;
        this.key = keyText.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        for (Map.Entry<String, Object> e : named.entrySet()) {
            if (e.getValue() == null) continue;
            bridges.put(e.getKey(), e.getValue());
            Map<String, List<Method>> byName = new TreeMap<>();
            for (Method m : e.getValue().getClass().getMethods()) {
                if (!m.isAnnotationPresent(JavascriptInterface.class)) continue;
                m.setAccessible(true); // the shell's Bridge is a private inner class
                byName.computeIfAbsent(m.getName(), n -> new ArrayList<>()).add(m);
            }
            methods.put(e.getKey(), byName);
        }
    }

    private static String newKey() {
        byte[] b = new byte[32];
        new SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(Character.forDigit((x >> 4) & 0xf, 16)).append(Character.forDigit(x & 0xf, 16));
        return s.toString();
    }

    private boolean admitted(String k) {
        return k != null && MessageDigest.isEqual(key, k.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /** The bridge's method names, for the shell page's copy; null without the key or for an unknown bridge. */
    @JavascriptInterface public String methods(String k, String bridge) {
        if (!admitted(k)) return null;
        Map<String, List<Method>> m = methods.get(bridge);
        return m == null ? null : new JSONArray(new ArrayList<>(m.keySet())).toString();
    }

    /** One call on a bridge: {"v": answer} ({} for a void method), or {"e": why}. Without the key: refused, nothing runs. */
    @JavascriptInterface public String call(String k, String bridge, String method, String args) {
        if (!admitted(k)) return REFUSED;
        Object target = bridges.get(bridge);
        Map<String, List<Method>> byName = methods.get(bridge);
        List<Method> named = byName == null ? null : byName.get(method);
        if (target == null || named == null) return error("Method not found");
        JSONArray a;
        try { a = args == null ? new JSONArray() : new JSONArray(args); } catch (Exception e) { return error("invalid arguments"); }
        Method m = null;
        for (Method c : named) if (c.getParameterTypes().length == a.length()) { m = c; break; }
        if (m == null) return error("Method not found");
        Class<?>[] types = m.getParameterTypes();
        Object[] values = new Object[types.length];
        for (int i = 0; i < types.length; i++) values[i] = convert(types[i], a.opt(i));
        try {
            Object r = m.invoke(target, values);
            JSONObject out = new JSONObject();
            if (m.getReturnType() != void.class) {
                try { out.put("v", r == null ? JSONObject.NULL : r); } catch (Exception e) { out.put("v", JSONObject.NULL); }
            }
            return out.toString();
        } catch (InvocationTargetException e) {
            Throwable t = e.getCause() == null ? e : e.getCause();
            return error(t.getClass().getSimpleName());
        } catch (Exception e) {
            return error("call failed");
        }
    }

    private static String error(String why) {
        try { return new JSONObject().put("e", why).toString(); } catch (Exception e) { return "{\"e\":\"error\"}"; }
    }

    /** JSON argument -> the Java parameter, the way the WebView's own Java bridge converts a JS value. */
    static Object convert(Class<?> t, Object v) {
        boolean none = v == null || v == JSONObject.NULL;
        if (t == String.class) return none ? null : v instanceof String ? v : String.valueOf(v);
        if (t == boolean.class || t == Boolean.class) return v instanceof Boolean ? v : (t == boolean.class ? Boolean.FALSE : null);
        Number n = v instanceof Number ? (Number) v : null;
        if (t == int.class || t == Integer.class) return n == null ? (t == int.class ? (Object) 0 : null) : (Object) (int) n.doubleValue();
        if (t == long.class || t == Long.class) return n == null ? (t == long.class ? (Object) 0L : null) : (Object) (long) n.doubleValue();
        if (t == double.class || t == Double.class) return n == null ? (t == double.class ? (Object) 0d : null) : (Object) n.doubleValue();
        if (t == float.class || t == Float.class) return n == null ? (t == float.class ? (Object) 0f : null) : (Object) n.floatValue();
        if (t == short.class) return n == null ? (short) 0 : (short) n.doubleValue();
        if (t == byte.class) return n == null ? (byte) 0 : (byte) n.doubleValue();
        if (t == char.class) return (char) 0;
        return null;
    }

    /** The document-start script for the shell's own origin: rebuilds each bridge in that page from the gate. */
    public String shim() { return shim(keyText, new ArrayList<>(bridges.keySet())); }

    static String shim(String k, List<String> names) {
        return "(()=>{'use strict';const g=window." + NAME + ",k='" + k + "';if(!g)return;"
            + "try{delete window." + NAME + "}catch(_){}"
            + "for(const n of " + new JSONArray(names) + "){let l=null;try{l=JSON.parse(g.methods(k,n))}catch(_){}"
            + "if(!Array.isArray(l)||window[n])continue;const o={};"
            + "for(const m of l)o[m]=function(){const r=JSON.parse(g.call(k,n,m,JSON.stringify(Array.prototype.slice.call(arguments))));"
            + "if(r&&typeof r.e==='string')throw new Error(r.e);return r?r.v:undefined;};"
            + "Object.defineProperty(window,n,{value:Object.freeze(o),enumerable:false,configurable:false,writable:false});}})();";
    }

    /** Whether the shell last told this phone that the box at {@code origin} has the boundary on. Default off. */
    public static boolean on(Context c, String origin) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("on:" + origin, false);
    }

    /** Remembers the box's answer; true when it changed. */
    public static boolean remember(Context c, String origin, boolean on) {
        if (on(c, origin) == on) return false;
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("on:" + origin, on).apply();
        return true;
    }

    public static Map<String, Object> named(Object shell, Object device) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("WizardOSNative", shell);
        m.put("WizardOSDevice", device);
        return Collections.unmodifiableMap(m);
    }
}
