package ai.wizards.os.assist;

import ai.wizards.os.OverlayPage;
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
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONObject;

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
        web.addJavascriptInterface(new Bridge(), "WizardNative");
        // Bundled copy only, network blocked, as before: over the lock screen the surface must appear at once and
        // work with no connection, so it never waits on the Wizard (OverlayPage remoteFirst=false).
        OverlayPage surface = new OverlayPage("surface.html", false) {
            @Override
            protected void ready(WebView view, String url) {
                pageReady = true;
                pushLockState();
                if (pendingBegin) {
                    pendingBegin = false;
                    begin();
                }
            }
        };
        web.setWebViewClient(surface);
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
        surface.load(web);
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
        ai.wizards.os.everywhere.EverywhereService.setSurfaceInFront(this, true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        ai.wizards.os.everywhere.EverywhereService.setSurfaceInFront(this, false);
    }

    @Override
    protected void onStop() {
        super.onStop();
        // Screen off or the user left: the overlay is a moment, not an app. Next hold starts fresh.
        if (!isChangingConfigurations() && !unlockInFlight && !handingOff) {
            Log.i(TAG, "stopped; closing surface");
            capture.finishOnDismiss("dismiss"); // anything said still goes; an empty take is dropped
            finish();
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Back never ends a take or closes the surface (James, 10 Oct 2026): only the X cancels. The one thing Back
        // still does is close the private list if it is open (a step inside the surface, not an exit).
        if (!pageReady) { Log.i(TAG, "back ignored (page loading)"); return; }
        web.evaluateJavascript("(window.W && W.back()) || ''", value -> {
            if (value == null || !value.contains("handled"))
                Log.i(TAG, "back ignored listening=" + capture.listening());
        });
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(closeAfterSend);
        try { unregisterReceiver(userPresent); } catch (IllegalArgumentException ignored) { }
        if (!handingOff) capture.finishOnDismiss("dismiss");
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

    private void discardRecording() { capture.cancelByUser(); }

    @Override public void onBegin() { main.removeCallbacks(closeAfterSend); js("W.begin()"); }

    @Override public void onLevel(float level) { js("W.level(" + level + ")"); }

    @Override public void onNothing() { js("W.onNothing()"); }

    /** After sending, the lock-screen surface shows its "sent" pulse and returns to the lock screen (no lingering card). */
    static final long CLOSE_AFTER_SEND_MS = 650;
    private final Runnable closeAfterSend = () -> {
        if (!capture.listening() && !isFinishing() && !handingOff) {
            Log.i(TAG, "sent; surface closes itself");
            closeSurface();
        }
    };

    @Override
    public void onSending(String via) {
        js("W.onSending(" + JSONObject.quote(via) + ")");
        main.removeCallbacks(closeAfterSend);
        main.postDelayed(closeAfterSend, CLOSE_AFTER_SEND_MS);
    }

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

    /** Back / close: anything said is sent (never lost), an empty take is dropped. Cancel is the only discard. */
    private void closeSurface() {
        capture.finishOnDismiss("dismiss");
        capture.detach(this);
        capture.noteDismissed();
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
