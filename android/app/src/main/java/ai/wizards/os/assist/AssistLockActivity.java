package ai.wizards.os.assist;

import ai.wizards.os.BuildConfig;
import ai.wizards.os.R;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;

/**
 * The Wizard surface. Holding the side button (Android: press-and-hold power = digital assistant)
 * launches this over the real keyguard via showWhenLocked + turnScreenOn. The keyguard is never
 * replaced or bypassed: anything private asks Android's own unlock (PIN / fingerprint) through
 * KeyguardManager.requestDismissKeyguard.
 *
 * Talking: listening starts immediately. Send by tapping the orb, holding the side button again,
 * or pausing. Android never tells an app when the power button is released.
 *
 * Phone locked: this full-screen surface. Phone unlocked: the corner orb ({@link WizardSession},
 * Android's assistant window). Unlocking mid-talk hands the live recording to the corner orb.
 */
public class AssistLockActivity extends Activity implements VoiceCapture.View {
    static final String TAG = "WizardOSAssist";
    private static final String SURFACE = "file:///android_asset/assist/surface.html";

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private KeyguardManager keyguard;
    private VoiceCapture capture;
    private boolean pageReady;
    private boolean handingOff;
    private String lastHeard = "";
    /** The thread the last side-button message landed in (null until Wizard accepts it). */
    private String deliveredSession;
    private boolean pendingBegin;
    private boolean unlockInFlight;
    private final BroadcastReceiver userPresent = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            Log.i(TAG, "user present (unlocked outside the surface); listening=" + capture.listening());
            pushLockState();
            js("W.onUnlocked()");
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setShowWhenLocked(true);
        setTurnScreenOn(true);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        keyguard = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        capture = VoiceCapture.get(this);
        if (Intent.ACTION_ASSIST.equals(getIntent().getAction())) ai.wizards.os.SideButton.markUsed(this);
        capture.attach(this);

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT); // the page paints black itself in FULL
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccess(true); // only file:///android_asset/assist/ is served; everything else is blocked below
        s.setBlockNetworkLoads(true); // the surface is local; only native code talks to Wizard voice
        web.addJavascriptInterface(new Bridge(), "WizardNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true; // the surface never navigates
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("file:///android_asset/assist/")) return null;
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", null,
                        new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                pushLockState();
                if (pendingBegin) {
                    pendingBegin = false;
                    begin();
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, "js: " + m.message());
                return true;
            }
        });
        setContentView(web);
        registerReceiver(userPresent, new IntentFilter(Intent.ACTION_USER_PRESENT));
        pendingBegin = true;
        web.loadUrl(SURFACE);
        Log.i(TAG, "surface created locked=" + keyguard.isKeyguardLocked() + " action=" + action(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Log.i(TAG, "assist again while open; listening=" + capture.listening());
        // Holding the side button again while listening sends, like a second tap on the Mac key.
        if (capture.listening()) stopAndSend("button");
        else begin();
    }

    @Override
    protected void onResume() {
        super.onResume();
        pushLockState();
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Screen off or the user left: the overlay is a moment, not an app. Next hold starts fresh.
        if (!isChangingConfigurations() && !unlockInFlight && !handingOff) {
            Log.i(TAG, "stopped; closing surface");
            discardRecording();
            finish();
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // One Back = one step. The surface closes its list/card first; otherwise Back closes the
        // overlay onto the lock screen, which is the phone's own root. Back never sends anything.
        if (!pageReady) {
            closeSurface();
            return;
        }
        web.evaluateJavascript("(window.W && W.back()) || ''", value -> {
            if (value == null || !value.contains("handled")) closeSurface();
        });
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(userPresent); } catch (IllegalArgumentException ignored) { }
        if (!handingOff) discardRecording();
        capture.detach(this);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ listening */

    private void begin() {
        if (!pageReady) {
            pendingBegin = true;
            return;
        }
        if (capture.listening()) return;
        File qa = qaAudio();
        capture.start(qa, qa != null ? qaAutoSendMs() : 0);
    }

    private void stopAndSend(String via) { capture.send(via); }

    private void discardRecording() { capture.discard(); }

    @Override public void onBegin() { js("W.begin()"); }

    @Override public void onLevel(float level) { js("W.level(" + level + ")"); }

    @Override public void onNothing() { js("W.onNothing()"); }

    @Override public void onSending(String via) { js("W.onSending(" + JSONObject.quote(via) + ")"); }

    @Override
    public void onHeard(String text, long ms) {
        lastHeard = text;
        js("W.onHeard(" + JSONObject.quote(text) + "," + ms + ")");
    }

    @Override
    public void onError(String kind, String message) {
        js("W.onError(" + JSONObject.quote(kind) + "," + JSONObject.quote(message) + ")");
    }

    @Override
    public void onDelivered(String sessionId) {
        deliveredSession = sessionId;
        js("W.onDelivered()");
    }

    @Override public void onQueued(String why) { js("W.onQueued(" + JSONObject.quote(why) + ")"); }

    @Override public void onPaused(boolean p) { js("W.onPaused(" + p + ")"); }

    /**
     * Unlocked while the surface is up: hand the moment to the corner orb (Android's assistant
     * window), keeping a live recording running. The full surface then leaves.
     */
    private void handoffToCorner() {
        if (keyguard.isKeyguardLocked() || handingOff) return;
        Bundle args = new Bundle();
        args.putBoolean(WizardSession.ARG_HANDOFF, true);
        args.putString(WizardSession.ARG_HEARD, capture.listening() ? "" : lastHeard);
        if (WizardVoiceService.showCorner(args)) {
            handingOff = true;
            capture.detach(this);
            Log.i(TAG, "handoff to corner; listening=" + capture.listening());
            finish();
        } else {
            Log.i(TAG, "corner unavailable (Wizard OS is not the assistant); staying full");
        }
    }

    private void closeSurface() {
        discardRecording();
        Log.i(TAG, "surface closed");
        finish();
    }

    /* ------------------------------------------------------------------ keyguard */

    private void pushLockState() {
        if (pageReady) {
            js("W.lockState(" + keyguard.isKeyguardLocked() + ")");
            js("W.setMode('full')");
        }
    }

    private void requestUnlock() {
        if (!keyguard.isKeyguardLocked()) {
            js("W.onUnlocked()");
            return;
        }
        Log.i(TAG, "unlock requested; listening=" + capture.listening());
        unlockInFlight = true;
        keyguard.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
            @Override
            public void onDismissSucceeded() {
                unlockInFlight = false;
                Log.i(TAG, "unlocked; still listening=" + capture.listening());
                js("W.onUnlocked()"); // the page asks for the corner orb unless it is opening the list
            }

            @Override
            public void onDismissCancelled() {
                unlockInFlight = false;
                Log.i(TAG, "unlock cancelled");
                js("W.onUnlockCancelled()");
            }

            @Override
            public void onDismissError() {
                unlockInFlight = false;
                Log.i(TAG, "unlock error");
                js("W.onUnlockCancelled()");
            }
        });
    }

    /** Unlocked only: open the thread it went to (or the unsent list while it is still on its way). */
    private void openWizard(String text) {
        if (keyguard.isKeyguardLocked()) {
            requestUnlock();
            return;
        }
        Log.i(TAG, "open wizard thread=" + deliveredSession);
        startActivity(threadIntent(this, deliveredSession));
        closeSurface();
    }

    /** Wizard OS on the thread a side-button message went to; the unsent list if it hasn't landed yet. */
    static Intent threadIntent(Context c, String sessionId) {
        Intent i = new Intent(sessionId != null ? ai.wizards.os.MainActivity.ACTION_THREAD : ai.wizards.os.MainActivity.ACTION_UNSENT)
                .setClassName(c.getPackageName(), "ai.wizards.os.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (sessionId != null) i.putExtra(ai.wizards.os.MainActivity.EXTRA_THREAD, sessionId);
        return i;
    }

    /**
     * Opens Wizard OS with the words as a draft (ai.wizards.os.action.SAY). Wizard OS shows the
     * draft and James sends it with one tap; nothing is ever sent from here.
     */
    static Intent sayIntent(Context c, String text) {
        Intent i = new Intent("ai.wizards.os.action.SAY")
                .setClassName(c.getPackageName(), "ai.wizards.os.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (text != null && !text.trim().isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text.trim());
        return i;
    }

    /* ------------------------------------------------------------------ bridge */

    private void js(String code) {
        main.post(() -> {
            if (web != null) web.evaluateJavascript("try{" + code + "}catch(e){console.log('js err '+e)}", null);
        });
    }

    final class Bridge {
        @JavascriptInterface
        public void send() { main.post(() -> stopAndSend("orb")); }

        @JavascriptInterface
        public void listen() { main.post(AssistLockActivity.this::begin); }

        @JavascriptInterface
        public void cancel() { main.post(AssistLockActivity.this::discardRecording); }

        @JavascriptInterface
        public void pause() { main.post(capture::togglePause); }

        @JavascriptInterface
        public void unlock() { main.post(AssistLockActivity.this::requestUnlock); }

        @JavascriptInterface
        public boolean locked() { return keyguard.isKeyguardLocked(); }

        /** Private: only returned once the real keyguard is dismissed. */
        @JavascriptInterface
        public String items() { return keyguard.isKeyguardLocked() ? "[]" : capture.store().json(); }

        @JavascriptInterface
        public void openWizard(String text) { main.post(() -> AssistLockActivity.this.openWizard(text)); }

        @JavascriptInterface
        public void close() { main.post(AssistLockActivity.this::closeSurface); }

        @JavascriptInterface
        public void log(String s) { Log.i(TAG, "ui: " + s); }

        /** The surface is always full screen; the corner orb is the assistant session. */
        @JavascriptInterface
        public void full() { }

        /** Unlocked: move to the corner orb. */
        @JavascriptInterface
        public void corner(boolean wide) { main.post(AssistLockActivity.this::handoffToCorner); }
    }

    /* ------------------------------------------------------------------ debug-only QA hooks */

    private File qaAudio() {
        if (!BuildConfig.DEBUG || getIntent() == null) return null;
        String name = getIntent().getStringExtra("qa_audio");
        if (name == null || name.contains("/")) return null;
        File f = new File(getFilesDir(), name);
        return f.isFile() ? f : null;
    }

    private long qaAutoSendMs() {
        if (!BuildConfig.DEBUG || getIntent() == null) return 0;
        return getIntent().getLongExtra("qa_autosend_ms", 0);
    }

    private static String action(Intent i) {
        return i == null ? "none" : String.valueOf(i.getAction());
    }
}
