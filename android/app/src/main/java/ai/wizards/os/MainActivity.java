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
 * Wizard OS: a native home for James's private Wizard OS shell (private.wizard001.com/wizard-os-home/).
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

    private WebView web;
    private FrameLayout root;
    private PermissionRequest pendingMic;
    private ValueCallback<Uri[]> pendingFiles;
    private boolean showingError;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(5, 3, 12));
        // targetSdk 35 draws edge to edge: keep the shell clear of the status and navigation bars.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                int types = WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout();
                android.graphics.Insets i = insets.getInsets(types);
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            }
            return insets; // API 28-29 do not draw edge to edge; the system already keeps content clear
        });
        setContentView(root);
        buildWebView();
        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) web.loadUrl(startUrl(getIntent()));
        installBack();
    }

    private void buildWebView() {
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true); // QA build only
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(5, 3, 12));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
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

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (Origin.isPrivate(u)) return false;
                if (!req.isForMainFrame()) return false; // hosted app frames stay inside their window
                openOutside(u);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline(String.valueOf(err.getDescription()));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!url.startsWith("data:")) showingError = false;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Never let a renderer crash take the app down: rebuild the WebView and go home.
                root.removeView(web);
                web.destroy();
                buildWebView();
                web.loadUrl(BuildConfig.HOME_URL);
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
        if (showingError) { web.loadUrl(BuildConfig.HOME_URL); return; }
        web.evaluateJavascript("(window.__wosNativeBack ? window.__wosNativeBack() : 'nojs')", result -> {
            String r = result == null ? "" : result.replace("\"", "");
            if (!r.equals("nojs") && !r.isEmpty() && !r.equals("null")) return; // the shell handled it
            // The shell is not loaded (or is a page off the shell): step back in the WebView, else go home.
            String url = web.getUrl();
            if (web.canGoBack()) web.goBack();
            else if (url == null || !url.startsWith(BuildConfig.HOME_URL)) web.loadUrl(BuildConfig.HOME_URL);
            else Toast.makeText(this, "You're home", Toast.LENGTH_SHORT).show();
        });
    }

    /* ---------------- Links, intents, errors ---------------- */

    String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data != null && Origin.isShell(data)) return data.toString();
        return BuildConfig.HOME_URL;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (data != null && Origin.isShell(data)) web.loadUrl(data.toString());
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open that link", Toast.LENGTH_SHORT).show();
        }
    }

    private void showOffline(String why) {
        showingError = true;
        String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<body style='margin:0;background:#05030c;color:#e9e4ff;font:16px system-ui;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
                + "<div style='padding:24px'><div style='font-size:44px;color:#9b7bff'>◉</div>"
                + "<h2 style='font-weight:600'>Can't reach Wizard OS</h2>"
                + "<p style='opacity:.75'>Check that Tailscale is connected on this phone, then tap retry.</p>"
                + "<a href='" + BuildConfig.HOME_URL + "' style='display:inline-block;margin-top:12px;padding:12px 22px;border-radius:999px;background:#2a1d5c;color:#fff;text-decoration:none'>Retry</a>"
                + "<p style='opacity:.4;font-size:12px;margin-top:18px'>" + android.text.Html.escapeHtml(why) + "</p></div></body>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
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
        pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        pendingFiles = null;
    }

    /* ---------------- Lifecycle ---------------- */

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.evaluateJavascript("window.dispatchEvent(new Event('wos-native-resume'))", null);
    }

    @Override
    protected void onPause() {
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { root.removeView(web); web.destroy(); }
        super.onDestroy();
    }

    /** Small, read-mostly bridge: the shell can ask for a haptic tick and learn it runs natively. */
    final class Bridge {
        @JavascriptInterface
        public String platform() { return "android:" + BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public void haptic(int ms) {
            Vibrator v = getSystemService(Vibrator.class);
            if (v == null || !v.hasVibrator()) return;
            int d = Math.max(5, Math.min(ms, 60));
            v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE));
        }
    }
}
