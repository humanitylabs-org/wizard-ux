package ai.wizards.os.downloads;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import static ai.wizards.os.downloads.DownloadsCallerPolicy.Verdict.ALLOW;
import static ai.wizards.os.downloads.DownloadsCallerPolicy.Verdict.DENY_NOT_MAIN_FRAME;
import static ai.wizards.os.downloads.DownloadsCallerPolicy.Verdict.DENY_NOT_SHELL;
import static ai.wizards.os.downloads.DownloadsCallerPolicy.Verdict.DENY_ORIGIN;
import static ai.wizards.os.downloads.DownloadsCallerPolicy.Verdict.DENY_UNSUPPORTED;
import static ai.wizards.os.downloads.DownloadsCallerPolicy.Verdict.DENY_WEBVIEW;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Who may use the in-app Downloads port (window.wizardDownloadsPort). The P1 on PR #1140: the old
 * addJavascriptInterface Bridge reached EVERY frame and only looked at the top-level URL, so a hosted app iframe in
 * the normal shell could list, cancel, open and clear downloads. These are pure-Java rules; the Android wiring is
 * asserted by the source tests at the bottom and by a device check, not by any web fake.
 */
public class DownloadsCallerPolicyTest {
    private static final String PRIMARY = "https://wizard.example.ts.net";
    private static final String SHELL = PRIMARY + "/wizard-os-home/";

    private static DownloadsCallerPolicy.Verdict admit(boolean supported, boolean webview, boolean main, String source, String top) {
        return DownloadsCallerPolicy.admit(supported, webview, main, PRIMARY, source, top);
    }

    // ---- the caller ---------------------------------------------------------------------------------------------

    @Test public void theTrustedShellMainFrameIsAllowed() {
        assertEquals(ALLOW, admit(true, true, true, PRIMARY, SHELL));
        assertEquals(ALLOW, admit(true, true, true, PRIMARY, PRIMARY + "/wizard-os-home"));
        assertEquals(ALLOW, admit(true, true, true, PRIMARY, SHELL + "index.html?tab=chats#x"));
    }

    @Test public void aCrossOriginIframeInTheShellIsDenied() {
        // top-level URL is the shell (what the old guard looked at), but the caller is a frame on another origin
        assertEquals(DENY_NOT_MAIN_FRAME, admit(true, true, false, "https://evil.example", SHELL));
        assertEquals(DENY_ORIGIN, admit(true, true, true, "https://evil.example", SHELL));
        assertEquals(DENY_ORIGIN, admit(true, true, true, "http://wizard.example.ts.net", SHELL));
        assertEquals(DENY_ORIGIN, admit(true, true, true, "https://wizard.example.ts.net:8443", SHELL));
        assertEquals(DENY_ORIGIN, admit(true, true, true, "https://wizard.example.ts.net.evil.example", SHELL));
        assertEquals(DENY_ORIGIN, admit(true, true, true, null, SHELL));
    }

    @Test public void aSameOriginNonShellIframeInTheShellIsDenied() {
        // a hosted app (/files/, /android-apps/ …) framed by the shell: same origin, not the main frame
        assertEquals(DENY_NOT_MAIN_FRAME, admit(true, true, false, PRIMARY, SHELL));
        assertEquals(DENY_NOT_MAIN_FRAME, admit(true, true, false, PRIMARY, PRIMARY + "/wizard-os-home"));
    }

    @Test public void aTopLevelNonShellPageIsDenied() {
        for (String top : new String[]{PRIMARY + "/files/", PRIMARY + "/android-apps/", PRIMARY + "/", PRIMARY,
                PRIMARY + "/wizard-os-homeevil", PRIMARY + "/x/wizard-os-home/", PRIMARY + "/mizel-live/",
                "https://evil.example/wizard-os-home/", "http://wizard.example.ts.net/wizard-os-home/",
                "https://wizard.example.ts.net.evil.example/wizard-os-home/", "https://user@wizard.example.ts.net/wizard-os-home/",
                "about:blank", "", "not a url", null})
            assertEquals(String.valueOf(top), DENY_NOT_SHELL, admit(true, true, true, PRIMARY, top));
    }

    @Test public void aWrongOrReplacedWebViewIsDenied() {
        assertEquals(DENY_WEBVIEW, admit(true, false, true, PRIMARY, SHELL));
    }

    @Test public void anUnsupportedListenerFailsClosed() {
        assertFalse(DownloadsCallerPolicy.supported(false));
        assertTrue(DownloadsCallerPolicy.supported(true));
        // even a perfect caller is refused when WEB_MESSAGE_LISTENER is not available
        assertEquals(DENY_UNSUPPORTED, admit(false, true, true, PRIMARY, SHELL));
        assertNull(DownloadsCallerPolicy.handle(DENY_UNSUPPORTED, request("list", null), new FakeActions()));
    }

