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
    private ScrollAccessibilityProvider diagnosticProvider;
    private ScrollGestureDiagnostics touchDiagnostics, motionDiagnostics;
    private org.json.JSONObject proxyState;
    void recordProxyState() {
        ScrollCaptureDiagnostics.record("js.proxy",proxyState==null?ScrollCaptureDiagnostics.fields("reason","no-metrics-yet"):proxyState);
    }
    private void probe(String method, Object... data) {
        if(ScrollCaptureDiagnostics.armed())ScrollCaptureDiagnostics.record(method,ScrollCaptureDiagnostics.fields(data));
    }

    public SelectionWebView(Context c) {
        super(c);
        activity = c instanceof android.app.Activity ? (android.app.Activity)c : null;
        ScrollCaptureDiagnostics.init(c);
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
                        String reason=b.optString("reason","unknown");
                        // The helper emits constants only. Do not accept arbitrary strings from a page.
                        java.util.Set<String> allowed=new java.util.HashSet<>(java.util.Arrays.asList("ok","none","hidden","capture-active",
                            "background","not-overflowing","too-small","offscreen","unsupported-transform","occluded","dpr"));
                        for(String part:reason.split("\\|"))if(!allowed.contains(part)){reason="invalid-reason";break;}
                        proxyState=ScrollCaptureDiagnostics.fields("height",b.optDouble("height",0),"top",b.optDouble("top",0),
                            "extent",b.optDouble("extent",0),"dpr",b.optDouble("dpr",0),"vw",b.optDouble("vw",0),"reason",reason);
                        if(ScrollCaptureDiagnostics.armed())recordProxyState();
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
    // Retired: One UI drives the AOSP ScrollCaptureCallback and never queries View scrollability
    // (0.9.39 device recording). Overriding WebView scroll metrics was pure risk.
    static final boolean SCROLL_PROXY = false;
    private ScrollProxyMetrics proxy() { return SCROLL_PROXY && proxyEligible() ? scrollMetrics : null; }

    void installScrollProxy() {
        if (!proxyEligible() || scrollScript.isEmpty()) return;
        evaluateJavascript(scrollScript + ";window.__wosScrollCapture?.resumeProxy()", null);
    }
    void refreshScrollProxy() {
        if (proxyEligible()) evaluateJavascript("window.__wosScrollCapture?.refreshProxy()", null);
    }
    void scrollPageStarted() { scrollMetrics = null; cancelScrollCapture(); }
    // An OS scroll capture (One UI's toolbar) may pause the Activity mid-session. A paused
    // WebView stops producing frames, so postVisualStateCallback never fires and every tile
    // comes back empty. Keep rendering while a session is live; apply the pause after it ends.
    private boolean pauseWanted, capturing, webPaused;
    @Override public void onPause() { pauseWanted = true; if (!capturing && !webPaused) { webPaused = true; super.onPause(); } }
    @Override public void onResume() { pauseWanted = false; if (webPaused) { webPaused = false; super.onResume(); } installScrollProxy(); }
    void scrollCaptureBegan() {
        capturing = true; ScrollCaptureDiagnostics.capturing = true;
        if (webPaused) { webPaused = false; super.onResume(); }
        ScrollCaptureDiagnostics.record("capture.render",ScrollCaptureDiagnostics.fields("pauseWanted",pauseWanted));
    }
    void scrollCaptureEnded() {
        capturing = false; ScrollCaptureDiagnostics.capturing = false;
        if (pauseWanted && !webPaused) { webPaused = true; super.onPause(); }
    }
    void cancelScrollCapture() {
        if (android.os.Build.VERSION.SDK_INT >= 31 && scrollCapture != null) scrollCapture.abort();
    }

    // OEM Smart Capture probes the View, not the nested DOM. Never intercept touch/fling.
    @Override public boolean canScrollVertically(int direction) {
        if(ScrollCaptureDiagnostics.armed())probe("canScrollVertically.enter","direction",direction);
        ScrollProxyMetrics m = proxy(); boolean result=m != null ? m.canScroll(direction) : super.canScrollVertically(direction);
        if(ScrollCaptureDiagnostics.armed())probe("canScrollVertically","direction",direction,"result",result,"proxy",m!=null);return result;
    }
    @Override public int computeVerticalScrollRange() {
        if(ScrollCaptureDiagnostics.armed())probe("computeVerticalScrollRange.enter");
        ScrollProxyMetrics m = proxy(); int result=m != null ? m.range : super.computeVerticalScrollRange();
        if(ScrollCaptureDiagnostics.armed())probe("computeVerticalScrollRange","result",result,"proxy",m!=null);return result;
    }
    @Override public int computeVerticalScrollOffset() {
        if(ScrollCaptureDiagnostics.armed())probe("computeVerticalScrollOffset.enter");
        ScrollProxyMetrics m = proxy(); int result=m != null ? m.offset : super.computeVerticalScrollOffset();
        if(ScrollCaptureDiagnostics.armed())probe("computeVerticalScrollOffset","result",result,"proxy",m!=null);return result;
    }
    @Override public int computeVerticalScrollExtent() {
        if(ScrollCaptureDiagnostics.armed())probe("computeVerticalScrollExtent.enter");
        ScrollProxyMetrics m = proxy(); int result=m != null ? m.extent : super.computeVerticalScrollExtent();
        if(ScrollCaptureDiagnostics.armed())probe("computeVerticalScrollExtent","result",result,"proxy",m!=null);return result;
    }
    private void proxyScroll(ScrollProxyMetrics m, String method, int y) {
        evaluateJavascript("window.__wosScrollCapture?.proxyScroll(" + org.json.JSONObject.quote(m.key) +
            "," + org.json.JSONObject.quote(method) + "," + (y / m.dpr) + ")", null);
    }
    @Override public void scrollBy(int x, int y) {
        if(ScrollCaptureDiagnostics.armed())probe("scrollBy","x",x,"y",y);
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
        if(ScrollCaptureDiagnostics.armed())probe("scrollTo","x",x,"y",y);
        ScrollProxyMetrics m = proxy();
        if (m != null) {
            proxyScroll(m, "to", y);
            if (x != getScrollX()) super.scrollTo(x, getScrollY());
            return;
        }
        super.scrollTo(x, y);
    }

    @Override protected boolean overScrollBy(int dx,int dy,int sx,int sy,int rx,int ry,int mx,int my,boolean touch) {
        if(ScrollCaptureDiagnostics.armed())probe("overScrollBy","deltaX",dx,"deltaY",dy,"scrollY",sy,"rangeY",ry,"maxOverY",my,"touch",touch);
        return super.overScrollBy(dx,dy,sx,sy,rx,ry,mx,my,touch);
    }
    @Override public android.view.accessibility.AccessibilityNodeProvider getAccessibilityNodeProvider() {
        android.view.accessibility.AccessibilityNodeProvider p=super.getAccessibilityNodeProvider();
        ScrollCaptureDiagnostics.gated("getAccessibilityNodeProvider",ScrollCaptureDiagnostics.fields("present",p!=null));
        if(p==null)return null;
        if(diagnosticProvider==null || diagnosticProvider.delegate!=p)diagnosticProvider=new ScrollAccessibilityProvider(this,p);
        return diagnosticProvider;
    }
    @Override public android.view.accessibility.AccessibilityNodeInfo createAccessibilityNodeInfo() {
        android.view.accessibility.AccessibilityNodeInfo n=super.createAccessibilityNodeInfo();
        ScrollAccessibilityProvider.node("createAccessibilityNodeInfo",-1,n);return n;
    }
    @Override public void onInitializeAccessibilityNodeInfo(android.view.accessibility.AccessibilityNodeInfo info) {
        super.onInitializeAccessibilityNodeInfo(info);
        initializeProxyAccessibilityNode(info);
        ScrollAccessibilityProvider.node("onInitializeAccessibilityNodeInfo",-1,info);
    }
    void initializeProxyAccessibilityNode(android.view.accessibility.AccessibilityNodeInfo info) {
        ScrollProxyMetrics m=proxy();
        // Host node only. Chromium's virtual descendants and TalkBack actions stay delegated unchanged.
        if(m!=null) {
            info.setScrollable(true);
            if(m.canScroll(1))info.addAction(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD);
            if(m.canScroll(-1))info.addAction(android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD);
        }
    }
    @Override public boolean performAccessibilityAction(int action,android.os.Bundle args) {
        ScrollCaptureDiagnostics.arm("accessibility-action");recordProxyState();
        ScrollCaptureDiagnostics.record("performAccessibilityAction",ScrollCaptureDiagnostics.fields("action",action,
            "arguments",ScrollCaptureDiagnostics.arguments(args)));
        if(performProxyAccessibilityAction(action))return true;
        return super.performAccessibilityAction(action,args);
    }
    boolean performProxyAccessibilityAction(int action) {
        ScrollProxyMetrics m=proxy();
        int direction=action==4096?1:action==8192?-1:0;
        // Do not run Chromium's root document scroll in addition to the inner scroll.
        if(m!=null && direction!=0 && m.canScroll(direction)) {
            proxyScroll(m,"by",direction*Math.max(1,m.extent-Math.min(120,m.extent/8)));return true;
        }
        return false;
    }
    @Override public boolean dispatchTouchEvent(android.view.MotionEvent event) {
        if(touchDiagnostics==null)touchDiagnostics=new ScrollGestureDiagnostics();
        touchDiagnostics.event("dispatchTouchEvent",event);return super.dispatchTouchEvent(event);
    }
    @Override public boolean dispatchGenericMotionEvent(android.view.MotionEvent event) {
        if(motionDiagnostics==null)motionDiagnostics=new ScrollGestureDiagnostics();
        motionDiagnostics.event("dispatchGenericMotionEvent",event);return super.dispatchGenericMotionEvent(event);
    }

    // An OEM screenshot toolbar may pause the Activity while probing/capturing
    // the still-visible window. Match AOSP eligibility, not Activity.resumed.
    // Pause/visibility alone is not cancellation: SystemUI may own an active capture.
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
