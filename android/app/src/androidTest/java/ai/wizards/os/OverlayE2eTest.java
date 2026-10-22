package ai.wizards.os;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.net.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

/** Actual Android WebView + shipped HTML/JS; synthetic HTTPS responses, NOT physical host-flow proof. */
@RunWith(AndroidJUnit4.class)
public class OverlayE2eTest {
    final android.app.Instrumentation ins = InstrumentationRegistry.getInstrumentation();
    final Context context = ins.getTargetContext();
    final AtomicInteger bridgeCalls = new AtomicInteger();
    final AtomicInteger fetchCalls = new AtomicInteger();
    volatile boolean failLate;
    Activity activity;
    WebView web;
    public final class Probe {
        @JavascriptInterface public void log(String s) { }
        @JavascriptInterface public void hit() { bridgeCalls.incrementAndGet(); }
    }
    private void ui(Runnable r) { ins.runOnMainSync(r); }
    private String js(String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>(); CountDownLatch latch = new CountDownLatch(1);
        ui(() -> web.evaluateJavascript(script, v -> { result.set(v); latch.countDown(); }));
        assertTrue("JS callback", latch.await(5, TimeUnit.SECONDS)); return result.get();
    }
    private void close() {
        ui(() -> { if (web != null) web.destroy(); if (activity != null) activity.finish(); });
    }
    private String open(String page, boolean remote, String failure) throws Exception {
        context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().putString("origin", "https://fixture.invalid").commit();
        activity = ins.startActivitySync(new Intent(context, OverlayTestActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        CountDownLatch ready = new CountDownLatch(1); AtomicReference<String> loaded = new AtomicReference<>();
        ui(() -> {
            web = new WebView(activity); activity.setContentView(web);
            web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
            web.addJavascriptInterface(new Probe(), "EverywhereNative"); web.addJavascriptInterface(new Probe(), "Probe");
            OverlayPage client = new OverlayPage(page, remote) {
                @Override protected byte[] fetch(String u) throws Exception {
                    fetchCalls.incrementAndGet();
                    if (failLate) throw new IOException("late resource failure");
                    if (failure.equals("offline")) throw new IOException("fixture network down");
                    if (failure.equals("timeout")) Thread.sleep(2200);
                    if (failure.equals("script") && u.endsWith("everywhere.js")) throw new IOException("fixture JS 404");
                    if (failure.equals("login") && u.endsWith(".html")) return "<title>Sign in</title>".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    try (InputStream in = context.getAssets().open("wizard-os-home/" + new URI(u).getPath().substring(OverlayPolicy.SHELL.length()))) {
                        return in.readAllBytes();
                    }
                }
                @Override protected void ready(WebView v, String u) { loaded.set(u); ready.countDown(); }
            };
            web.setWebViewClient(client); client.load(web);
        });
        assertTrue("overlay ready: " + page + "/" + failure, ready.await(12, TimeUnit.SECONDS));
        return loaded.get();
    }
    @Test public void shippedPagesRemoteAndBundledWithNativeStateUpdates() throws Exception {
        for (boolean remote : new boolean[]{true, false}) {
            for (String page : new String[]{"surface.html#corner", "everywhere.html", "screen.html"}) {
                try {
                    String url = open(page, remote, "");
                    assertTrue(url, url.startsWith(remote ? "https://fixture.invalid/" : OverlayPolicy.ASSETS));
                    if (page.startsWith("surface")) {
                        assertEquals("true", js("W.setMode('corner');W.lockState(false);W.begin();document.body.classList.contains('corner')"));
                        assertEquals("\"unlocked\"", js("document.getElementById('lock').textContent"));
                        js("W.lockState(true);W.onQueued('offline')");
                        assertEquals("\"🔒 locked\"", js("document.getElementById('lock').textContent"));
                    } else if (page.startsWith("everywhere")) {
                        assertEquals("true", js("E.state({mode:'listen'});document.body.classList.contains('live')"));
                        assertEquals("true", js("E.state({mode:'paused'});document.body.classList.contains('paused')"));
                    } else assertEquals("\"function\"", js("typeof S.open"));
                } finally { close(); }
            }
        }
    }
    @Test public void offlineTimeoutMissingScriptAndHttp200LoginFallBack() throws Exception {
        for (String failure : new String[]{"offline", "timeout", "script", "login"}) {
            try { assertTrue(failure, open("everywhere.html", true, failure).startsWith(OverlayPolicy.ASSETS)); }
            finally { close(); }
        }
    }
    @Test public void lateScriptFailureStillRecoversAndLockedPolicyNeverFetches() throws Exception {
        try {
            open("everywhere.html", true, "");
            failLate = true;
            js("let s=document.createElement('script');s.src='../orb.js';document.body.append(s)");
            boolean bundled = false;
            for (int i = 0; i < 40; i++) {
                if (js("location.href").contains("file:///android_asset/")) { bundled = true; break; }
                Thread.sleep(100);
            }
            assertTrue("late resource failure must recover after ready", bundled);
        } finally { close(); }
        fetchCalls.set(0); failLate = false;
        try {
            assertTrue(open("surface.html", false, "offline").startsWith(OverlayPolicy.ASSETS));
            assertEquals("bundled-only lock policy must not fetch", 0, fetchCalls.get());
        } finally { close(); }
    }
    @Test public void runtimeSelectionInvalidatesAnAlreadyLoadedRemotePage() throws Exception {
        try {
            assertTrue(open("everywhere.html", true, "").startsWith("https://fixture.invalid/"));
            context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().putString("origin", "https://other.invalid").commit();
            boolean bundled = false;
            for (int i = 0; i < 40; i++) {
                if (js("location.href").contains("file:///android_asset/")) { bundled = true; break; }
                Thread.sleep(100);
            }
            assertTrue("old Wizard document survives selected-origin change", bundled);
        } finally { close(); }
    }
    @Test public void privilegedBridgeCannotBeReachedBySrcdocDataOrSameOriginFrames() throws Exception {
        try {
            open("everywhere.html", true, "");
            js("Probe.hit()"); assertEquals("bridge positive control", 1, bridgeCalls.get()); bridgeCalls.set(0);
            js("for(const src of ['srcdoc','data','same']){let f=document.createElement('iframe');if(src==='srcdoc')f.srcdoc='<script>Probe.hit()<\\/script>';else f.src=src==='data'?'data:text/html,<script>Probe.hit()<\\/script>':'https://fixture.invalid/wizard-os-home/assist/surface.html';document.body.append(f)}");
            Thread.sleep(700);
            assertEquals(0, bridgeCalls.get());
            // Chromium can create an inert srcdoc document even with frame-src 'none'.
            // Its inherited script-src forbids the injected inline script; network/data frames are denied.
            assertEquals("true", js("Array.from(document.querySelectorAll('iframe')).filter(f=>f.src).every(f=>!f.contentDocument)"));
        } finally { close(); }
    }
    @Test public void nativeTransportDoesNotFollowSubresourceRedirects() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        try (ServerSocket server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))) {
            Thread responder = new Thread(() -> {
                try (Socket socket = server.accept()) {
                    requests.incrementAndGet();
                    BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                    String line; while ((line = in.readLine()) != null && !line.isEmpty()) { }
                    socket.getOutputStream().write(("HTTP/1.1 302 Found\r\nLocation: http://localhost:" + server.getLocalPort() + "/evil.js\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes());
                } catch (IOException ignored) { }
            });
            responder.start();
            // Direct transport probe only: release request policy never admits this HTTP URL.
            try { new OverlayPage("everywhere.html", true).fetch("http://localhost:" + server.getLocalPort() + "/orb.js"); fail("redirect accepted"); }
            catch (IOException expected) { assertTrue(expected.getMessage(), expected.getMessage().contains("302")); }
            responder.join(3000); assertEquals(1, requests.get());
        }
    }
}