    @Test public void noPrimaryOriginMeansNoOne() {
        assertEquals(DENY_ORIGIN, DownloadsCallerPolicy.admit(true, true, true, null, PRIMARY, SHELL));
        assertEquals(DENY_ORIGIN, DownloadsCallerPolicy.admit(true, true, true, "", "", SHELL));
    }

    @Test public void originIsSchemeHostAndNonDefaultPort() {
        assertEquals("https://wizard.example.ts.net", DownloadsCallerPolicy.originOf("https", "wizard.example.ts.net", -1));
        assertEquals("https://wizard.example.ts.net", DownloadsCallerPolicy.originOf("https", "Wizard.Example.ts.net", 443));
        assertEquals("https://h:8443", DownloadsCallerPolicy.originOf("https", "h", 8443));
        assertNull(DownloadsCallerPolicy.originOf(null, "h", -1));
        assertNull(DownloadsCallerPolicy.originOf("https", null, -1));
    }

    @Test public void theConfiguredAddressIsSpelledLikeTheSenderOrigin() {
        assertEquals(PRIMARY, DownloadsCallerPolicy.normalizeOrigin("https://Wizard.Example.ts.net"));
        assertEquals(PRIMARY, DownloadsCallerPolicy.normalizeOrigin("https://wizard.example.ts.net:443"));
        assertEquals("http://10.0.2.2:8080", DownloadsCallerPolicy.normalizeOrigin("http://10.0.2.2:8080"));
        assertNull(DownloadsCallerPolicy.normalizeOrigin(null));
        assertNull(DownloadsCallerPolicy.normalizeOrigin("not a url"));
    }

    // ---- stale navigation / lifecycle, checked again before the answer or the side effect -----------------------

    @Test public void staleNavigationIsDenied() {
        assertTrue(DownloadsCallerPolicy.stillCurrent(5, 5, true, PRIMARY, SHELL));
        assertFalse("a page load began since admission", DownloadsCallerPolicy.stillCurrent(5, 6, true, PRIMARY, SHELL));
        assertFalse("the WebView was rebuilt", DownloadsCallerPolicy.stillCurrent(5, 5, false, PRIMARY, SHELL));
        assertFalse("top page left the shell", DownloadsCallerPolicy.stillCurrent(5, 5, true, PRIMARY, PRIMARY + "/files/"));
        assertFalse("top page is another site", DownloadsCallerPolicy.stillCurrent(5, 5, true, PRIMARY, "https://evil.example/wizard-os-home/"));
        assertFalse("no page", DownloadsCallerPolicy.stillCurrent(5, 5, true, PRIMARY, null));
        assertFalse("different Wizard selected", DownloadsCallerPolicy.stillCurrent(5, 5, true, "https://other.example", SHELL));
    }

    // ---- requests and replies -----------------------------------------------------------------------------------

