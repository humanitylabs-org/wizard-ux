package ai.wizards.os;

import android.net.http.SslError;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;

/**
 * Where an overlay page (side-button orb, floating orb, screen mode) comes from: the Wizard's own web shell first
 * (<origin>/wizard-os-home/assist/<page>, so its look and behaviour follow web deploys), and the copy bundled in the
 * APK (file:///android_asset/wizard-os-home/assist/<page>, same layout as web/) when the Wizard can't be reached.
 *
 * Security: the Wizard copy is tried only over https at exactly the configured origin (scheme, host, port), and
 * while it is showing every request outside <origin>/wizard-os-home/ is refused, so the page and its native bridge
 * never see any other site. The page never navigates. The bundled copy runs exactly as before: network blocked,
 * nothing but the bundled folder served. Any failure before the page has finished (error, HTTP status >= 400, TLS,
 * a redirect, or no answer within TIMEOUT_MS) drops to the bundled copy.
 *
 * The native bridges stay addJavascriptInterface (several calls return values synchronously, which an origin-scoped
 * WebMessageListener can't do without changing the pages). They are scoped by what the WebView can hold: only the
 * Wizard copy at the exact origin or the bundled copy is ever loaded, nothing navigates, and every other request is
 * refused, so no other origin's script runs where the bridge is.
 */
public class OverlayPage extends WebViewClient {
    static final long TIMEOUT_MS = 1500;
    private static final String TAG = "WizardOverlay";

    /* ---------------------------------------------------------------- loading */

    private final String page;
    private final boolean remoteFirst;
    private final String origin = OverlayPolicy.wizardOrigin();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> fallBack("no answer in " + TIMEOUT_MS + " ms");
    private WebView web;
    private String current;
    private volatile boolean remote;
    private boolean done;

    /** @param page file name in assist/, optionally with a #fragment; @param remoteFirst try the Wizard copy first */
    public OverlayPage(String page, boolean remoteFirst) {
        this.page = page;
        this.remoteFirst = remoteFirst;
    }

    /** Loads the page into {@code v}; {@link #ready} runs once, for whichever copy ends up showing. */
    public void load(WebView v) {
        web = v;
        String r = remoteFirst ? OverlayPolicy.remoteUrl(origin, page) : null;
        show(r != null, r != null ? r : OverlayPolicy.bundledUrl(page));
    }

    /** The page has finished loading (the Wizard copy, or the bundled one). Main thread. */
    protected void ready(WebView v, String url) { }

    private void show(boolean fromWizard, String url) {
        remote = fromWizard;
        current = url;
        done = false;
        web.getSettings().setBlockNetworkLoads(!fromWizard);
        web.getSettings().setAllowFileAccess(!fromWizard); // bundled copy: as before; the Wizard copy never needs file:
        main.removeCallbacks(timeout);
        if (fromWizard) main.postDelayed(timeout, TIMEOUT_MS);
        web.loadUrl(url);
    }

    private void fallBack(String why) {
        if (!remote || done || web == null) return;
        Log.i(TAG, page + ": Wizard copy unavailable (" + why + "); showing the bundled copy");
        web.stopLoading();
        show(false, OverlayPolicy.bundledUrl(page));
    }

    /** Overlay pages never navigate. A Wizard that redirects the page (a login wall, a move) gets the bundled copy. */
    @Override
    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        if (r.isForMainFrame()) fallBack("navigation to " + r.getUrl().getHost());
        return true;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        String u = r.getUrl().toString();
        if (remote ? OverlayPolicy.fromWizard(origin, u) : OverlayPolicy.bundled(u)) return null;
        return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", null, new ByteArrayInputStream(new byte[0]));
    }

    @Override
    public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) { fallBack("error " + e.getErrorCode()); }

    @Override
    public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse resp) {
        if (resp.getStatusCode() >= 400) fallBack("HTTP " + resp.getStatusCode() + " " + r.getUrl().getPath());
    }

    @Override
    public void onReceivedSslError(WebView v, SslErrorHandler h, SslError e) {
        h.cancel();
        fallBack("TLS");
    }

    @Override
    public final void onPageFinished(WebView v, String url) {
        if (done || current == null || !OverlayPolicy.samePage(current, url)) return; // an abandoned attempt
        done = true;
        main.removeCallbacks(timeout);
        Log.i(TAG, page + " from " + (remote ? "the Wizard" : "the bundled copy"));
        ready(v, url);
    }
}
