package ai.wizards.os.shellport;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** window.wizardShellPort admission and command rules (wizard-os issue 387). */
public class ShellPortPolicyTest {
    private static final String OWNER = "https://wizard.example.ts.net:8444";

    @Test public void onlyTheMainFrameOnTheExactPersistedOriginWithTheShellOnTopIsAdmitted() {
        assertEquals(ShellPortPolicy.Refusal.NONE, ShellPortPolicy.admit(false, true, OWNER, OWNER, OWNER, true));
        // Child frames: same origin, srcdoc/about:blank (inherit the parent's origin), nested or redirected.
        assertEquals(ShellPortPolicy.Refusal.CHILD_FRAME, ShellPortPolicy.admit(false, false, OWNER, OWNER, OWNER, true));
        assertEquals(ShellPortPolicy.Refusal.DETACHED, ShellPortPolicy.admit(true, true, OWNER, OWNER, OWNER, true));
        assertEquals(ShellPortPolicy.Refusal.ORIGIN, ShellPortPolicy.admit(false, true, null, OWNER, OWNER, true));
        assertEquals(ShellPortPolicy.Refusal.ORIGIN, ShellPortPolicy.admit(false, true, "null", OWNER, OWNER, true));
        assertEquals(ShellPortPolicy.Refusal.ORIGIN, ShellPortPolicy.admit(false, true, "https://wizard.example.ts.net", OWNER, OWNER, true));
        assertEquals(ShellPortPolicy.Refusal.ORIGIN, ShellPortPolicy.admit(false, true, "http://wizard.example.ts.net:8444", OWNER, OWNER, true));
        assertEquals(ShellPortPolicy.Refusal.ORIGIN, ShellPortPolicy.admit(false, true, "https://evil.example:8444", OWNER, OWNER, true));
        // The Wizard was switched after this WebView's allowlist was built.
        assertEquals(ShellPortPolicy.Refusal.ORIGIN, ShellPortPolicy.admit(false, true, OWNER, OWNER, "https://other.example.ts.net", true));
        assertEquals(ShellPortPolicy.Refusal.ORIGIN, ShellPortPolicy.admit(false, true, OWNER, "", OWNER, true));
        // A same-origin page that is not the shell (an app path loaded top-level).
        assertEquals(ShellPortPolicy.Refusal.TOP_DOCUMENT, ShellPortPolicy.admit(false, true, OWNER, OWNER, OWNER, false));
    }

    @Test public void originsCompareExactly() {
        assertTrue(ShellPortPolicy.sameOrigin("https://A.example", "https://a.example:443"));
        assertTrue(ShellPortPolicy.sameOrigin("http://localhost:4100", "http://localhost:4100/"));
        assertFalse(ShellPortPolicy.sameOrigin("https://a.example", "https://a.example:8443"));
        assertFalse(ShellPortPolicy.sameOrigin("https://a.example", "https://a.example.evil"));
        assertFalse(ShellPortPolicy.sameOrigin("https://a.example", "https://user@a.example"));
        assertFalse(ShellPortPolicy.sameOrigin("https://a.example", "https://a.example/wizard-os-home/"));
        assertFalse(ShellPortPolicy.sameOrigin("https://a.example", null));
    }

    @Test public void shellPathIsTheOnlyTrustedTopDocument() {
        assertTrue(ShellPortPolicy.shellPath("/wizard-os-home/"));
        assertTrue(ShellPortPolicy.shellPath("/wizard-os-home"));
        assertFalse(ShellPortPolicy.shellPath("/wizard-os-homex/"));
        assertFalse(ShellPortPolicy.shellPath("/notes/"));
        assertFalse(ShellPortPolicy.shellPath(null));
    }

