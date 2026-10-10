package ai.wizards.os.assist;

import android.annotation.SuppressLint;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.voice.VoiceInteractionSession;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;

/**
 * The corner orb (phone unlocked). Android's assistant window covers the screen, but only the
 * orb's own rectangle is touchable, so every tap elsewhere reaches the app underneath — the same
 * mechanism Google Assistant's floating overlay uses.
 *
 * Phone locked: this session immediately hands over to the full lock-screen surface
 * ({@link AssistLockActivity}) and hides.
 */
final class WizardSession extends VoiceInteractionSession implements VoiceCapture.View {
    static final String TAG = AssistLockActivity.TAG;
    static final String ARG_HANDOFF = "wizard_handoff";
    static final String ARG_HEARD = "wizard_heard";
    static final int ORB_DP = 132;
    static final int MARGIN_DP = 14;
    static final int BUBBLE_MAX_DP = 380;
    /** After a take is handed to the outbox the orb plays its "sent" pulse and gets out of the way. */
    static final long CLOSE_AFTER_SEND_MS = 450;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final VoiceCapture capture;
    private final KeyguardManager keyguard;
    private FrameLayout root;
    private WebView web;
    private boolean pageReady;
    private Runnable pending;
    private boolean wide;
    private int navInset;
    private String heard = "";

