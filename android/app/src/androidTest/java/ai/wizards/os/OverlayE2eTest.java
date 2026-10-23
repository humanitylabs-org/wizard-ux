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
            OverlayPage client = new OverlayPage(page, remote, failure.equals("timeout") ? OverlayPage.TIMEOUT_MS : 10000) {
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
            // Success/security fixtures allow slow emulator rendering independently of production's
            // 1.5 s deadline. The timeout fixture above uses the unchanged production deadline.
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
    @Test public void reattachedOverlayRechecksTheSelectedOrigin() throws Exception {
        // EverywhereService detaches the orb WebView while Wizard OS is in front (exactly when Connect can switch
        // Wizards) and re-adds the SAME WebView later without reloading it.
        try {
            assertTrue(open("everywhere.html", true, "").startsWith("https://fixture.invalid/"));
            ui(() -> activity.setContentView(new android.view.View(activity)));
            context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().putString("origin", "https://other.invalid").commit();
            Thread.sleep(300);
            ui(() -> activity.setContentView(web));
            boolean bundled = false;
            for (int i = 0; i < 40; i++) {
                if (js("location.href").contains("file:///android_asset/")) { bundled = true; break; }
                Thread.sleep(100);
            }
            assertTrue("previous Wizard's privileged page survived detach + origin switch + reattach", bundled);
        } finally { close(); }
    }
    /** A service worker registered by the shell (web/sw.js, scope /wizard-os-home/) or by a hosted app at scope /
     *  must not answer requests from a privileged overlay WebView: SW-controlled fetches bypass WebViewClient
     *  interception, so they would skip the native allowlist, redirect refusal and CSP prefix. */
    @Test public void shellServiceWorkerCannotServeOverlayDocuments() throws Exception {
        AtomicInteger intercepted = new AtomicInteger();
        try (ServerSocket server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))) {
            Thread responder = new Thread(() -> {
                while (!server.isClosed()) try (Socket socket = server.accept()) {
                    BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                    String first = in.readLine(); String line; while ((line = in.readLine()) != null && !line.isEmpty()) { }
                    String path = first == null ? "" : first.split(" ")[1];
                    String type = "text/html", body;
                    if (path.equals("/wizard-os-home/sw.js")) {
                        type = "application/javascript";
                        body = "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));"
                            + "self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname.includes('/assist/'))e.respondWith(new Response('<title>sw-served</title><script>Probe.hit()</scr'+'ipt>',{headers:{'content-type':'text/html'}}));});";
                    } else if (path.equals("/wizard-os-home/reg.html")) {
                        body = "<script>navigator.serviceWorker.register('/wizard-os-home/sw.js',{scope:'/wizard-os-home/'}).then(()=>navigator.serviceWorker.ready).then(()=>document.title='registered',e=>document.title='failed '+e)</script>";
                    } else body = "<title>network</title>";
                    byte[] b = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    OutputStream out = socket.getOutputStream();
                    out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + type + "\r\nContent-Length: " + b.length + "\r\nConnection: close\r\n\r\n").getBytes());
                    out.write(b); out.flush();
                } catch (IOException ignored) { }
            });
            responder.start();
            String base = "http://localhost:" + server.getLocalPort() + "/wizard-os-home/";
            activity = ins.startActivitySync(new Intent(context, OverlayTestActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            AtomicReference<WebView> shell = new AtomicReference<>();
            ui(() -> {
                WebView w = new WebView(activity); shell.set(w); activity.setContentView(w);
                w.getSettings().setJavaScriptEnabled(true);
                w.setWebViewClient(new android.webkit.WebViewClient());
                w.loadUrl(base + "reg.html");
            });
            web = shell.get();
            String title = "";
            for (int i = 0; i < 80 && !title.contains("registered"); i++) { Thread.sleep(100); title = js("document.title"); }
            assertTrue("fixture service worker registered: " + title, title.contains("registered"));
            ui(() -> {
                WebView overlay = new WebView(activity);
                // (fix commit isolates the overlay WebView here, as every OverlayPage host does)
                overlay.getSettings().setJavaScriptEnabled(true);
                overlay.addJavascriptInterface(new Probe(), "Probe");
                overlay.getSettings().setBlockNetworkLoads(true);
                overlay.setWebViewClient(new android.webkit.WebViewClient() {
                    @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView v, android.webkit.WebResourceRequest r) {
                        intercepted.incrementAndGet();
                        return new android.webkit.WebResourceResponse("text/html", "utf-8", 200, "OK", java.util.Map.of(),
                                new ByteArrayInputStream("<title>native</title>".getBytes()));
                    }
                });
                shell.get().destroy();
                web = overlay; activity.setContentView(overlay);
                overlay.loadUrl(base + "assist/everywhere.html");
            });
            title = "";
            for (int i = 0; i < 50 && !(title.contains("native") || title.contains("sw-served")); i++) { Thread.sleep(100); title = js("document.title"); }
            assertEquals("service worker answered a privileged overlay request", "\"native\"", title);
            assertEquals(0, bridgeCalls.get());
            assertTrue(intercepted.get() > 0);
            server.close();
        } finally { close(); }
    }
    @Test public void privilegedBridgeCannotBeReachedBySrcdocDataOrSameOriginFrames() throws Exception {
        for (boolean remote : new boolean[]{true, false}) {
            bridgeCalls.set(0);
            try {
                open("everywhere.html", remote, "");
                assertEquals("\"CSS1Compat\"", js("document.compatMode"));
                js("Probe.hit()"); assertEquals("bridge positive control", 1, bridgeCalls.get()); bridgeCalls.set(0);
                js("for(const src of ['srcdoc','data','same']){let f=document.createElement('iframe');if(src==='srcdoc')f.srcdoc='<script>Probe.hit()</scr'+'ipt>';else f.src=src==='data'?'data:text/html,<script>Probe.hit()</scr'+'ipt>':location.href;document.body.append(f)}");
                Thread.sleep(700);
                assertEquals("frame reached bridge; remote=" + remote, 0, bridgeCalls.get());
                // srcdoc may render inert markup; injected inline scripts must still be denied.
                assertEquals("true", js("Array.from(document.querySelectorAll('iframe')).filter(f=>f.src).every(f=>!f.contentDocument || !f.contentDocument.body.innerHTML.includes('Probe.hit'))"));
            } finally { close(); }
        }
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