    @Test public void messagesAreTypeCheckedAgainstTheExactCommandTable() throws Exception {
        assertTrue(ShellPortPolicy.parse("{\"v\":1,\"id\":\"h\",\"method\":\"hello\"}").hello);
        ShellPortPolicy.Call c = ShellPortPolicy.parse("{\"v\":1,\"id\":\"a\",\"target\":\"native\",\"method\":\"haptic\",\"args\":[12]}");
        assertEquals("haptic", c.method);
        assertEquals(12, ShellPortPolicy.integer(c.args, 0));
        c = ShellPortPolicy.parse("{\"v\":1,\"id\":\"a\",\"target\":\"device\",\"method\":\"recRead\",\"args\":[\"take\",0]}");
        assertEquals("take", ShellPortPolicy.str(c.args, 0));
        c = ShellPortPolicy.parse("{\"v\":1,\"id\":\"a\",\"target\":\"native\",\"method\":\"usualsSave\",\"args\":[\"id\",null,null]}");
        assertNull(ShellPortPolicy.str(c.args, 1));
        c = ShellPortPolicy.parse("{\"v\":1,\"id\":\"a\",\"target\":\"native\",\"method\":\"appVoice\",\"args\":[\"listen\",12345678901]}");
        assertEquals(12345678901L, ShellPortPolicy.lng(c.args, 1));

        refused(ShellPortPolicy.Refusal.NOT_TEXT, null);
        refused(ShellPortPolicy.Refusal.SCHEMA, "not json");
        refused(ShellPortPolicy.Refusal.SCHEMA, "{\"v\":2,\"id\":\"a\",\"method\":\"hello\"}");
        refused(ShellPortPolicy.Refusal.SCHEMA, "{\"v\":1,\"id\":\"\",\"method\":\"hello\"}");
        refused(ShellPortPolicy.Refusal.SCHEMA, "{\"v\":1,\"id\":\"" + "x".repeat(65) + "\",\"method\":\"hello\"}");
        refused(ShellPortPolicy.Refusal.SCHEMA, "{\"v\":1,\"id\":7,\"method\":\"hello\"}");
        // Unknown names, wrong target, prototype/reflection-style names: no generic dispatcher.
        refused(ShellPortPolicy.Refusal.UNKNOWN_METHOD, call("native", "getClass", "[]"));
        refused(ShellPortPolicy.Refusal.UNKNOWN_METHOD, call("native", "recStart", "[\"auto\"]"));
        refused(ShellPortPolicy.Refusal.UNKNOWN_METHOD, call("device", "haptic", "[5]"));
        refused(ShellPortPolicy.Refusal.UNKNOWN_METHOD, call("apps", "haptic", "[5]"));
        refused(ShellPortPolicy.Refusal.UNKNOWN_METHOD, call("native", "call", "[]"));
        // Arity and types.
        refused(ShellPortPolicy.Refusal.ARGS, call("native", "haptic", "[]"));
        refused(ShellPortPolicy.Refusal.ARGS, call("native", "haptic", "[5,6]"));
        refused(ShellPortPolicy.Refusal.ARGS, call("native", "haptic", "[\"5\"]"));
        refused(ShellPortPolicy.Refusal.ARGS, call("native", "haptic", "[5.5]"));
        refused(ShellPortPolicy.Refusal.ARGS, call("native", "haptic", "[4294967296]"));
        refused(ShellPortPolicy.Refusal.ARGS, call("native", "keepAwake", "[1]"));
        refused(ShellPortPolicy.Refusal.ARGS, call("native", "openInBrowser", "[{\"url\":\"https://a\"}]"));
        refused(ShellPortPolicy.Refusal.ARGS, call("device", "recRead", "[\"id\",-0.5]"));
        refused(ShellPortPolicy.Refusal.ARGS, "{\"v\":1,\"id\":\"a\",\"target\":\"native\",\"method\":\"haptic\",\"args\":{\"0\":5}}");
        refused(ShellPortPolicy.Refusal.TOO_LARGE, "x".repeat(ShellPortPolicy.MAX_MESSAGE + 1));
    }

    @Test public void logNamesNeverCarryPageInput() {
        assertEquals("haptic", ShellPortPolicy.logName("haptic"));
        assertEquals("?", ShellPortPolicy.logName("a\nb"));
        assertEquals("?", ShellPortPolicy.logName("<script>"));
        assertEquals(40, ShellPortPolicy.logName("a".repeat(500)).length());
    }

    @Test public void hooksAreAnExactList() {
        assertTrue(ShellPortPolicy.HOOKS.contains("__wosUnsent"));
        assertFalse(ShellPortPolicy.HOOKS.contains("__wosNativeBack"));
        assertFalse(ShellPortPolicy.HOOKS.contains("eval"));
    }

