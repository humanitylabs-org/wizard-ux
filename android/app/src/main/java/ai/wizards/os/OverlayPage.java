package ai.wizards.os;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/** Exact-origin static documents, or the APK copy offline. No WebView-owned network requests:
 * Android's shouldInterceptRequest is NOT called for subsequent redirect URLs. Native fetches
 * refuse redirects and attach a frame/worker-denying CSP to every document, including the bundle.
 * The synchronous bridges remain private to these three trusted top-level pages, not arbitrary
 * same-origin shell pages. A compromised selected Wizard can still supply privileged JavaScript.
 */
public class OverlayPage extends WebViewClient {
    static final long TIMEOUT_MS = 1500;
    private final String page;
    private final boolean remoteFirst;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> fallBack("timeout");
    private WebView web;
    private String current;
    private volatile String origin;
    private volatile boolean remote;
    private volatile int generation;
    private boolean done;

    public OverlayPage(String page, boolean remoteFirst) {
        if (!OverlayPolicy.validPage(page)) throw new IllegalArgumentException("Unknown overlay page");
        this.page = page;
        this.remoteFirst = remoteFirst;
    }
    public void load(WebView v) {
        web = v;
        origin = ServerSettings.origin(v.getContext());
        String r = remoteFirst ? OverlayPolicy.remoteUrl(origin, page) : null;
        show(r != null, r != null ? r : OverlayPolicy.bundledUrl(page));
    }
    protected void ready(WebView v, String url) { }
    private void show(boolean fromWizard, String url) {
        generation++;
        remote = fromWizard;
        current = url;
        done = false;
        // Interception serves even assets. Never permit a default-network or content/file bypass.
        web.getSettings().setBlockNetworkLoads(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        main.removeCallbacks(timeout);
        if (fromWizard) main.postDelayed(timeout, TIMEOUT_MS);
        web.loadUrl(url);
    }
    private void fallBack(String why) {
        if (!remote || web == null) return;
        Log.i("WizardOverlay", page + ": " + why + "; showing bundled copy");
        web.stopLoading();
        show(false, OverlayPolicy.bundledUrl(page));
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
        String u = r.getUrl().toString();
        if (!"GET".equals(r.getMethod()) || !(fromWizard ? OverlayPolicy.fromWizard(origin, u) : OverlayPolicy.bundled(u))) return blocked();
        // A subframe may not load even an allowlisted document (defence beyond frame-src).
        if (u.split("#", 2)[0].endsWith(".html") && (!r.isForMainFrame() || !OverlayPolicy.samePage(current, u))) return blocked();
        try {
            byte[] bytes = fromWizard ? fetch(u) : read(web.getContext().getAssets().open(r.getUrl().getPath().substring("/android_asset/".length())));
            String path = r.getUrl().getPath();
            String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "image/png";
            return new WebResourceResponse(mime, "utf-8", 200, "OK",
                    Map.of("Content-Security-Policy", OverlayPolicy.CSP, "X-Content-Type-Options", "nosniff", "Cache-Control", "no-store"), new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            if (fromWizard) main.post(() -> { if (generation == attempt) fallBack("static resource unavailable"); });
            return blocked();
        }
    }
    /** Native HTTPS transport: no redirect, cache, unbounded stream, or weakened certificate checks. */
    protected byte[] fetch(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(1000);
        c.setReadTimeout(1000);
        c.setUseCaches(false);
        String cookies = origin == null ? null : CookieManager.getInstance().getCookie(origin);
        if (cookies != null) c.setRequestProperty("Cookie", cookies);
        try {
            if (c.getResponseCode() != 200) throw new java.io.IOException("HTTP " + c.getResponseCode());
            return read(c.getInputStream());
        } finally { c.disconnect(); }
    }
    private static byte[] read(InputStream input) throws Exception {
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) != -1) {
                if (out.size() + n > 4 * 1024 * 1024) throw new java.io.IOException("Overlay resource too large");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }
    @Override public final void onPageFinished(WebView v, String url) {
        if (done || current == null || !OverlayPolicy.samePage(current, url)) return;
        final int attempt = generation;
        // onPageFinished does not mean that an external script ran (HTTP-200 login/error HTML,
        // syntax errors, missing Orb). Keep the deadline armed until the actual page API exists.
        String api = page.startsWith("surface") ? "W" : page.startsWith("everywhere") ? "E" : "S";
        v.evaluateJavascript("!!(window." + api + ("S".equals(api) ? ")" : " && window.Orb)"), value -> {
            if (generation != attempt || done) return;
            if (!"true".equals(value)) { fallBack("page API missing"); return; }
            done = true;
            main.removeCallbacks(timeout);
            Log.i("WizardOverlay", page + " from " + (remote ? "Wizard" : "bundle"));
            ready(v, url);
        });
    }
}
