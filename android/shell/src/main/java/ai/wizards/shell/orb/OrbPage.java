package ai.wizards.shell.orb;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import ai.wizards.shell.ShellOrigin;

/**
 * The orb's page from the selected Wizard, or the APK copy offline. Ported from android/app's OverlayPage (#323):
 * no WebView-owned network requests (Android doesn't intercept redirect hops or service-worker answers), so the
 * remote page lives on {@link OrbPolicy#VIRTUAL}; native fetches refuse redirects, bound time and size, and put the
 * CSP before any remote markup. The page's fixed dependencies are fetched concurrently (OrbPrefetch, memory only,
 * per load). A page whose API (window.E and window.Orb) isn't up within 1.5 s is replaced by the
 * bundled copy. Detach/reattach (the orb hides while the Wizard app is in front) rechecks the selected Wizard.
 * No JavaScript interface: OrbService installs a separate exact-origin, main-frame, take-bound recording-control port.
 */
public class OrbPage extends WebViewClient {
    static final String TAG = "ShellOrb";
    public static final long TIMEOUT_MS = 1500;
    static final long FETCH_TOTAL_MS = 3000;
    private static final ScheduledThreadPoolExecutor DEADLINES = deadlines();

    private static ScheduledThreadPoolExecutor deadlines() {
        ScheduledThreadPoolExecutor e = new ScheduledThreadPoolExecutor(1, r -> { Thread t = new Thread(r, "orb-deadline"); t.setDaemon(true); return t; });
        e.setRemoveOnCancelPolicy(true);
        return e;
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> fallBack("timeout");
    private WebView web;
    private String current;
    private volatile String origin;
    private volatile boolean remote;
    private volatile int generation;
    private volatile OrbPrefetch prefetch;
    private boolean done;
    private SharedPreferences prefs;
    private final SharedPreferences.OnSharedPreferenceChangeListener changed = (p, key) -> {
        if (ShellOrigin.KEY.equals(key)) main.post(() -> {
            if (remote && web != null && !String.valueOf(origin).equals(ShellOrigin.selected(web.getContext()))) fallBack("selected Wizard changed");
        });
    };

    public void load(WebView v) {
        web = v;
        Context c = v.getContext();
        origin = ShellOrigin.selected(c);
        prefs = c.getSharedPreferences(ShellOrigin.PREFS, Context.MODE_PRIVATE);
        prefs.registerOnSharedPreferenceChangeListener(changed);
        v.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
            @Override public void onViewAttachedToWindow(View view) {
                // The SAME WebView is re-added without reloading: recheck what changed while it was hidden.
                prefs.registerOnSharedPreferenceChangeListener(changed);
                if (remote && !String.valueOf(origin).equals(ShellOrigin.selected(view.getContext()))) { fallBack("selected Wizard changed while hidden"); return; }
                if (remote && !done) { main.removeCallbacks(timeout); main.postDelayed(timeout, TIMEOUT_MS); }
            }
            @Override public void onViewDetachedFromWindow(View view) {
                prefs.unregisterOnSharedPreferenceChangeListener(changed);
                main.removeCallbacks(timeout);
                generation++; // ignore asynchronous completions after this host is hidden
                clearPrefetch();
            }
        });
        String r = OrbPolicy.remoteUrl(origin);
        show(r != null, r != null ? r : OrbPolicy.bundledUrl());
    }

    /** The page's API is up. */
    protected void ready(WebView v, boolean fromWizard) { }

    public void close() {
        if (prefs != null) prefs.unregisterOnSharedPreferenceChangeListener(changed);
        main.removeCallbacks(timeout);
        generation++;
        clearPrefetch();
    }

    private void clearPrefetch() {
        OrbPrefetch old = prefetch;
        prefetch = null;
        if (old != null) old.close();
    }

    private void show(boolean fromWizard, String url) {
        generation++;
        clearPrefetch();
        remote = fromWizard;
        current = url;
        done = false;
        // No WebView-owned network, file or content access. android_asset loads bypass interception, so the bundled
        // HTML embeds its own (tested) CSP.
        web.getSettings().setBlockNetworkLoads(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        main.removeCallbacks(timeout);
        if (fromWizard) {
            main.postDelayed(timeout, TIMEOUT_MS);
            final String owner = origin;
            final int attempt = generation;
            final Context c = web.getContext();
            // The page's fixed dependencies at once instead of a serial waterfall; same policy and transport.
            prefetch = new OrbPrefetch(OrbPrefetch.PATHS, TIMEOUT_MS, path -> {
                if (attempt != generation || !String.valueOf(owner).equals(ShellOrigin.selected(c))) throw new IOException("orb owner changed");
                return fetch(OrbPolicy.upstream(owner, OrbPolicy.VIRTUAL + OrbPolicy.SHELL + path));
            });
        }
        web.loadUrl(url);
    }

    private void fallBack(String why) {
        if (!remote || web == null) return;
        Log.i(TAG, "page: " + why + "; showing the bundled copy");
        web.stopLoading();
        show(false, OrbPolicy.bundledUrl());
    }

    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        if (r.isForMainFrame()) fallBack("navigation");
        return true;
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", Map.of(), new ByteArrayInputStream(new byte[0]));
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        final int attempt = generation;
        final boolean fromWizard = remote;
        final String owner = origin;
        final OrbPrefetch batch = prefetch;
        String u = r.getUrl().toString();
        if (!"GET".equals(r.getMethod()) || !(fromWizard ? OrbPolicy.fromWizard(owner, u) : OrbPolicy.bundled(u))) return blocked();
        // A subframe may not load even an allowlisted document (defence beyond frame-src).
        if (u.split("#", 2)[0].endsWith(".html") && (!r.isForMainFrame() || !OrbPolicy.samePage(current, u))) return blocked();
        try {
            byte[] bytes;
            if (fromWizard) {
                if (!String.valueOf(owner).equals(ShellOrigin.selected(v.getContext()))) return blocked();
                String path = r.getUrl().getPath().substring(OrbPolicy.SHELL.length());
                bytes = batch == null ? null : batch.take(path);
                if (bytes == null) bytes = fetch(OrbPolicy.upstream(owner, u));
                if (attempt != generation || !remote || !String.valueOf(owner).equals(ShellOrigin.selected(v.getContext()))) return blocked();
            } else {
                String asset = u.startsWith(OrbPolicy.VIRTUAL + OrbPolicy.SHELL)
                        ? "wizard-os-home/" + r.getUrl().getPath().substring(OrbPolicy.SHELL.length())
                        : r.getUrl().getPath().substring("/android_asset/".length());
                bytes = read(v.getContext().getAssets().open(asset), Long.MAX_VALUE);
            }
            String path = r.getUrl().getPath();
            String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "image/png";
            if (path.endsWith(".html")) {
                // Install the policy before ANY supplied remote markup, independent of server headers.
                byte[] head = ("<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"" + OrbPolicy.CSP + "\">").getBytes(StandardCharsets.UTF_8);
                byte[] secured = new byte[head.length + bytes.length];
                System.arraycopy(head, 0, secured, 0, head.length);
                System.arraycopy(bytes, 0, secured, head.length, bytes.length);
                bytes = secured;
            }
            return new WebResourceResponse(mime, "utf-8", 200, "OK",
                    Map.of("Content-Security-Policy", OrbPolicy.CSP, "X-Content-Type-Options", "nosniff", "Cache-Control", "no-store"), new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            if (fromWizard) main.post(() -> { if (generation == attempt) fallBack("static resource unavailable"); });
            return blocked();
        }
    }

    /** Native HTTPS transport: no redirect, cache, unbounded stream, or weakened certificate checks. */
    protected byte[] fetch(String url) throws Exception {
        if (url == null) throw new IOException("not an orb resource");
        final long deadline = System.nanoTime() + FETCH_TOTAL_MS * 1_000_000L;
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(1000);
        c.setReadTimeout(1000);
        c.setUseCaches(false);
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null) c.setRequestProperty("Cookie", cookies);
        ScheduledFuture<?> expiry = DEADLINES.schedule(c::disconnect, Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
        try {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            return read(c.getInputStream(), deadline);
        } finally { expiry.cancel(false); c.disconnect(); }
    }

    private static byte[] read(InputStream input, long deadlineNanos) throws IOException {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) != -1; ) {
                if (System.nanoTime() > deadlineNanos) throw new IOException("Orb resource too slow");
                if (out.size() + n > 4 * 1024 * 1024) throw new IOException("Orb resource too large");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    @Override public final void onPageFinished(WebView v, String url) {
        if (done || current == null || !OrbPolicy.samePage(current, url)) return;
        final int attempt = generation;
        // onPageFinished doesn't mean the scripts ran (a 200 login page, a missing orb.js): wait for the real API.
        v.evaluateJavascript("!!(window.E && window.Orb && window.WosShellOrb && WosShellOrb.v === 1)", value -> {
            if (generation != attempt || done) return;
            if (!"true".equals(value)) { fallBack("page API missing"); return; }
            done = true;
            main.removeCallbacks(timeout);
            Log.i(TAG, "page from " + (remote ? "Wizard" : "bundle"));
            ready(v, remote);
        });
    }
}