    private static String request(String method, String id) {
        try {
            JSONObject o = new JSONObject().put("v", 1).put("id", "r1").put("method", method);
            if (id != null) o.put("params", new JSONObject().put("id", id));
            return o.toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** A DownloadManager stand-in: one tracked transfer still running and one finished file. */
    private static final class FakeActions implements DownloadsCallerPolicy.Actions {
        final List<String> tracked = new ArrayList<>(List.of("41", "42"));
        final List<String> calls = new ArrayList<>();
        @Override public String list() { calls.add("list"); return "{\"v\":1,\"items\":[{\"id\":\"41\"},{\"id\":\"42\"}]}"; }
        @Override public String open(String id) { calls.add("open:" + id); return tracked.contains(id) ? "ok" : "missing"; }
        @Override public String cancel(String id) { calls.add("cancel:" + id); return tracked.remove(id) ? "ok" : "missing"; }
        @Override public String remove(String id) { calls.add("remove:" + id); return tracked.remove(id) ? "ok" : "missing"; }
    }

    @Test public void anIframeCancelIsDeniedAndTheRealTransferIsKept() {
        for (DownloadsCallerPolicy.Verdict denied : new DownloadsCallerPolicy.Verdict[]{DENY_NOT_MAIN_FRAME, DENY_ORIGIN, DENY_NOT_SHELL, DENY_WEBVIEW, DENY_UNSUPPORTED}) {
            FakeActions a = new FakeActions();
            for (String m : new String[]{"cancel", "remove", "open", "list"})
                assertNull(denied + " " + m, DownloadsCallerPolicy.handle(denied, request(m, "41"), a));
            assertTrue("no native action ran for " + denied + ": " + a.calls, a.calls.isEmpty());
            assertEquals("the tracked transfer is still there", List.of("41", "42"), a.tracked);
        }
        // control: the same request from the trusted shell does cancel it
        FakeActions a = new FakeActions();
        String reply = DownloadsCallerPolicy.handle(ALLOW, request("cancel", "41"), a);
        assertNotNull(reply);
        assertEquals(List.of("42"), a.tracked);
    }

    @Test public void anIframeCannotListTheTrackedDownloads() {
        FakeActions a = new FakeActions();
        assertNull(DownloadsCallerPolicy.handle(DENY_NOT_MAIN_FRAME, request("list", null), a));
        assertTrue(a.calls.isEmpty());
        String ok = DownloadsCallerPolicy.handle(ALLOW, request("list", null), a);
        JSONObject j = json(ok);
        assertTrue(j.optBoolean("ok"));
        assertEquals(1, j.optInt("v"));
        assertEquals("r1", j.optString("id"));
        assertEquals(2, j.optJSONObject("result").optJSONArray("items").length());
    }

    @Test public void repliesCarryTheRequestIdAndTheNativeAnswer() {
        FakeActions a = new FakeActions();
        JSONObject j = json(DownloadsCallerPolicy.handle(ALLOW, request("open", "42"), a));
        assertTrue(j.optBoolean("ok")); assertEquals("ok", j.optString("result")); assertEquals("r1", j.optString("id"));
        j = json(DownloadsCallerPolicy.handle(ALLOW, request("open", "99"), a));
        assertEquals("missing", j.optString("result"));
        j = json(DownloadsCallerPolicy.handle(ALLOW, request("remove", "42"), a));
        assertEquals("ok", j.optString("result"));
    }

    @Test public void onlyFourMethodsAndDigitIdsReachNative() {
        FakeActions a = new FakeActions();
        for (String m : new String[]{"", "delete", "LIST", "downloadsList", "eval", "openUrl", "clear", "download"}) {
            JSONObject j = json(DownloadsCallerPolicy.handle(ALLOW, request(m, "41"), a));
            if (j != null) assertFalse(m, j.optBoolean("ok"));
        }
        for (String bad : new String[]{"", "../1", "4;2", "4 2", "-1", "x", "1234567890123456789", "0x10"}) {
            JSONObject j = json(DownloadsCallerPolicy.handle(ALLOW, request("cancel", bad), a));
            assertEquals(bad, "missing", j.optString("result"));
        }
        assertTrue("nothing ran for bad methods or bad ids: " + a.calls, a.calls.isEmpty());
        assertEquals(List.of("41", "42"), a.tracked);
    }

    @Test public void malformedRequestsGetNoAnswerAtAll() {
        FakeActions a = new FakeActions();
        for (String bad : new String[]{null, "", "list", "[]", "{", "{\"v\":2,\"id\":\"r\",\"method\":\"list\"}",
                "{\"id\":\"r\",\"method\":\"list\"}", "{\"v\":1,\"method\":\"list\"}", "{\"v\":1,\"id\":\"\",\"method\":\"list\"}",
                "{\"v\":1,\"id\":\"" + "x".repeat(65) + "\",\"method\":\"list\"}",
                "{\"v\":1,\"id\":\"r\",\"method\":\"list\",\"params\":\"x\"}", "x".repeat(5000)})
            assertNull(String.valueOf(bad), DownloadsCallerPolicy.handle(ALLOW, bad, a));
        assertTrue(a.calls.isEmpty());
    }

    private static JSONObject json(String s) {
        try { return s == null ? null : new JSONObject(s); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    // ---- native -> page: events reach only the main-frame shell document --------------------------------------------

    @Test public void downloadEventsAreDeliveredOnlyWhileTheShellIsOnTop() {
        assertTrue(DownloadsCallerPolicy.canPush(PRIMARY, SHELL));
        assertTrue(DownloadsCallerPolicy.canPush(PRIMARY, PRIMARY + "/wizard-os-home"));
        assertFalse("another path on the shell origin", DownloadsCallerPolicy.canPush(PRIMARY, PRIMARY + "/some-hosted-app/"));
        assertFalse("an outside site", DownloadsCallerPolicy.canPush(PRIMARY, "https://evil.example/wizard-os-home/"));
        assertFalse(DownloadsCallerPolicy.canPush(PRIMARY, null));
        assertFalse(DownloadsCallerPolicy.canPush(null, SHELL));
    }

    @Test public void anEventIsWrappedForThePortAsOneJsonObjectAndNothingElse() throws Exception {
        String ev = "{\"type\":\"done\",\"item\":{\"id\":\"12\",\"name\":\"a.pdf\"}}";
        String env = DownloadsCallerPolicy.eventEnvelope(ev);
        assertNotNull(env);
        JSONObject o = new JSONObject(env);
        assertEquals(1, o.getInt("v"));
        assertEquals("done", o.getJSONObject("event").getString("type"));
        assertFalse("an event is not a reply: no id", o.has("id"));
        assertNull("not an object", DownloadsCallerPolicy.eventEnvelope("alert(1)"));
        assertNull("trailing code", DownloadsCallerPolicy.eventEnvelope("{} ; alert(1)"));
        assertNull(DownloadsCallerPolicy.eventEnvelope(null));
    }

    @Test public void thereIsNoScriptDeliveryOrGlobalEntryPointLeft() throws Exception {
        // PR #1143 review (a222e3dc): evaluateJavascript(... window.__wosDownloads(...)) needed a global the hosted app could call
        // itself, an oracle that painted the real name of a guessed id. Events now go to the main-frame reply proxy only.
        String main = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/java/ai/wizards/os/MainActivity.java")), "UTF-8");
        String pol = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/java/ai/wizards/os/downloads/DownloadsCallerPolicy.java")), "UTF-8");
        for (String src : new String[] { main, pol }) {
            assertFalse(src.contains("__wosDownloads"));
            assertFalse(src.contains("pushScript"));
        }
        assertTrue("events are posted through the admitted main-frame proxy", main.contains("DownloadsCallerPolicy.eventEnvelope("));
        assertTrue(main.contains("downloadsReply"));
        assertTrue("and only while the shell is on top", main.contains("DownloadsCallerPolicy.canPush("));
    }

    @Test public void theEventProxyIsOnlyEverRememberedForAnAdmittedMessage() throws Exception {
        String main = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/java/ai/wizards/os/MainActivity.java")), "UTF-8");
        int admit = main.indexOf("verdict != DownloadsCallerPolicy.Verdict.ALLOW");
        int store = main.indexOf("downloadsReply = ");
        assertTrue("assignment exists", store > 0);
        assertTrue("assigned after the admission check", admit > 0 && store > admit);
    }

    // ---- the wiring: the old frame-blind Bridge no longer has these methods -------------------------------------

    private static Path mainJava() {
        Path p = Paths.get(System.getProperty("user.dir"), "src/main/java/ai/wizards/os");
        assertTrue(p + " exists", Files.isDirectory(p));
        return p;
    }

    private static String read(Path p) throws Exception { return new String(Files.readAllBytes(p), "UTF-8"); }

    @Test public void theOldBridgeHasNoDownloadsMethods() throws Exception {
        String main = read(mainJava().resolve("MainActivity.java"));
        for (String gone : new String[]{"downloadsList(", "downloadsOpen(", "downloadsCancel(", "downloadsRemove(", "shellCaller("})
            assertFalse("MainActivity must not declare " + gone, main.contains(gone));
        // no @JavascriptInterface anywhere in the app may expose a downloads* method
        List<Path> all;
        try (Stream<Path> s = Files.walk(mainJava())) { all = s.filter(f -> f.toString().endsWith(".java")).collect(Collectors.toList()); }
        for (Path f : all) {
            String t = read(f);
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("@JavascriptInterface\\s+public\\s+[\\w.<>\\[\\]]+\\s+(downloads\\w*)\\s*\\(").matcher(t);
            boolean exposed = m.find();
            assertFalse(f + " exposes a downloads* JavaScript method" + (exposed ? " " + m.group(1) : ""), exposed);
        }
        // the plain toast path (Bridge.download) stays
        assertTrue(main.contains("@JavascriptInterface public void download(String url)"));
    }

    @Test public void theDownloadsPortIsInstalledBehindThePolicyOnly() throws Exception {
        String main = read(mainJava().resolve("MainActivity.java"));
        assertTrue(main.contains("DownloadsCallerPolicy.supported("));
        assertTrue(main.contains("addWebMessageListener(target, DownloadsCallerPolicy.NAME"));
        assertTrue(main.contains("DownloadsCallerPolicy.admit("));
        assertTrue("answers and effects re-check the navigation", main.contains("DownloadsCallerPolicy.stillCurrent("));
        assertTrue("every page load revokes older admissions", main.contains("downloadsEpoch"));
        assertEquals("wizardDownloadsPort", DownloadsCallerPolicy.NAME);
        assertEquals(1, DownloadsCallerPolicy.VERSION);
    }
}
