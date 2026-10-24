package ai.wizards.shell;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Wizard Shell: one WebView on the owner's Wizard plus the few things a web page cannot do itself.
 *
 * Native here, and nothing else: choosing the Wizard (connect screen, wizard://connect links), the
 * can't-reach screen, microphone and camera permission for that exact Wizard, file picking, handing
 * other sites and downloads to the phone's browser, hardware Back, and system-bar insets.
 * No JavaScript bridge: the Wizard's pages see an ordinary browser, so every feature updates from the Wizard.
 * Optional device capabilities (background recording, the floating orb) are offered over one versioned message port,
 * window.wizardDevicePort v1 ({@link ShellPort}), which the Wizard discovers and may ignore.
 */
public class ShellActivity extends Activity {
    static final String ACTION_CHANGE = "ai.wizards.shell.CHANGE_WIZARD";
    private static final String PREFS = ShellOrigin.PREFS, KEY_ORIGIN = ShellOrigin.KEY;
    private static final String UA_TAG = " WizardOS-Android/" + BuildConfig.VERSION_NAME + " WizardShell/" + BuildConfig.VERSION_NAME;
    private static final int REQ_FILE = 1, REQ_MEDIA = 2, REQ_CAPABILITY = 3;
    private static final int BG = Color.rgb(5, 3, 12), INK = Color.rgb(233, 228, 255), VIOLET = Color.rgb(155, 123, 255);

    private FrameLayout root;
    private WebView web;
    private View cover;
    private String origin;
    private ValueCallback<Uri[]> pendingFiles;
    private PermissionRequest pendingMedia;
    private boolean mainFrameFailed;
    private ShellPort port;
    private volatile java.util.concurrent.CountDownLatch capabilityAsk;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            // Android 15 draws apps edge to edge; keep the Wizard clear of the status bar, nav bar and keyboard.
            if (Build.VERSION.SDK_INT >= 30) {
                int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime();
                android.graphics.Insets i = insets.getInsets(types);
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            }
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
        origin = ShellOrigin.parse(prefs().getString(KEY_ORIGIN, null));
        if (session()) { begin(saved); return; }
        addChangeShortcut();
        if (!handle(getIntent())) {
            if (origin == null) showConnect(null, null);
            else open(saved);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (session()) return; // a pinned app's task resumes as it was (AppSessionActivity)
        setIntent(intent);
        handle(intent);
    }

    /* ---------------- Hooks for a pinned home-screen app (home/AppSessionActivity) ---------------- */

    /** True in a pinned app's own task: one app on the selected Wizard, no connect flow, no device ports. */
    protected boolean session() { return false; }

    /** A pinned app's first step (only called when {@link #session()}). */
    protected void begin(Bundle saved) { }

    /** Where this window opens and returns to. */
    protected String startUrl() { return ShellOrigin.home(origin); }

    /** A main-frame URL this window may show itself; anything else goes to the phone or is refused. */
    protected boolean ownPage(String url) { return ShellOrigin.same(origin, url); }

    protected String origin() { return origin; }

    /** A plain native note in place of the Wizard (a pinned app this phone can't open). */
    protected void showNote(String title, String body) {
        LinearLayout col = column();
        col.addView(text(title, 22, true), lp(0));
        col.addView(dim(text(body, 15, false), 0.75f), lp(10));
        showCover(col);
    }

    /** wizard://connect links and the launcher's Change Wizard shortcut open the connect screen. */
    private boolean handle(Intent intent) {
        if (intent == null) return false;
        if (ACTION_CHANGE.equals(intent.getAction())) {
            showConnect(origin, null);
            return true;
        }
        Uri data = intent.getData();
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && data != null && "wizard".equals(data.getScheme())) {
            String suggested = ShellOrigin.parse(data.toString());
            showConnect(suggested != null ? suggested : origin, suggested == null ? "That link has no valid Wizard address." : null);
            return true;
        }
        return false;
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /* ---------------- The Wizard ---------------- */

    protected void open(Bundle saved) {
        hideCover();
        if (web == null) buildWebView();
        if (saved != null && web.restoreState(saved) != null && (web.getUrl() == null || ownPage(web.getUrl()))) return;
        web.clearHistory();
        web.loadUrl(startUrl());
    }

    /* ---------------- Floating orb (device.orb): a clear ask before Android's overlay screen ---------------- */

    private boolean overlayAsked;

    private void askOverlay() {
        if (isFinishing() || ai.wizards.shell.orb.OrbService.permitted(this)) return;
        new android.app.AlertDialog.Builder(this)
                .setTitle("Show the Wizard orb over other apps?")
                .setMessage("The orb floats over your other apps so you can talk to your Wizard from anywhere. "
                        + "Tap it to talk, drag it to move it, hold it to hide it.\n\n"
                        + "Android asks for \u201cDisplay over other apps\u201d next. Turn it on for Wizard, then come back.")
                .setPositiveButton("Continue", (d, w) -> {
                    overlayAsked = true;
                    try {
                        startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:" + getPackageName())));
                    } catch (ActivityNotFoundException e) { overlayAsked = false; }
                })
                .setNegativeButton("Not now", null)
                .show();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (overlayAsked) {
            overlayAsked = false;
            if (ai.wizards.shell.orb.OrbService.permitted(this)) ai.wizards.shell.orb.OrbService.setWanted(this, true);
        }
        // The orb hides while the Wizard app is in front, and stays over a pinned app (its own task).
        if (session()) ai.wizards.shell.orb.OrbService.refresh(this);
        else ai.wizards.shell.orb.OrbService.appFront(this, true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // The Wizard's pages re-check what changed while away (e.g. a home-screen pin the launcher just confirmed).
        if (web != null && !session()) web.evaluateJavascript("window.dispatchEvent(new Event('wos-native-resume'))", null);
    }

    @Override
    protected void onStop() {
        if (!session()) ai.wizards.shell.orb.OrbService.appFront(this, false);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        java.util.concurrent.CountDownLatch l = capabilityAsk;
        if (l != null) l.countDown();
        if (port != null) port.close();
        super.onDestroy(); // a take still recording carries on in its foreground service
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void buildWebView() {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + UA_TAG);
        // Before the first load: the ports are injected only for this exact origin (a new Wizard gets a new WebView).
        // A pinned app's task gets none: it is one app, not the Wizard shell.
        if (!session()) {
            port = ShellPort.install(web, origin, () -> origin, new ai.wizards.shell.device.DevicePort.Registry()
                    .add(new ai.wizards.shell.recorder.RecordingCapability(this, () -> origin, this::ensurePermissions))
                    .add(new ai.wizards.shell.orb.OrbCapability(this, () -> runOnUiThread(this::askOverlay))));
            ai.wizards.shell.home.HomeScreenPort.install(this, web, origin);
        }
        root.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web.setDownloadListener((url, ua, disposition, mime, length) -> outside(Uri.parse(url)));
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri u = request.getUrl();
                if (ownPage(u.toString())) return false;
                if (session()) {
                    // A pinned app: a tapped public link opens in the phone's browser; the Wizard's other pages,
                    // custom schemes and untapped hops are refused, so this task never becomes the whole Wizard.
                    boolean link = "https".equals(u.getScheme()) || "http".equals(u.getScheme());
                    if (request.hasGesture() && link && !ShellOrigin.same(origin, u.toString())) outside(u);
                    else android.widget.Toast.makeText(ShellActivity.this, "Use Android Home to switch apps", android.widget.Toast.LENGTH_SHORT).show();
                    return true;
                }
                if ("wizard".equals(u.getScheme())) { handle(new Intent(Intent.ACTION_VIEW, u)); return true; }
                outside(u); // other sites, mail, phone numbers: the phone's own apps
                return true;
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // A load that skipped shouldOverrideUrlLoading (a redirect, a restored page) still can't leave the app.
                if (session() && request.isForMainFrame() && !ownPage(request.getUrl().toString())) {
                    return new android.webkit.WebResourceResponse("text/html", "UTF-8", new java.io.ByteArrayInputStream(
                            "<!doctype html><h2>App unavailable</h2><p>Use Android Home to return to Wizard.</p>".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                }
                return null;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                mainFrameFailed = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!mainFrameFailed && cover != null && ShellOrigin.same(origin, url)) hideCover();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                mainFrameFailed = true;
                showOffline(String.valueOf(error.getDescription()));
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // A renderer crash never takes the app down: rebuild and go home.
                dropWebView();
                open(null);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> media(request));
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

    private void dropWebView() {
        if (port != null) port.close();
        port = null;
        root.removeView(web);
        web.destroy();
        web = null;
    }

    /**
     * A capability (on a background thread) needs a runtime permission: ask once and wait for the answer.
     * True when every permission is granted.
     */
    private boolean ensurePermissions(String... wanted) {
        List<String> ask = new ArrayList<>();
        for (String p : wanted) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) ask.add(p);
        if (ask.isEmpty()) return true;
        java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        synchronized (this) {
            if (capabilityAsk != null) return false; // one question at a time
            capabilityAsk = done;
        }
        runOnUiThread(() -> requestPermissions(ask.toArray(new String[0]), REQ_CAPABILITY));
        try { done.await(120, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        synchronized (this) { if (capabilityAsk == done) capabilityAsk = null; }
        for (String p : wanted) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    private void outside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    /* ---------------- Microphone and camera, for the selected Wizard only ---------------- */

    private void media(PermissionRequest request) {
        if (!ShellOrigin.same(origin, String.valueOf(request.getOrigin()))) { request.deny(); return; }
        List<String> grant = new ArrayList<>();
        List<String> ask = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                grant.add(r);
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) ask.add(Manifest.permission.RECORD_AUDIO);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                grant.add(r);
                if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) ask.add(Manifest.permission.CAMERA);
            }
        }
        if (grant.isEmpty()) { request.deny(); return; }
        if (ask.isEmpty()) { request.grant(grant.toArray(new String[0])); return; }
        if (pendingMedia != null) pendingMedia.deny();
        pendingMedia = request;
        requestPermissions(ask.toArray(new String[0]), REQ_MEDIA);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == REQ_CAPABILITY) {
            java.util.concurrent.CountDownLatch l = capabilityAsk;
            if (l != null) l.countDown();
            return;
        }
        if (code != REQ_MEDIA || pendingMedia == null) return;
        PermissionRequest r = pendingMedia;
        pendingMedia = null;
        List<String> ok = new ArrayList<>();
        for (String res : r.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) ok.add(res);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) ok.add(res);
        }
        if (ok.isEmpty()) r.deny();
        else r.grant(ok.toArray(new String[0]));
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE || pendingFiles == null) return;
        pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        pendingFiles = null;
    }

    /* ---------------- Back: the Wizard decides; the app never exits on Back ---------------- */

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        back();
    }

    private void back() {
        if (cover != null) {
            if (origin != null && web != null) { retry(); return; }
            moveTaskToBack(true);
            return;
        }
        if (web == null) return;
        web.evaluateJavascript("(window.__wosNativeBack ? window.__wosNativeBack() : 'nojs')", r -> {
            String step = r == null ? "" : r.replace("\"", "");
            if (!step.isEmpty() && !step.equals("nojs") && !step.equals("null")) return;
            if (session()) return; // a pinned app consumes Back: it never steps out of its own page
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    /* ---------------- Native screens: connect and can't-reach ---------------- */

    private void showConnect(String prefill, String note) {
        LinearLayout col = column();
        col.addView(text("Connect to your Wizard", 22, true), lp(0));
        col.addView(dim(text("Paste your Wizard's address, or open its Setup link on this phone.", 15, false), 0.75f), lp(10));
        EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        field.setImeOptions(EditorInfo.IME_ACTION_GO);
        field.setHint("https://your-wizard.ts.net");
        field.setTextColor(INK);
        field.setHintTextColor(Color.argb(110, 233, 228, 255));
        field.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        if (prefill != null) field.setText(prefill);
        col.addView(field, lp(22));
        TextView error = dim(text(note == null ? "" : note, 14, false), 0.85f);
        error.setTextColor(Color.rgb(255, 150, 160));
        col.addView(error, lp(8));
        TextView go = pill("Connect", true);
        col.addView(go, lp(18));
        Runnable submit = () -> {
            String clean = ShellOrigin.parse(field.getText().toString());
            if (clean == null) { error.setText("Use the full https address of your Wizard."); return; }
            boolean changed = !clean.equals(origin);
            prefs().edit().putString(KEY_ORIGIN, clean).apply();
            origin = clean;
            if (changed && web != null) {
                // A different Wizard starts clean: no history or page state carries over.
                dropWebView();
            }
            open(null);
        };
        go.setOnClickListener(v -> submit.run());
        field.setOnEditorActionListener((v, id, e) -> { submit.run(); return true; });
        if (origin != null) {
            TextView cancel = pill("Cancel", false);
            cancel.setOnClickListener(v -> open(null));
            col.addView(cancel, lp(10));
        }
        showCover(col);
    }

    private void showOffline(String why) {
        LinearLayout col = column();
        col.addView(text("Can't reach your Wizard", 22, true), lp(0));
        String hint = ShellOrigin.tailnet(origin) ? "Check that Tailscale is on, then try again." : "Check your connection, then try again.";
        col.addView(dim(text(hint, 15, false), 0.75f), lp(10));
        TextView retry = pill("Try again", true);
        retry.setOnClickListener(v -> retry());
        col.addView(retry, lp(24));
        if (ShellOrigin.tailnet(origin)) {
            TextView ts = pill("Open Tailscale", false);
            ts.setOnClickListener(v -> {
                Intent i = getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");
                if (i != null) startActivity(i);
                else outside(Uri.parse("https://play.google.com/store/apps/details?id=com.tailscale.ipn"));
            });
            col.addView(ts, lp(10));
        }
        if (!session()) {
            TextView change = pill("Change Wizard", false);
            change.setOnClickListener(v -> showConnect(origin, null));
            col.addView(change, lp(10));
        }
        col.addView(dim(text(origin + "\n" + why, 12, false), 0.4f), lp(18));
        showCover(col);
    }

    private void retry() {
        if (web == null) { open(null); return; }
        hideCover();
        web.loadUrl(startUrl());
    }

    private void showCover(View content) {
        hideCover();
        FrameLayout f = new FrameLayout(this);
        f.setBackgroundColor(BG);
        f.setClickable(true);
        f.addView(content, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        root.addView(f, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        cover = f;
    }

    private void hideCover() {
        if (cover != null) root.removeView(cover);
        cover = null;
    }

    private void addChangeShortcut() {
        ShortcutManager sm = getSystemService(ShortcutManager.class);
        if (sm == null) return;
        Intent i = new Intent(ACTION_CHANGE).setClass(this, ShellActivity.class);
        ShortcutInfo s = new ShortcutInfo.Builder(this, "change-wizard").setShortLabel("Change Wizard")
                .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher)).setIntent(i).build();
        try { sm.setDynamicShortcuts(Collections.singletonList(s)); } catch (Exception ignored) { }
    }

    private LinearLayout column() {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(32), dp(24), dp(32), dp(24));
        return col;
    }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(INK);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private TextView dim(TextView t, float a) {
        t.setAlpha(a);
        return t;
    }

    private TextView pill(String label, boolean primary) {
        TextView t = text(label, 16, true);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(18), dp(13), dp(18), dp(13));
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(26));
        if (primary) g.setColor(VIOLET); else g.setStroke(dp(1), Color.argb(90, 233, 228, 255));
        t.setBackground(g);
        t.setTextColor(primary ? Color.WHITE : INK);
        return t;
    }

    private LinearLayout.LayoutParams lp(int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(topDp);
        return p;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
