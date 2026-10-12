package ai.wizards.os;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

/**
 * Wizard OS: a native home for James's private Wizard OS shell (wizard.tailc0f369.ts.net/wizard-os-home/; the retired private.wizard001.com still opens).
 *
 * Rules this activity enforces:
 *  - Back never exits. Every Back is handed to the shell (window.__wosNativeBack), which closes the top
 *    overlay, leaves a thread/full-screen window, then returns to Home and stays there.
 *  - Only the private origin loads inside the app; any other link opens in the phone's browser.
 *  - The microphone is granted to the private origin only, after Android's own permission prompt.
 */
public class MainActivity extends Activity {
    static final String UA_TAG = " WizardOS-Android/" + BuildConfig.VERSION_NAME;
    private static final int REQ_MIC = 41;
    private static final int REQ_FILE = 42;
    private static final int REQ_SIDE_MIC = 43;

    static final String ACTION_LISTEN = "ai.wizards.os.action.LISTEN";
    static final String ACTION_SAY = "ai.wizards.os.action.SAY";
    /** Opens Wizard OS on the side-button switch (Android's assistant settings gear lands here). */
    public static final String ACTION_SIDE_BUTTON = "ai.wizards.os.action.SIDE_BUTTON";
    /** Notifications and the Everywhere button open Wizard OS on Settings / the Unsent list / a thread. */
    public static final String ACTION_SETTINGS = "ai.wizards.os.action.SETTINGS";
    public static final String ACTION_UNSENT = "ai.wizards.os.action.UNSENT";
    public static final String ACTION_THREAD = "ai.wizards.os.action.THREAD";
    /** The floating orb's Screen button (voice typing / screenshots not set up yet) opens the setup dialog. */
    public static final String ACTION_ACCESSIBILITY = "ai.wizards.os.action.ACCESSIBILITY";
    public static final String EXTRA_THREAD = "ai.wizards.os.extra.THREAD";
    /** Usuals (re-ordering Grab food) hands back to Wizard OS on its panel after teaching or cancelling. */
    public static final String ACTION_USUALS = "ai.wizards.os.action.USUALS";
    private static final int REQ_EVERYWHERE = 44;
    private static java.lang.ref.WeakReference<MainActivity> current = new java.lang.ref.WeakReference<>(null);
    private boolean everywhereSetup; // James is on Android's "Display over other apps" page
    private boolean sideSetupActive; // the user tapped Turn on and is in the system picker
    private boolean a11ySetup;       // James is on Android's Accessibility / App info page for voice typing
    private android.app.AlertDialog a11yDialog;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private String pendingHandoff; // JSON handed to window.__wosHandoff once the shell is ready
    private int handoffTries;
    private WebView web;
    private FrameLayout root;
    private PermissionRequest pendingMic;
    private ValueCallback<Uri[]> pendingFiles;
    /** The native "can't reach your Wizard" screen over the WebView (ReachScreen / ReachPolicy). */
    private ReachScreen reach;
    private volatile boolean mainFailed; // this main-frame load failed: its error page must not count as "landed"
    private volatile String wantUrl;     // the page the last main-frame load was for (Try again reloads it)
    private boolean resumed;
    private android.net.ConnectivityManager.NetworkCallback netWatch;
    /** Native-parity features (background recorder, share, reply notifications, in-app update): device/DeviceBridge. */
    private ai.wizards.os.device.DeviceBridge device;
    private ai.wizards.os.mizel.MizelBridge mizel; // window.wizardMizelPort, private origin only
    private ai.wizards.os.apps.AppsBridge apps; // window.wizardAppsPort: the shell only (Android Apps relay)

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(5, 3, 12));
        // targetSdk 35 draws edge to edge. The page itself runs under the status bar so its background reaches the
        // top of the glass (James, 10 Oct: "like Telegram"); the shell keeps its content clear of the bar with the
        // inset it is told (--nat-t). Only the side cutouts, the navigation bar and the keyboard still pad the view.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                // Immersive full screen: the bars are hidden and only the keyboard pushes the shell up.
                int types = immersive ? WindowInsets.Type.ime()
                        : WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout();
                android.graphics.Insets i = insets.getInsets(types);
                int cut = insets.getInsets(WindowInsets.Type.displayCutout()).top;
                reportCutout(cut);
                reportTop(immersive ? 0 : Math.max(cut, insets.getInsets(WindowInsets.Type.statusBars()).top));
                v.setPadding(i.left, 0, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            }
            return insets; // API 28-29 do not draw edge to edge; the system already keeps content clear
        });
        // Let the window extend into the camera cutout; the insets listener decides when content actually goes there.
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        getWindow().setAttributes(lp);
        setContentView(root);
        buildWebView();
        reach = new ReachScreen(this, root, this::retryReach, this::openTailscale);
        watchNetwork();
        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) go(startUrl(getIntent()));
        installBack();
        ai.wizards.os.everywhere.EverywhereService.setAppVoiceRemote(cmd -> main.post(() -> {
            if (web != null) web.evaluateJavascript("(window.__wosVoiceCmd && window.__wosVoiceCmd(" + Handoff.quote(cmd) + "))", null);
        }));
        if (ACTION_ACCESSIBILITY.equals(getIntent().getAction())) { getIntent().setAction(Intent.ACTION_MAIN); main.post(() -> offerAccessibility(true)); }
        queueHandoff(getIntent());
        device.onIntent(getIntent());
    }

    private void buildWebView() {
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true); // QA build only
        web = new SelectionWebView(this); // its own text-selection menu in chats (SelectionWebView)
        web.setBackgroundColor(Color.rgb(5, 3, 12));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (reach != null) reach.toFront(); // a rebuilt WebView goes under the connection screen
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + UA_TAG);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(new Bridge(), "WizardOSNative");
        device = new ai.wizards.os.device.DeviceBridge(this, web);
        web.addJavascriptInterface(device, "WizardOSDevice");
        if (mizel != null) mizel.detach();
        mizel = ai.wizards.os.mizel.MizelBridge.install(web, BuildConfig.ORIGIN);
        if (apps != null) apps.detach();
        apps = ai.wizards.os.apps.AppsBridge.install(this, web);

        // A WebView cannot save files. Anything it is asked to download (an APK, a PDF, an export) goes to
        // Android's download manager, so the file lands in Downloads with a notification you can tap to open or install.
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> downloadOutside(url, userAgent, disposition, mime));
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                // A main-frame hop to the retired private.wizard001.com lands on the same page under this Wizard's own name.
                if (req.isForMainFrame() && Origin.isLegacy(u) && !carrying && !ai.wizards.os.device.AppState.legacyFallback) { go(Origin.toHome(u.toString())); return true; }
                // Under the safety net the tailnet name is unreachable: its links open the same page on the old name.
                if (req.isForMainFrame() && Origin.isHome(u) && ai.wizards.os.device.AppState.legacyFallback) { go(Origin.toLegacy(u.toString())); return true; }
                if (carrying && Carry.isPage(MainActivity.this, u.toString())) { if (req.isForMainFrame()) navStarted(u.toString()); return false; }
                if (Origin.isPrivate(u) || ai.wizards.os.device.AppState.isQaPage(MainActivity.this, u)) { if (req.isForMainFrame()) navStarted(u.toString()); return false; }
                if (!req.isForMainFrame()) return false; // hosted app frames stay inside their window
                openOutside(u);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                // A load replaced by a newer one (Try again over a hanging attempt) is not a failure of the new one.
                if (req.isForMainFrame() && err.getErrorCode() == ERROR_UNKNOWN && String.valueOf(err.getDescription()).contains("ERR_ABORTED")) return;
                if (req.isForMainFrame() && carrying) { endCarry("unreachable"); return; } // old name gone: just go home
                // Safety net: the tailnet name unreachable from this phone → same page on the old name for this run.
                // (A failing old-name page is not isHome, so this cannot loop; both failing ends on the offline page.)
                if (req.isForMainFrame() && Origin.isHome(req.getUrl()) && ai.wizards.os.device.AppState.useLegacy(MainActivity.this)) {
                    mainFailed = true;
                    go(Origin.toLegacy(req.getUrl().toString()));
                    return;
                }
                if (req.isForMainFrame()) { mainFailed = true; showOffline(String.valueOf(err.getDescription())); }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest req, android.webkit.WebResourceResponse resp) {
                // The gateway answered but the Wizard behind it didn't (502 while it restarts): same screen, it retries.
                if (!req.isForMainFrame() || resp == null || !ReachPolicy.httpFailure(resp.getStatusCode())) return;
                mainFailed = true;
                showOffline("Wizard answered " + resp.getStatusCode());
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                // Reloads and anything else not started by go() or a link: watch it too (not reached when a service
                // worker answers the page, hence go() and shouldOverrideUrlLoading). Never intercepts anything.
                if (req.isForMainFrame()) {
                    final String u = req.getUrl().toString();
                    if (!u.equals(wantUrl)) { wantUrl = u; mainFailed = false; main.post(MainActivity.this::armReach); }
                }
                return null;
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                // A commit (also a same-document hop). Never fires for a load that was abandoned or still hangs.
                if (isWeb(url) && !mainFailed && sameHost(url, wantUrl) && reach != null && reach.isShowing() && !reach.isOffline()) landed();
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                // A real page painted: the connection screen leaves by itself (also after Tailscale comes back).
                // Same host as the load we're waiting on, so a late paint of an abandoned attempt can't count.
                if (isWeb(url) && !mainFailed && sameHost(url, wantUrl)) landed();
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageUrl = url;
                setKeepAwake(false);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Back must never land on the one-time carry page: drop it from history once the shell is up.
                if (clearAfterCarry && !carrying && !Carry.isPage(MainActivity.this, url)) { clearAfterCarry = false; view.clearHistory(); }
                topSent = -1; cutoutSent = -1; reportTop(topPx); reportCutout(cutoutPx); // a reload starts fresh: push both again
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Never let a renderer crash take the app down: rebuild the WebView and go home.
                root.removeView(web);
                web.destroy();
                buildWebView();
                go(BuildConfig.HOME_URL);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermission(request));
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = cb;
                try {
                    Intent pick = params.createIntent();
                    pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(pick, REQ_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    return false;
                }
            }
        });
    }

    /* ---------------- Back: always a step inside Wizard OS, never an exit ---------------- */

    private void installBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack(); // API < 33; never calls super, so Back can never finish the activity
    }

    void handleBack() {
        if (reach != null && reach.isOffline()) { retryReach(); return; } // Back on the connection screen: try again, stay
        web.evaluateJavascript("(window.__wosNativeBack ? window.__wosNativeBack() : 'nojs')", result -> {
            String r = result == null ? "" : result.replace("\"", "");
            if (!r.equals("nojs") && !r.isEmpty() && !r.equals("null")) return; // the shell handled it
            // The shell is not loaded (or is a page off the shell): step back in the WebView, else go home.
            String url = web.getUrl();
            if (web.canGoBack()) web.goBack();
            else if (url == null || !url.startsWith(ai.wizards.os.device.AppState.homeUrl(this))) go(ai.wizards.os.device.AppState.homeUrl(this));
            else Toast.makeText(this, "You're home", Toast.LENGTH_SHORT).show();
        });
    }

    /* ---------------- Links, intents, errors ---------------- */

    String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        String target = data != null && Origin.isInApp(data) ? inAppUrl(data.toString()) : null;
        // First launch after the move to the tailnet name: bring the phone's drafts/unsent/seen state across, then go on.
        if (Carry.pending(this)) {
            Carry.attempt(this);
            carrying = true;
            carryNext = target;
            main.postDelayed(carryTimeout, Carry.TIMEOUT_MS);
            return Carry.pageUrl(this);
        }
        if (target != null) return target;
        return ai.wizards.os.device.AppState.homeUrl(this); // HOME_URL; QA builds may point at a fake Wizard
    }

    /** An in-app link on whichever name this run uses (the tailnet name, or the old one under the safety net). */
    static String inAppUrl(String url) {
        return ai.wizards.os.device.AppState.legacyFallback ? Origin.toLegacy(url) : Origin.toHome(url);
    }

    /* ---------------- Carry: move local state off the retired private.wizard001.com (see Carry) ---------------- */

    private volatile boolean carrying;
    private volatile String pageUrl;
    private String carryNext;
    private boolean clearAfterCarry;
    private final Runnable carryTimeout = () -> endCarry("timeout");

    void endCarry(String why) {
        if (!carrying) return;
        carrying = false;
        main.removeCallbacks(carryTimeout);
        android.util.Log.i("WizardOSCarry", "carry " + why);
        String next = carryNext != null ? carryNext : ai.wizards.os.device.AppState.homeUrl(this);
        carryNext = null;
        clearAfterCarry = true;
        if (web != null) go(next);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (data != null && Origin.isInApp(data)) {
            if (carrying) carryNext = inAppUrl(data.toString());
            else go(inAppUrl(data.toString()));
        }
        if (ACTION_ACCESSIBILITY.equals(intent.getAction())) { intent.setAction(Intent.ACTION_MAIN); main.post(() -> offerAccessibility(true)); return; }
        queueHandoff(intent);
        device.onIntent(intent);
    }

    /* ---------------- Assistant handoff (the side-key app opens Wizard OS) ----------------
     * LISTEN opens the orb listening. SAY carries words (EXTRA_TEXT) that appear as a draft James sends with one
     * tap; nothing is ever sent on another app's behalf. */
    void queueHandoff(Intent intent) {
        if (intent == null) return;
        String act = intent.getAction();
        String json = ACTION_SIDE_BUTTON.equals(act) ? "{\"action\":\"side-button\"}"
                : ACTION_SETTINGS.equals(act) ? "{\"action\":\"settings\"}"
                : ACTION_UNSENT.equals(act) ? "{\"action\":\"unsent\"}"
                : ACTION_USUALS.equals(act) ? "{\"action\":\"usuals\"}"
                : ACTION_THREAD.equals(act) && intent.getStringExtra(EXTRA_THREAD) != null
                    ? "{\"action\":\"thread\",\"id\":" + Handoff.quote(intent.getStringExtra(EXTRA_THREAD)) + "}"
                : Handoff.json(act, intent.getStringExtra(Intent.EXTRA_TEXT));
        if (json == null) return;
        intent.setAction(Intent.ACTION_MAIN); // a handoff runs once, not again on rotation/restore
        pendingHandoff = json;
        handoffTries = 0;
        main.removeCallbacks(deliverHandoff);
        main.post(deliverHandoff);
    }

    private final Runnable deliverHandoff = new Runnable() {
        @Override
        public void run() {
            if (pendingHandoff == null || web == null) return;
            final String json = pendingHandoff;
            web.evaluateJavascript("(window.__wosHandoff ? window.__wosHandoff(" + json + ") : false)", r -> {
                if ("true".equals(r)) { if (json.equals(pendingHandoff)) pendingHandoff = null; return; }
                if (++handoffTries < 60) main.postDelayed(this, 300); // shell still loading: retry for ~18 s
                else pendingHandoff = null;
            });
        }
    };

    private void downloadOutside(String url, String userAgent, String disposition, String mime) {
        Uri u = Uri.parse(url);
        if (!"https".equals(u.getScheme()) && !"http".equals(u.getScheme())) { openOutside(u); return; }
        try {
            String name = android.webkit.URLUtil.guessFileName(url, disposition, mime);
            android.app.DownloadManager.Request r = new android.app.DownloadManager.Request(u)
                    .setMimeType(mime)
                    .setTitle(name)
                    .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, name);
            if (userAgent != null) r.addRequestHeader("User-Agent", userAgent);
            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (cookie != null) r.addRequestHeader("Cookie", cookie);
            ((android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Downloading " + name + " · it'll be in Downloads", Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            openOutside(u); // no download manager / storage refused: let the browser fetch it
        }
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open that link", Toast.LENGTH_SHORT).show();
        }
    }

    /* ---------------- Can't reach your Wizard (James, 12 Oct: Tailscale off gave a pure black screen) ----------------
     * Every main-frame load arms two marks. A page that paints (onPageCommitVisible) disarms them and hides the screen.
     * CONNECTING_MS: no network or Tailscale off → say why now; else "Connecting to your Wizard…".
     * GIVE_UP_MS or a load error / 5xx: the offline screen. The load keeps going underneath; the app retries on
     * return to the app, on a network change (Tailscale turning on), and every RETRY_MS while in front. */

    static boolean isWeb(String url) {
        return url != null && (url.startsWith("https://") || url.startsWith("http://"));
    }

    static String noFragment(String u) {
        int i = u.indexOf('#');
        return i < 0 ? u : u.substring(0, i);
    }

    static boolean sameHost(String a, String b) {
        if (a == null || b == null) return false;
        String ha = Uri.parse(a).getHost(), hb = Uri.parse(b).getHost();
        return ha != null && ha.equalsIgnoreCase(hb);
    }

    private final Runnable reachMark = () -> {
        if (reach == null) return;
        boolean[] n = ReachScreen.net(this);
        if (!carrying && ReachPolicy.failNow(n[0], n[1])) showOffline(null);
        else reach.connecting();
    };

    private final Runnable reachGiveUp = () -> { if (!carrying) showOffline(null); };

    private final Runnable reachRetry = new Runnable() {
        @Override
        public void run() {
            main.removeCallbacks(this);
            if (reach == null || !reach.isOffline() || !resumed) return;
            retryReach();
        }
    };

    /** Every native page load. onPageStarted only fires once a response commits, so a connection that never answers
     *  (Tailscale off) never reaches it: the connection screen is armed here, before the network. */
    void go(String url) {
        navStarted(url);
        web.loadUrl(url);
    }

    /** A main-frame load is leaving for the network: watch it until a page paints. */
    void navStarted(String url) {
        if (!isWeb(url)) return;
        String now = pageUrl;
        if (now != null && url.contains("#") && noFragment(url).equals(noFragment(now))) return; // same page, a #hop
        mainFailed = false;
        wantUrl = url;
        armReach();
    }

    void armReach() {
        if (mainFailed) return; // this load already failed fast (its screen is up)
        main.removeCallbacks(reachMark);
        main.removeCallbacks(reachGiveUp);
        main.postDelayed(reachMark, ReachPolicy.CONNECTING_MS);
        main.postDelayed(reachGiveUp, ReachPolicy.GIVE_UP_MS);
    }

    void landed() {
        main.removeCallbacks(reachMark);
        main.removeCallbacks(reachGiveUp);
        main.removeCallbacks(reachRetry);
        if (reach != null && reach.isShowing()) android.util.Log.i("WizardOSReach", "reached " + pageUrl);
        if (reach != null) reach.hide();
    }

    private void showOffline(String why) {
        main.removeCallbacks(reachMark);
        main.removeCallbacks(reachGiveUp);
        ai.wizards.os.device.AppState.legacyFallback = false; // Try again goes to the tailnet name first again
        if (reach == null) return;
        ReachPolicy.Why w = ReachScreen.why(this);
        reach.offline(w, why, ReachScreen.tailscaleInstalled(this));
        android.util.Log.i("WizardOSReach", "offline " + w + " " + why);
        main.removeCallbacks(reachRetry);
        if (resumed) main.postDelayed(reachRetry, ReachPolicy.RETRY_MS);
    }

    /** Try the page again with the explanation still up; it leaves only when a page paints. */
    void retryReach() {
        if (web == null || reach == null) return;
        reach.trying();
        ai.wizards.os.device.AppState.legacyFallback = false;
        String u = wantUrl;
        if (!isWeb(u) || Carry.isPage(this, u)) u = ai.wizards.os.device.AppState.homeUrl(this);
        else if (Origin.isLegacy(Uri.parse(u))) u = Origin.toHome(u);
        android.util.Log.i("WizardOSReach", "retry " + u);
        go(u);
        main.removeCallbacks(reachRetry);
        if (resumed) main.postDelayed(reachRetry, ReachPolicy.RETRY_MS);
    }

    void openTailscale() {
        android.content.Intent i = getPackageManager().getLaunchIntentForPackage(ReachPolicy.TAILSCALE_PKG);
        if (i == null) { Toast.makeText(this, "Tailscale isn't installed on this phone", Toast.LENGTH_SHORT).show(); return; }
        startActivity(i); // coming back (onResume) tries again
    }

    /** Tailscale turning on (or the network coming back) retries at once instead of waiting for the next tick. */
    private void watchNetwork() {
        try {
            android.net.ConnectivityManager cm = getSystemService(android.net.ConnectivityManager.class);
            if (cm == null) return;
            netWatch = new android.net.ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(android.net.Network n) { main.post(MainActivity.this::netChanged); }
                @Override public void onLost(android.net.Network n) { main.post(MainActivity.this::netChanged); }
                @Override public void onCapabilitiesChanged(android.net.Network n, android.net.NetworkCapabilities c) { main.post(MainActivity.this::netChanged); }
            };
            cm.registerDefaultNetworkCallback(netWatch);
        } catch (RuntimeException e) { netWatch = null; }
    }

    private final Runnable netSettled = () -> {
        if (reach == null || !reach.isOffline()) return;
        ReachPolicy.Why now = ReachScreen.why(this);
        if (ReachPolicy.retryOnChange(reach.shown(), now)) { if (resumed) retryReach(); }
        else if (now != reach.shown()) reach.offline(now, null, ReachScreen.tailscaleInstalled(this));
    };

    void netChanged() {
        if (reach == null || !reach.isOffline()) return;
        main.removeCallbacks(netSettled);
        main.postDelayed(netSettled, ReachPolicy.NET_SETTLE_MS);
    }

    /* ---------------- Microphone for the orb ---------------- */

    private void handleWebPermission(PermissionRequest request) {
        if (!Origin.isPrivate(request.getOrigin())) { request.deny(); return; }
        boolean wantsMic = false;
        for (String r : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
        if (!wantsMic) { request.deny(); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            if (pendingMic != null) pendingMic.deny();
            pendingMic = request;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_EVERYWHERE) { continueEverywhere(); return; }
        if (code == REQ_SIDE_MIC) {
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) continueSideButton();
            else { Toast.makeText(this, "The side button needs the microphone", Toast.LENGTH_LONG).show(); pushSideButton(); }
            return;
        }
        if (code != REQ_MIC || pendingMic == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            pendingMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pendingMic.deny();
            Toast.makeText(this, "Wizard OS needs the microphone for the orb", Toast.LENGTH_LONG).show();
        }
        pendingMic = null;
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE || pendingFiles == null) return;
        pendingFiles.onReceiveValue(pickedUris(result, data));
        pendingFiles = null;
    }

    /* A multi-pick comes back as ClipData; FileChooserParams.parseResult only reads getData(), so it dropped
     * every file but one. Read every ClipData item, then fall back to the single result. */
    static Uri[] pickedUris(int result, Intent data) {
        if (result != Activity.RESULT_OK || data == null) return null;
        java.util.ArrayList<Uri> out = new java.util.ArrayList<>();
        android.content.ClipData clip = data.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) { Uri u = clip.getItemAt(i).getUri(); if (u != null && !out.contains(u)) out.add(u); }
        if (out.isEmpty() && data.getData() != null) out.add(data.getData());
        if (out.isEmpty()) return WebChromeClient.FileChooserParams.parseResult(result, data);
        return out.toArray(new Uri[0]);
    }

    /* ---------------- Lifecycle ---------------- */

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onStart() {
        super.onStart();
        current = new java.lang.ref.WeakReference<>(this);
        ai.wizards.os.everywhere.EverywhereService.setAppInFront(this, true); // the floating button hides while Wizard OS is open
        ai.wizards.os.everywhere.EverywhereOutbox.get(this).pump();
        device.onStart();
        ai.wizards.os.mizel.MeetingRecorderService.recover(this); // a meeting cut off by a process death is closed and uploaded
    }

    @Override
    protected void onStop() {
        device.onStop();
        ai.wizards.os.everywhere.EverywhereService.setAppInFront(this, false); // …and comes back when James leaves
        super.onStop();
    }

    private boolean immersive;
    /** Sticky immersive: the system bars hide, a swipe from the edge shows them briefly over the app. */
    @SuppressWarnings("deprecation")
    void applyImmersive(boolean on) {
        boolean changed = immersive != on;
        immersive = on;
        if (changed && root != null) root.requestApplyInsets(); // re-pad: edge to edge in, clear of the bars out
        if (Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (on) {
                c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.systemBars());
            } else c.show(WindowInsets.Type.systemBars());
        } else {
            View d = getWindow().getDecorView();
            d.setSystemUiVisibility(on ? (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) : 0);
        }
    }

    private volatile int cutoutCss = 0;
    private int cutoutSent = -1;
    /** The camera cutout height in CSS px, so full-screen pages can keep small top controls clear of it.
     *  Pushed on change; the page also reads it with WizardOSNative.cutoutTop() when it boots. */
    private int cutoutPx = 0;
    private void reportCutout(int px) {
        cutoutPx = px;
        cutoutCss = Math.round(px / getResources().getDisplayMetrics().density);
        if (cutoutCss == cutoutSent || web == null) return;
        cutoutSent = cutoutCss;
        web.evaluateJavascript("(window.__wosCutout && window.__wosCutout(" + cutoutCss + "))", null);
    }

    private volatile int topCss = 0;
    private int topSent = -1;
    /** Status bar (or camera, whichever is taller) height in CSS px the shell keeps its content below; 0 in immersive. */
    private int topPx = 0;
    private void reportTop(int px) {
        topPx = px;
        topCss = Math.round(px / getResources().getDisplayMetrics().density);
        if (topCss == topSent || web == null) return;
        topSent = topCss;
        web.evaluateJavascript("(window.__wosTop && window.__wosTop(" + topCss + "))", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && immersive) applyImmersive(true); // a dialog or the shade can bring the bars back
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        resumed = true;
        if (reach != null && reach.isOffline()) main.postDelayed(this::retryReach, 300); // back from Tailscale: try now
        if (everywhereSetup) {
            everywhereSetup = false;
            boolean ok = ai.wizards.os.everywhere.EverywhereService.overlayAllowed(this);
            if (ok) ai.wizards.os.everywhere.EverywhereService.ensureRunning(this);
            Toast.makeText(this, ok ? "Wizard Everywhere is on. It shows when you leave Wizard OS." : "Wizard Everywhere needs “Display over other apps”", Toast.LENGTH_LONG).show();
            if (ok) main.postDelayed(() -> offerAccessibility(true), 350);
        }
        if (a11ySetup) { a11ySetup = false; main.postDelayed(() -> offerAccessibility(false), 350); }
        pushEverywhere();
        web.evaluateJavascript("window.dispatchEvent(new Event('wos-native-resume'))", null);
        pushSideButton();
        web.evaluateJavascript("(window.__wosUsuals && window.__wosUsuals())", null);
        device.onResume();
        if (apps != null) apps.onResume();
        if (sideSetupActive) {
            sideSetupActive = false;
            if (SideButton.assistant(this)) Toast.makeText(this, "Side button is on. Hold it to talk.", Toast.LENGTH_SHORT).show();
        }
    }

    /* ---------------- Side button switch ----------------
     * One tap in Wizard OS: ask for the mic in place, then land on the one system page Android keeps for itself
     * (the assistant pick). Coming back, the shell is told the new state and the switch updates on its own. */
    void pushSideButton() {
        if (web == null) return;
        web.evaluateJavascript("(window.__wosSideButton && window.__wosSideButton(" + SideButton.status(this) + "))", null);
    }

    void startSideButton() {
        if (!SideButton.mic(this)) { requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_SIDE_MIC); return; }
        continueSideButton();
    }

    private void continueSideButton() {
        if (!SideButton.assistant(this)) {
            sideSetupActive = true;
            if (SideButton.openAssistantPage(this)) {
                Toast.makeText(this, "Pick Wizard OS, then come back", Toast.LENGTH_LONG).show();
                return;
            }
            sideSetupActive = false;
            Toast.makeText(this, "This phone has no assistant setting", Toast.LENGTH_LONG).show();
        } else if (!SideButton.openSideKeyPage(this)) {
            Toast.makeText(this, "Wizard OS is your assistant. Hold the side button to talk.", Toast.LENGTH_LONG).show();
        }
        pushSideButton();
    }

    @Override
    protected void onPause() {
        // Mid-recording the page must keep running in the background (the floating orb can send/pause/cancel it).
        if (!ai.wizards.os.everywhere.EverywhereService.appIsRecording()) web.onPause();
        CookieManager.getInstance().flush();
        resumed = false;
        main.removeCallbacks(reachRetry);
        super.onPause();
    }

    /* ---------------- Wizard Everywhere (the floating button, formerly Archimedes Anywhere) ---------------- */

    /** Called by the native outbox on any change, so Settings / the Inbox update while open. */
    public static void notifyUnsentChanged() {
        MainActivity a = current.get();
        if (a == null || a.web == null) return;
        a.main.post(() -> a.web.evaluateJavascript("(window.__wosUnsent && window.__wosUnsent())", null));
    }

    void pushEverywhere() {
        if (web != null) web.evaluateJavascript("(window.__wosEverywhere && window.__wosEverywhere())", null);
    }

    /** Switch on: ask for the mic and notifications in place, then Android's overlay page if needed. */
    void startEverywhere() {
        ai.wizards.os.everywhere.EverywhereService.setEnabled(this, true);
        java.util.List<String> need = new java.util.ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!need.isEmpty()) { requestPermissions(need.toArray(new String[0]), REQ_EVERYWHERE); return; }
        continueEverywhere();
    }

    private void continueEverywhere() {
        if (!ai.wizards.os.everywhere.EverywhereService.overlayAllowed(this)) {
            everywhereSetup = true;
            try {
                startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
                Toast.makeText(this, "Turn on “Allow display over other apps”, then come back", Toast.LENGTH_LONG).show();
            } catch (ActivityNotFoundException e) {
                everywhereSetup = false;
                Toast.makeText(this, "This phone has no overlay setting", Toast.LENGTH_LONG).show();
            }
        } else {
            ai.wizards.os.everywhere.EverywhereService.ensureRunning(this);
            Toast.makeText(this, "Wizard Everywhere is on. It shows when you leave Wizard OS.", Toast.LENGTH_LONG).show();
            offerAccessibility(true);
        }
        pushEverywhere();
    }

    /* ---------------- Voice typing & screenshots (Accessibility → Wizard OS) ----------------
     * One dialog, one button, the next step only. Sideloaded on Android 13+, the switch is greyed out as a
     * "Restricted setting": the dialog walks through tap-the-grey-row-once → App info ⋮ → Allow restricted settings
     * → switch on, re-checking each time James comes back. */
    void offerAccessibility(boolean firstAsk) {
        if (isFinishing() || isDestroyed()) return;
        if (a11yDialog != null && a11yDialog.isShowing()) a11yDialog.dismiss();
        ai.wizards.os.everywhere.AccessibilitySetup.Step step = ai.wizards.os.everywhere.AccessibilitySetup.step(this);
        android.util.Log.i("WizardOS", "accessibility setup step=" + step + " first=" + firstAsk);
        pushEverywhere();
        if (step == ai.wizards.os.everywhere.AccessibilitySetup.Step.DONE) {
            if (!firstAsk) Toast.makeText(this, "Voice typing & screenshots are on", Toast.LENGTH_SHORT).show();
            return;
        }
        String title, msg, go; final Intent target;
        switch (step) {
            case TAP_ONCE:
                title = "Turn on voice typing & screenshots";
                msg = "Lets the orb type what you say into any app and attach screenshots.\n\n"
                    + "On the next screen tap “Wizard OS voice typing” and turn it on.\n\n"
                    + "If Android says “Restricted setting” or “App was denied access”, that’s expected for apps installed "
                    + "outside the Play Store: tap OK, come back here, and I’ll take you to the unlock.";
                go = "Open Accessibility";
                target = ai.wizards.os.everywhere.AccessibilitySetup.accessibilityPage(this);
                break;
            case ALLOW_RESTRICTED:
                title = "Unlock it for Wizard OS";
                msg = "Android locks this for apps installed outside the Play Store.\n\n"
                    + "On the next screen tap ⋮ (top right) → Allow restricted settings, confirm, then come back here. "
                    + "I’ll take you straight to the switch.";
                go = "Open App info";
                target = ai.wizards.os.everywhere.AccessibilitySetup.appInfoPage(this);
                break;
            default:
                title = "Turn on voice typing & screenshots";
                msg = "Lets the orb type what you say into any app and attach screenshots.\n\n"
                    + "On the next screen: “Wizard OS voice typing” → turn it on → Allow. Then come back."
                    + (ai.wizards.os.everywhere.AccessibilitySetup.stage(this) >= ai.wizards.os.everywhere.AccessibilitySetup.STAGE_UNLOCK_VISITED
                        ? "\n\nStill greyed out? App info → ⋮ → Allow restricted settings." : "");
                go = "Open Accessibility";
                target = ai.wizards.os.everywhere.AccessibilitySetup.accessibilityPage(this);
        }
        a11yDialog = new android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(title)
                .setMessage(msg)
                .setPositiveButton(go, (d, w) -> {
                    a11ySetup = true;
                    ai.wizards.os.everywhere.AccessibilitySetup.reached(this,
                            step == ai.wizards.os.everywhere.AccessibilitySetup.Step.ALLOW_RESTRICTED
                                    ? ai.wizards.os.everywhere.AccessibilitySetup.STAGE_UNLOCK_VISITED
                                    : ai.wizards.os.everywhere.AccessibilitySetup.STAGE_A11Y_VISITED);
                    try { startActivity(target); }
                    catch (ActivityNotFoundException e) {
                        a11ySetup = false;
                        try { startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS)); } catch (Exception ignored) { }
                    }
                })
                .setNegativeButton("Not now", null)
                .create();
        if (step != ai.wizards.os.everywhere.AccessibilitySetup.Step.ALLOW_RESTRICTED
                && ai.wizards.os.everywhere.AccessibilitySetup.stage(this) >= ai.wizards.os.everywhere.AccessibilitySetup.STAGE_UNLOCK_VISITED) {
            a11yDialog.setButton(android.app.AlertDialog.BUTTON_NEUTRAL, "App info", (d, w) -> {
                a11ySetup = true;
                try { startActivity(ai.wizards.os.everywhere.AccessibilitySetup.appInfoPage(this)); } catch (Exception ignored) { }
            });
        }
        if (step == ai.wizards.os.everywhere.AccessibilitySetup.Step.ALLOW_RESTRICTED) {
            a11yDialog.setButton(android.app.AlertDialog.BUTTON_NEUTRAL, "Accessibility", (d, w) -> {
                a11ySetup = true;
                try { startActivity(ai.wizards.os.everywhere.AccessibilitySetup.accessibilityPage(this)); } catch (Exception ignored) { }
            });
        }
        a11yDialog.show();
    }

    @Override
    protected void onDestroy() {
        if (device != null) device.onDestroy();
        main.removeCallbacks(reachMark); main.removeCallbacks(reachGiveUp); main.removeCallbacks(reachRetry); main.removeCallbacks(netSettled);
        if (netWatch != null) { try { getSystemService(android.net.ConnectivityManager.class).unregisterNetworkCallback(netWatch); } catch (RuntimeException ignored) {} netWatch = null; }
        ai.wizards.os.everywhere.EverywhereService.setAppVoiceRemote(null);
        if (ai.wizards.os.everywhere.EverywhereService.appIsRecording()) ai.wizards.os.everywhere.EverywhereService.appVoiceState(this, "idle", 0);
        if (mizel != null) { mizel.detach(); mizel = null; }
        if (apps != null) { apps.detach(); apps = null; }
        if (web != null) { root.removeView(web); web.destroy(); }
        super.onDestroy();
    }

    /** FLAG_KEEP_SCREEN_ON while the web orb records; cleared on every page load so a reload can't leave it stuck. */
    void setKeepAwake(boolean on) {
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** Small, read-mostly bridge: the shell can ask for a haptic tick and learn it runs natively. */
    final class Bridge {
        @JavascriptInterface
        public String platform() { return "android:" + BuildConfig.VERSION_NAME; }

        /* ---- Carry (one time): the old name's page hands its local state over; the new name's shell takes it. ---- */
        @JavascriptInterface
        public boolean carryOut(String json) {
            if (!carrying || !Carry.isPage(MainActivity.this, pageUrl)) return false;
            boolean ok = Carry.save(MainActivity.this, json);
            if (ok) Carry.finished(MainActivity.this);
            main.post(() -> endCarry(ok ? "saved" : "refused"));
            return ok;
        }

        @JavascriptInterface
        public String carryIn() {
            String u = pageUrl;
            if (u == null || !u.startsWith(ai.wizards.os.device.AppState.primaryOrigin(MainActivity.this) + "/")) return "";
            return Carry.load(MainActivity.this);
        }

        @JavascriptInterface
        public void carryDone() {
            String u = pageUrl;
            if (u != null && u.startsWith(ai.wizards.os.device.AppState.primaryOrigin(MainActivity.this) + "/")) Carry.clear(MainActivity.this);
        }

        /* ---- Usuals: James's regular Grab orders (usuals/*). Nothing here can place an order. ---- */
        @JavascriptInterface
        public String usuals() {
            ai.wizards.os.usuals.UsualsRunner r = ai.wizards.os.usuals.UsualsRunner.get(MainActivity.this);
            try {
                return new org.json.JSONObject()
                        .put("list", new org.json.JSONArray(ai.wizards.os.usuals.UsualsStore.json(MainActivity.this)))
                        .put("blocker", r.blocker(ai.wizards.os.usuals.UsualsPolicy.GRAB))
                        .put("state", new org.json.JSONObject(r.stateJson())).toString();
            } catch (org.json.JSONException e) { return "{}"; }
        }

        @JavascriptInterface
        public String usualsTeach(String name) {
            final String[] out = {""};
            java.util.concurrent.CountDownLatch l = new java.util.concurrent.CountDownLatch(1);
            main.post(() -> { out[0] = ai.wizards.os.usuals.UsualsRunner.get(MainActivity.this).teach(name); l.countDown(); });
            try { l.await(3, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            return out[0];
        }

        @JavascriptInterface
        public String usualsRun(String id) {
            final String[] out = {""};
            java.util.concurrent.CountDownLatch l = new java.util.concurrent.CountDownLatch(1);
            main.post(() -> {
                ai.wizards.os.usuals.UsualsRunner r = ai.wizards.os.usuals.UsualsRunner.get(MainActivity.this);
                out[0] = ai.wizards.os.usuals.UsualsRunner.NEW.equals(id) ? r.teach("") : r.run(String.valueOf(id));
                l.countDown();
            });
            try { l.await(3, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            return out[0];
        }

        /** The usual whose name James said ("order my usual kra pao"), "+new" for "order something new", or "". */
        @JavascriptInterface
        public String usualsMatch(String said) {
            String id = ai.wizards.os.usuals.UsualsVoice.match(MainActivity.this, String.valueOf(said));
            return id == null ? "" : id;
        }

        @JavascriptInterface
        public boolean usualsSave(String id, String name, String script) {
            ai.wizards.os.usuals.UsualsStore.Usual u = ai.wizards.os.usuals.UsualsStore.get(MainActivity.this, String.valueOf(id));
            if (u == null) return false;
            if (name != null && !name.trim().isEmpty()) { u.name = name.trim(); u.needsName = false; }
            if (script != null && !"null".equals(script) && !"undefined".equals(script) && !script.equals(ai.wizards.os.usuals.UsualsPolicy.write(u.steps))) {
                java.util.List<ai.wizards.os.usuals.UsualsPolicy.Step> s = ai.wizards.os.usuals.UsualsPolicy.parse(script);
                if (s.isEmpty()) return false;
                u.steps = s;
            }
            ai.wizards.os.usuals.UsualsStore.put(MainActivity.this, u);
            return true;
        }

        /** "Keep" on a new usual's suggested name. */
        @JavascriptInterface
        public void usualsKeepName(String id) {
            ai.wizards.os.usuals.UsualsStore.Usual u = ai.wizards.os.usuals.UsualsStore.get(MainActivity.this, String.valueOf(id));
            if (u != null && u.needsName) { u.needsName = false; ai.wizards.os.usuals.UsualsStore.put(MainActivity.this, u); }
        }
        @JavascriptInterface
        public void usualsDelete(String id) { ai.wizards.os.usuals.UsualsStore.delete(MainActivity.this, String.valueOf(id)); }

        @JavascriptInterface
        public void usualsCancel() { main.post(() -> ai.wizards.os.usuals.UsualsRunner.get(MainActivity.this).cancel()); }

        /** {"mic","assistant","used","samsung","step"}: what the side-button switch should show. */
        @JavascriptInterface
        public String sideButton() { return SideButton.status(MainActivity.this); }

        /** The Turn on tap. Does the next missing step; the result comes back through window.__wosSideButton. */
        @JavascriptInterface
        public void setupSideButton() { runOnUiThread(MainActivity.this::startSideButton); }

        /** Samsung's own Side button page (or Android's gesture page), for "not opening Wizard?". */
        @JavascriptInterface
        public void sideButtonSettings() {
            runOnUiThread(() -> {
                if (!SideButton.openSideKeyPage(MainActivity.this)) SideButton.openAssistantPage(MainActivity.this);
            });
        }

        /** {"enabled","overlay","notifications","mic"} for the Wizard Everywhere switch in Settings. */
        @JavascriptInterface
        public String everywhere() { return ai.wizards.os.everywhere.EverywhereService.status(MainActivity.this); }

        @JavascriptInterface
        public void setEverywhere(boolean on) {
            runOnUiThread(() -> {
                if (on) startEverywhere();
                else { ai.wizards.os.everywhere.EverywhereService.setEnabled(MainActivity.this, false); pushEverywhere(); }
            });
        }

        /** Messages from the floating button that Wizard has not accepted yet (no paths, no bodies). */
        /** Android's Accessibility page, to switch on voice typing + screenshots for Wizard Everywhere. */
        @JavascriptInterface
        public void voiceTypingSettings() { runOnUiThread(() -> offerAccessibility(false)); }

        /** "listen" | "paused" | "think" | "idle" + elapsed ms: leaving Wizard OS mid-take shows the floating orb. */
        @JavascriptInterface
        public void appVoice(String state, long elapsedMs) {
            ai.wizards.os.everywhere.EverywhereService.appVoiceState(MainActivity.this, String.valueOf(state), elapsedMs);
        }

        @JavascriptInterface
        public String unsent() { return ai.wizards.os.everywhere.EverywhereOutbox.get(MainActivity.this).unsentJson(); }

        @JavascriptInterface
        public void retryUnsent(String id) { ai.wizards.os.everywhere.EverywhereOutbox.get(MainActivity.this).retry(String.valueOf(id)); }

        @JavascriptInterface
        public void deleteUnsent(String id) { ai.wizards.os.everywhere.EverywhereOutbox.get(MainActivity.this).delete(String.valueOf(id)); }

        /** The web outbox's "not sent" count, so a notification is waiting if James leaves the app. */
        @JavascriptInterface
        public void appUnsent(int failed, String firstText) {
            ai.wizards.os.everywhere.EverywhereService.appUnsent(MainActivity.this, failed, firstText == null ? "" : firstText);
        }

        /** The orb is recording (or transcribing): keep the screen from locking until it says otherwise. */
        @JavascriptInterface
        public void keepAwake(boolean on) { runOnUiThread(() -> setKeepAwake(on)); }

        /** Full-screen window in the shell: hide Android's status and navigation bars too (edge swipe peeks them). */
        @JavascriptInterface
        public void immersive(boolean on) { runOnUiThread(() -> applyImmersive(on)); }

        /** Camera cutout height in CSS px (0 when the phone has none). */
        @JavascriptInterface
        public int cutoutTop() { return cutoutCss; }

        /** Status bar inset in CSS px the page draws under (0 in immersive full screen). */
        @JavascriptInterface
        public int insetTop() { return topCss; }

        /* ---- Share (James, 12 Oct): Android's share sheet for a message, selected words or a file. ---- */
        @JavascriptInterface
        public void shareText(String text, String title) {
            String t = SelectionPolicy.shareText(text);
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, t);
                if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
                try { startActivity(Intent.createChooser(send, null)); }
                catch (Exception e) { android.util.Log.w("WizardOS", "share sheet failed", e); }
            });
        }

        @JavascriptInterface
        public void shareFile(String b64, String name, String mime) {
            try {
                byte[] bytes = android.util.Base64.decode(b64 == null ? "" : b64, android.util.Base64.DEFAULT);
                java.io.File root = ai.wizards.os.share.OutShareProvider.dir(MainActivity.this);
                long cutoff = System.currentTimeMillis() - 24L * 3600 * 1000;
                java.io.File[] old = root.listFiles();
                if (old != null) for (java.io.File d : old) if (d.lastModified() < cutoff) { java.io.File[] fs = d.listFiles(); if (fs != null) for (java.io.File f : fs) f.delete(); d.delete(); }
                String token = java.util.UUID.randomUUID().toString().replace("-", "");
                java.io.File dir = new java.io.File(root, token); dir.mkdirs();
                String fn = SelectionPolicy.fileName(name);
                java.io.File out = new java.io.File(dir, fn);
                try (java.io.FileOutputStream o = new java.io.FileOutputStream(out)) { o.write(bytes); }
                Uri uri = new Uri.Builder().scheme("content").authority(ai.wizards.os.share.OutShareProvider.authority(MainActivity.this)).appendPath(token).appendPath(fn).build();
                String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                runOnUiThread(() -> {
                    Intent send = new Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    send.setClipData(android.content.ClipData.newRawUri(fn, uri));
                    try { startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); }
                    catch (Exception e) { android.util.Log.w("WizardOS", "file share failed", e); }
                });
            } catch (Exception e) { android.util.Log.w("WizardOS", "file share failed", e); }
        }

        /** The page's selection state for SelectionWebView: 1 press on text, 2 press in a field, 3 own selection, 0 none. */
        @JavascriptInterface
        public void selection(int state) { WebView w = web; if (w instanceof SelectionWebView) ((SelectionWebView) w).selectionState(state); }

        @JavascriptInterface
        public void haptic(int ms) {
            Vibrator v = getSystemService(Vibrator.class);
            if (v == null || !v.hasVibrator()) return;
            int d = Math.max(5, Math.min(ms, 60));
            v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE));
        }
    }
}