    @Test public void capabilitiesDescribeTheTable() throws Exception {
        JSONObject caps = ShellPortPolicy.capabilities();
        assertEquals(1, caps.getInt("v"));
        assertEquals("i", caps.getJSONObject("native").getString("haptic"));
        assertEquals("si", caps.getJSONObject("device").getString("recRead"));
        JSONArray fresh = caps.getJSONArray("fresh");
        Set<String> f = new HashSet<>(); for (int i = 0; i < fresh.length(); i++) f.add(fresh.getString(i));
        assertTrue(f.contains("recStart") && f.contains("recRead") && !f.contains("haptic"));
    }

    /* ---------------- source contracts: the table is the dispatch, and nothing re-opens an all-frame object */

    private static final Path MAIN = Paths.get("src/main/java/ai/wizards/os");

    @Test public void dispatchSwitchesMatchTheCommandTableExactly() throws IOException {
        assertEquals(ShellPortPolicy.nativeMethods().keySet(), cases(read(MAIN.resolve("MainActivity.java")), "Object call(String method"));
        assertEquals(ShellPortPolicy.deviceMethods().keySet(), cases(read(MAIN.resolve("device/DeviceBridge.java")), "public Object call(String method"));
    }

    @Test public void theRemoteShellWebViewHasNoJavascriptInterface() throws IOException {
        for (String f : new String[]{"MainActivity.java", "AppSessionActivity.java", "device/DeviceBridge.java", "SelectionWebView.java"}) {
            String src = read(MAIN.resolve(f));
            assertFalse(f + " registers an all-frame Java object", src.contains("addJavascriptInterface("));
            assertFalse(f + " keeps a @JavascriptInterface entry point", src.contains("@JavascriptInterface"));
        }
    }

    /**
     * The only remaining addJavascriptInterface objects live in separate, local-only WebViews (bundled
     * file:///android_asset/assist/ pages, network loads blocked, navigation refused). Any new registration fails here
     * and needs the same review.
     */
    @Test public void allFrameJavaObjectsExistOnlyInReviewedLocalOnlyWebViews() throws IOException {
        Set<String> found = new HashSet<>();
        try (Stream<Path> files = Files.walk(MAIN)) {
            for (Path p : (Iterable<Path>) files.filter(x -> x.toString().endsWith(".java"))::iterator) {
                String src = read(p);
                if (!src.contains("addJavascriptInterface(")) continue;
                String rel = MAIN.relativize(p).toString().replace('\\', '/');
                found.add(rel);
                assertTrue(rel + " must block network loads", src.contains("setBlockNetworkLoads(true)"));
                assertTrue(rel + " must load only bundled assets", src.contains("file:///android_asset/assist/"));
            }
        }
        Set<String> reviewed = new HashSet<>(java.util.Arrays.asList("assist/AssistLockActivity.java", "assist/WizardSession.java",
                "everywhere/ScreenMode.java", "everywhere/EverywhereService.java"));
        assertEquals(reviewed, found);
    }

    @Test public void mizelPortRefusesChildFrames() throws IOException {
        String src = read(MAIN.resolve("mizel/MizelBridge.java"));
        assertTrue(src.contains("if (!isMainFrame) {"));
    }

    private static Set<String> cases(String src, String marker) {
        int at = src.indexOf(marker);
        assertTrue("dispatch method not found: " + marker, at >= 0);
        int end = src.indexOf("default:", at);
        Set<String> out = new HashSet<>();
        Matcher m = Pattern.compile("case \"([A-Za-z]+)\":").matcher(src.substring(at, end));
        while (m.find()) out.add(m.group(1));
        return out;
    }

    private static String read(Path p) throws IOException { return new String(Files.readAllBytes(p), StandardCharsets.UTF_8); }

    private static String call(String target, String method, String args) {
        return "{\"v\":1,\"id\":\"a\",\"target\":\"" + target + "\",\"method\":\"" + method + "\",\"args\":" + args + "}";
    }

    private static void refused(ShellPortPolicy.Refusal want, String data) {
        try { ShellPortPolicy.parse(data); fail("accepted: " + data); }
        catch (ShellPortPolicy.Rejected r) { assertEquals(want, r.refusal); }
    }
}