    WizardSession(Context context) {
        super(context);
        capture = VoiceCapture.get(context);
        keyguard = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // Clear window: no scrim, no dim, nothing drawn outside the orb.
        getWindow().getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        getWindow().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    public View onCreateContentView() {
        root = new FrameLayout(getContext());
        root.setBackgroundColor(Color.TRANSPARENT);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            navInset = Build.VERSION.SDK_INT >= 30
                    ? insets.getInsetsIgnoringVisibility(WindowInsets.Type.navigationBars()).bottom
                    : insets.getStableInsetBottom();
            layoutOrb();
            return insets;
        });
        web = new WebView(getContext());
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccess(true); // only file:///android_asset/assist/ is served; everything else is blocked
        s.setBlockNetworkLoads(true);
        web.addJavascriptInterface(new Bridge(), "WizardNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request.getUrl().toString().startsWith("file:///android_asset/assist/")) return null;
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", null,
                        new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                js("W.setMode('corner')");
                js("W.lockState(false)");
                Runnable p = pending;
                pending = null;
                if (p != null) p.run();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, "js: " + m.message());
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(dp(ORB_DP), dp(ORB_DP), Gravity.BOTTOM | Gravity.END));
        if (ai.wizards.os.BuildConfig.DEBUG) web.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            int[] at = new int[2]; // QA builds: where the orb window really is on screen, after every layout
            v.getLocationOnScreen(at);
            Log.i(TAG, "orb frame " + at[0] + "," + at[1] + "," + (r - l) + "," + (b - t));
        });
        layoutOrb();
        web.loadUrl("file:///android_asset/assist/surface.html#corner");
        return root;
    }

    @Override
    public void onShow(Bundle args, int showFlags) {
        super.onShow(args, showFlags);
        boolean handoff = args != null && args.getBoolean(ARG_HANDOFF, false);
        if (keyguard.isKeyguardLocked() && !handoff) {
            // Locked: the full lock-screen surface owns this moment. The keyguard stays underneath.
            Log.i(TAG, "session: locked, opening the lock-screen surface");
            Intent i = new Intent(getContext(), AssistLockActivity.class)
                    .setAction(Intent.ACTION_ASSIST)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startAssistantActivity(i);
            hide();
            return;
        }
        capture.attach(this);
        ai.wizards.os.SideButton.markUsed(getContext()); // the side button really reached Wizard OS
        Log.i(TAG, "corner shown handoff=" + handoff + " listening=" + capture.listening());
        awake = false;
        syncAwake();
        Log.i(TAG, "shape corner wide=false");
        whenReady(() -> {
            if (handoff) {
                heard = args.getString(ARG_HEARD, "");
                if (capture.listening()) js("W.begin()");
                else if (!heard.isEmpty()) onHeard(heard, 0);
                return;
            }
            // A hold while the orb is already listening sends, like a second tap on the Mac key.
            if (capture.listening()) capture.send("button");
            else if (!capture.busy()) {
                File qa = VoiceCapture.takeQaNext(getContext()); // debug builds only; null in release
                capture.start(qa, qa != null ? VoiceCapture.qaAutoSendMs(getContext(), 2500) : 0);
            }
        });
    }

    @Override
    public void onHide() {
        super.onHide();
        // Dismissed (Back, Home, screen off, another app): what was said is never lost. A take with speech in it
        // is sent exactly as if the pause had ended it, and a message already sending keeps going and toasts
        // when it lands. Only Cancel throws a take away.
        if (capture.listening()) capture.finishOnDismiss("dismiss");
        capture.detach(this);
        capture.noteDismissed();
        delivered = null;
        main.removeCallbacks(closeAfterSend);
        setWide(false);
        syncAwake();
        if (pageReady) js("W.reset&&W.reset()");
        Log.i(TAG, "corner hidden");
    }

    /**
     * Back while the orb is up. Mid-talk: send what was said and step away. After it was sent (sending, or the
     * heard bubble): step away and hand the Back to the app underneath, which is what James was reaching for;
     * the message keeps going and a toast says when it lands. Nothing said is ever lost to Back.
     */
    @Override
    public void onBackPressed() {
        boolean wasListening = capture.listening();
        Log.i(TAG, "back pressed listening=" + wasListening);
        hide(); // onHide sends a live take and keeps a message in flight
        if (!wasListening) {
            ai.wizards.os.everywhere.WizardKeyboardService k = ai.wizards.os.everywhere.WizardKeyboardService.get();
            if (k != null) main.postDelayed(() -> {
                boolean ok = k.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK);
                Log.i(TAG, "back passed to the app underneath ok=" + ok);
            }, 120);
        }
    }

    @Override
    public void onDestroy() {
        capture.detach(this);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** Only the orb (or the heard bubble) takes touches; the rest of the screen belongs to the app. */
    @Override
    public void onComputeInsets(Insets outInsets) {
        super.onComputeInsets(outInsets);
        if (root == null || web == null) return;
        Rect r = new Rect();
        web.getHitRect(r);
        outInsets.contentInsets.top = root.getHeight();
        outInsets.touchableInsets = Insets.TOUCHABLE_INSETS_REGION;
        outInsets.touchableRegion.set(r);
    }

    /* ---------------------------------------------------------------- layout */

    private int dp(int v) { return Math.round(v * getContext().getResources().getDisplayMetrics().density); }

    private void layoutOrb() {
        if (web == null) return;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) web.getLayoutParams();
        if (lp == null) return;
        int screenW = getContext().getResources().getDisplayMetrics().widthPixels;
        lp.width = wide ? Math.min(screenW - dp(MARGIN_DP), dp(BUBBLE_MAX_DP)) : dp(ORB_DP);
        lp.height = dp(ORB_DP);
        lp.gravity = Gravity.BOTTOM | Gravity.END;
        lp.rightMargin = dp(MARGIN_DP) / 2;
        lp.bottomMargin = navInset + dp(MARGIN_DP);
        web.setLayoutParams(lp);
    }

    private void setWide(boolean w) {
        if (wide == w) return;
        wide = w;
        layoutOrb();
        Log.i(TAG, "shape corner wide=" + w);
    }

    /* ---------------------------------------------------------------- capture events */

    private void whenReady(Runnable r) {
        if (pageReady) r.run();
        else pending = r;
    }

    private void js(String code) {
        main.post(() -> {
            if (web != null) web.evaluateJavascript("try{" + code + "}catch(e){console.log('js err '+e)}", null);
        });
    }

    /**
     * The screen never dims or locks while the side-button orb has a live take (talking or paused): the orb's window
     * holds FLAG_KEEP_SCREEN_ON exactly as long as the microphone take is open, and lets go on send/cancel/hide.
     */
    private boolean awake;

    private void syncAwake() {
        boolean on = capture.listening();
        if (on == awake) return;
        awake = on;
        android.view.Window w = getWindow() == null ? null : getWindow().getWindow();
        if (w == null) return;
        if (on) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        Log.i(TAG, "keep screen on " + on);
    }

    private final Runnable closeAfterSend = this::closeIfSent;

    private void closeIfSent() {
        if (!capture.listening()) {
            Log.i(TAG, "sent; corner closes itself");
            hide();
        }
    }

    @Override public void onBegin() { main.removeCallbacks(closeAfterSend); syncAwake(); js("W.begin()"); }

    @Override public void onLevel(float level) { js("W.level(" + level + ")"); }

    @Override public void onNothing() { syncAwake(); js("W.onNothing()"); }

    @Override
    public void onSending(String via) {
        syncAwake();
        js("W.onSending(" + JSONObject.quote(via) + ")");
        // Snappy: it is already saved on the phone and on its way; the orb leaves instead of narrating the trip.
        main.removeCallbacks(closeAfterSend);
        main.postDelayed(closeAfterSend, CLOSE_AFTER_SEND_MS);
    }

    @Override
    public void onHeard(String text, long ms) {
        heard = text;
        js("W.onHeard(" + JSONObject.quote(text) + "," + ms + ")");
    }

    @Override
    public void onError(String kind, String message) {
        syncAwake();
        js("W.onError(" + JSONObject.quote(kind) + "," + JSONObject.quote(message) + ")");
    }

    @Override
    public void onDelivered(String sessionId) {
        delivered = sessionId;
        js("W.onDelivered()");
    }

    @Override public void onQueued(String why) { js("W.onQueued(" + JSONObject.quote(why) + ")"); }

    @Override public void onPaused(boolean p) { syncAwake(); js("W.onPaused(" + p + ")"); }

    private String delivered;

    /** Tap the bubble after it sent: open that thread in Wizard OS (the unsent list if it is still on its way). */
    private void openWizard(String text) {
        Log.i(TAG, "open wizard thread=" + delivered);
        startAssistantActivity(AssistLockActivity.threadIntent(getContext(), delivered));
        hide();
    }

    final class Bridge {
        @JavascriptInterface public void send() { main.post(() -> capture.send("orb")); }

        @JavascriptInterface public void listen() { main.post(() -> capture.start(null, 0)); }

        @JavascriptInterface public void cancel() { main.post(capture::discard); }

        @JavascriptInterface public void pause() { main.post(capture::togglePause); }

        @JavascriptInterface public void unlock() { }

        @JavascriptInterface public boolean locked() { return false; }

        @JavascriptInterface public String items() { return keyguard.isKeyguardLocked() ? "[]" : capture.store().json(); }

        @JavascriptInterface public void openWizard(String text) { main.post(() -> WizardSession.this.openWizard(text)); }

        @JavascriptInterface public void close() { main.post(WizardSession.this::hide); }

        @JavascriptInterface public void log(String s) { Log.i(TAG, "ui: " + s); }

        @JavascriptInterface public void full() { }

        @JavascriptInterface public void corner(boolean w) { main.post(() -> setWide(w)); }

        /** Screen: attach what is on the phone right now to this take (the orb steps out of the picture). */
        @JavascriptInterface public void shot() { main.post(WizardSession.this::screenshot); }

        @JavascriptInterface public int shots() { return capture.shotCount(); }
    }

    /* ---------------------------------------------------------------- Screen */

    private boolean shotPending;

    /**
     * Screen button: hide the orb, capture the app underneath through the accessibility service (the same one the
     * floating orb uses), attach it to the take, show the orb again. Without accessibility it opens the one-step setup.
     */
    private void screenshot() {
        if (!capture.listening() || shotPending) return;
        if (capture.shotCount() >= VoiceCapture.MAX_SHOTS) { js("W.onShot(-2)"); return; }
        if (Build.VERSION.SDK_INT < 30) { js("W.onShot(-3)"); return; }
        ai.wizards.os.everywhere.WizardKeyboardService k = ai.wizards.os.everywhere.WizardKeyboardService.get();
        if (k == null) {
            Log.i(TAG, "screen tapped without accessibility: opening setup");
            Intent i = new Intent(ai.wizards.os.MainActivity.ACTION_ACCESSIBILITY)
                    .setClassName(getContext().getPackageName(), "ai.wizards.os.MainActivity")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startAssistantActivity(i);
            return;
        }
        shotPending = true;
        if (web != null) web.setAlpha(0f);
        Log.i(TAG, "screenshot requested");
        main.postDelayed(() -> k.screenshot(png -> main.post(() -> {
            shotPending = false;
            if (web != null) web.setAlpha(1f);
            boolean ok = capture.addShot(png);
            if (!ok && (png == null || png.length == 0)) Log.w(TAG, "screenshot empty");
            js("W.onShot(" + (ok ? capture.shotCount() : -1) + ")");
        })), 160);
    }

}
