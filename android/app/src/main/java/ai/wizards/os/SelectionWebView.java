package ai.wizards.os;

import android.content.Context;
import android.graphics.Rect;
import android.os.SystemClock;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebView;

/**
 * Wizard OS draws its own menu for text selected in chats (Copy · Share · Quote · Search · Select all, chosen in
 * Settings). The page tells this view, through WizardOSNative.selection(state), when a selection is its own; then
 * Android's floating Copy/Share/Select all toolbar is started with an empty menu, so it never shows, while the
 * selection, its handles and dragging stay native. Anywhere else (the composer, a hosted app) the stock toolbar runs
 * untouched, so Paste keeps working.
 */
public class SelectionWebView extends WebView {
    // Set from the JS bridge thread, read on the UI thread.
    private volatile long downAt;
    private volatile boolean downEditable, selOurs;

    private ChatScrollCapture scrollCapture;
    private final android.app.Activity activity;
    private String scrollScript = "";
    private ScrollProxyMetrics scrollMetrics;

    public SelectionWebView(Context c) {
        super(c);
        activity = c instanceof android.app.Activity ? (android.app.Activity)c : null;
        if (activity == null) return;
        try (java.io.InputStream in = c.getAssets().open("scroll-capture.js")) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096]; int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            scrollScript = out.toString(java.nio.charset.StandardCharsets.UTF_8.name());
        } catch (Exception ignored) { }
        // Unlike addJavascriptInterface, this port authenticates the calling frame.
        if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.WEB_MESSAGE_LISTENER)) {
            java.util.Set<String> origins = new java.util.HashSet<>();
            origins.add(ai.wizards.os.device.AppState.primaryOrigin(c));
            if (BuildConfig.DEBUG) origins.add(ai.wizards.os.device.AppState.origin(c));
            androidx.webkit.WebViewCompat.addWebMessageListener(this, "wizardScrollPort", origins,
                (view, message, source, mainFrame, reply) -> {
                    if (!mainFrame || source == null || !proxyEligible() || !trustedScrollOrigin(source)) return;
                    try {
                        String raw = message.getData();
                        if (raw == null || raw.length() > 1024) return;
                        org.json.JSONObject b = new org.json.JSONObject(raw);
                        if (b.optInt("v") != 1) return;
                        double dpr = b.optDouble("dpr", 0), vw = b.optDouble("vw", 0);
                        scrollMetrics = dpr > 0 && vw > 0 && Math.abs(getWidth() / dpr - vw) <= 2
                            ? ScrollProxyMetrics.from(b.optString("key"), b.optDouble("height"),
                                b.optDouble("top"), b.optDouble("extent"), dpr) : null;
                    } catch (Exception ignored) { scrollMetrics = null; }
                });
        }
        if (android.os.Build.VERSION.SDK_INT >= 31)
            scrollCapture = new ChatScrollCapture(activity, this);
    }

    private boolean trustedScrollOrigin(android.net.Uri u) {
        return Origin.isPrivate(u) || ai.wizards.os.device.AppState.isQaPage(activity, u);
    }
    private boolean proxyEligible() {
        return activity != null && isAttachedToWindow() && isShown() &&
            (activity.getWindow().getAttributes().flags & android.view.WindowManager.LayoutParams.FLAG_SECURE) == 0 &&
            trustedScrollOrigin(android.net.Uri.parse(getUrl() == null ? "" : getUrl()));
    }
    private ScrollProxyMetrics proxy() { return proxyEligible() ? scrollMetrics : null; }

    void installScrollProxy() {
        if (!proxyEligible() || scrollScript.isEmpty()) return;
        evaluateJavascript(scrollScript + ";window.__wosScrollCapture?.resumeProxy()", null);
    }
    void refreshScrollProxy() {
        if (proxyEligible()) evaluateJavascript("window.__wosScrollCapture?.refreshProxy()", null);
    }
    void scrollPageStarted() { scrollMetrics = null; cancelScrollCapture(); }
    void cancelScrollCapture() {
        if (android.os.Build.VERSION.SDK_INT >= 31 && scrollCapture != null) scrollCapture.abort();
    }

    // OEM Smart Capture probes the View, not the nested DOM. Never intercept touch/fling.
    @Override public boolean canScrollVertically(int direction) {
        ScrollProxyMetrics m = proxy(); return m != null ? m.canScroll(direction) : super.canScrollVertically(direction);
    }
    @Override public int computeVerticalScrollRange() {
        ScrollProxyMetrics m = proxy(); return m != null ? m.range : super.computeVerticalScrollRange();
    }
    @Override public int computeVerticalScrollOffset() {
        ScrollProxyMetrics m = proxy(); return m != null ? m.offset : super.computeVerticalScrollOffset();
    }
    @Override public int computeVerticalScrollExtent() {
        ScrollProxyMetrics m = proxy(); return m != null ? m.extent : super.computeVerticalScrollExtent();
    }
    private void proxyScroll(ScrollProxyMetrics m, String method, int y) {
        evaluateJavascript("window.__wosScrollCapture?.proxyScroll(" + org.json.JSONObject.quote(m.key) +
            "," + org.json.JSONObject.quote(method) + "," + (y / m.dpr) + ")", null);
    }
    @Override public void scrollBy(int x, int y) {
        ScrollProxyMetrics m = proxy();
        if (m != null) {
            if (y != 0) proxyScroll(m, "by", y);
            // View.scrollBy calls virtual scrollTo. Bypass that dispatch for a
            // horizontal-only/no-op call, which must never reset the inner top.
            if (x != 0) super.scrollTo(getScrollX() + x, getScrollY());
            return;
        }
        super.scrollBy(x, y);
    }
    @Override public void scrollTo(int x, int y) {
        ScrollProxyMetrics m = proxy();
        if (m != null) {
            proxyScroll(m, "to", y);
            if (x != getScrollX()) super.scrollTo(x, getScrollY());
            return;
        }
        super.scrollTo(x, y);
    }

    // An OEM screenshot toolbar may pause the Activity while probing/capturing
    // the still-visible window. Match AOSP eligibility, not Activity.resumed.
    @Override public void onPause() { cancelScrollCapture(); super.onPause(); }
    @Override public void onResume() { super.onResume(); installScrollProxy(); }
    @Override protected void onDetachedFromWindow() {
        cancelScrollCapture(); scrollMetrics = null; super.onDetachedFromWindow();
    }

    /** 1 finger down on page text · 2 finger down in a text field · 3 selection is the page's own · 0 selection gone. */
    public void selectionState(int s) {
        if (s == 1 || s == 2) { downAt = SystemClock.uptimeMillis(); downEditable = s == 2; if (s == 2) selOurs = false; }
        else if (s == 3) selOurs = true;
        else if (s == 0) selOurs = false;
    }

    boolean ours() {
        return SelectionPolicy.ours(selOurs, downEditable, SystemClock.uptimeMillis() - downAt);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback cb, int type) {
        return super.startActionMode(type == ActionMode.TYPE_FLOATING && ours() ? new Quiet(cb) : cb, type);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback cb) {
        return super.startActionMode(ours() ? new Quiet(cb) : cb);
    }

    /** The stock selection callback with every menu item removed: the selection lives, the toolbar has nothing to show. */
    static final class Quiet extends ActionMode.Callback2 {
        private final ActionMode.Callback cb;
        Quiet(ActionMode.Callback cb) { this.cb = cb; }
        @Override public boolean onCreateActionMode(ActionMode m, Menu menu) { boolean r = cb.onCreateActionMode(m, menu); menu.clear(); return r; }
        @Override public boolean onPrepareActionMode(ActionMode m, Menu menu) { cb.onPrepareActionMode(m, menu); menu.clear(); return true; }
        @Override public boolean onActionItemClicked(ActionMode m, MenuItem item) { return cb.onActionItemClicked(m, item); }
        @Override public void onDestroyActionMode(ActionMode m) { cb.onDestroyActionMode(m); }
        @Override public void onGetContentRect(ActionMode m, View v, Rect out) {
            if (cb instanceof ActionMode.Callback2) ((ActionMode.Callback2) cb).onGetContentRect(m, v, out); else super.onGetContentRect(m, v, out);
        }
    }
}
