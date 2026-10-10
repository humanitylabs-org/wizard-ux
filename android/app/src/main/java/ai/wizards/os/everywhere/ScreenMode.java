package ai.wizards.os.everywhere;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Screen mode (long-press the floating orb → Select text / Translate screen).
 *
 * One full-screen window over whatever app James is in: the frozen screen, every piece of text Android exposes for it
 * (so text an app won't let you copy can still be copied), tap or drag to select, then Copy · Search · Translate ·
 * Ask Wizard. Translate screen lays English over the original text in place. Picture text reads words inside images.
 *
 * Search runs Wizard Search (private, no Google) in a sheet inside this window; translation and picture text go to
 * Wizard Search's private Tinfoil endpoints. Back steps out one layer at a time, then closes; it never reaches the app.
 */
final class ScreenMode {
    static final String TAG = EverywhereOutbox.TAG;

    interface Host {
        void screenClosed();
    }

    private final Context ctx;
    private final Host host;
    private final WindowManager wm;
    private final float density;
    private final String origin;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private Root root;
    private WebView page, search;
    private boolean open, pageReady, laidOut, sent;
    private String mode = "select";
    private List<ScreenPolicy.Block> blocks;
    private byte[] shot;
    private int sw, sh, insetTop, insetBottom, winX, winY;
    private float searchFrac;

    ScreenMode(Context ctx, Host host, String origin) {
        this.ctx = ctx;
        this.host = host;
        this.origin = origin;
        this.wm = ctx.getSystemService(WindowManager.class);
        this.density = ctx.getResources().getDisplayMetrics().density;
    }

    boolean isOpen() { return open; }

    /** A root that hands Back to the page first (close a sheet, clear the selection), then closes. */
    private final class Root extends FrameLayout {
        Root(Context c) { super(c); }

        @Override
        public boolean dispatchKeyEvent(KeyEvent e) {
            if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
                if (e.getAction() == KeyEvent.ACTION_UP && !e.isCanceled()) back();
                return true;
            }
            return super.dispatchKeyEvent(e);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    void open(String mode, List<ScreenPolicy.Block> blocks, byte[] jpeg, int screenW, int screenH) {
        if (open) return;
        this.mode = mode;
        this.blocks = blocks;
        this.shot = jpeg;
        this.sw = screenW;
        this.sh = screenH;
        open = true; pageReady = false; laidOut = false; sent = false; searchFrac = 0;

        root = new Root(ctx);
        root.setBackgroundColor(Color.rgb(7, 6, 15));
        page = new WebView(ctx);
        page.setBackgroundColor(Color.rgb(7, 6, 15));
        page.setVerticalScrollBarEnabled(false);
        page.setHorizontalScrollBarEnabled(false);
        page.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = page.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(true); // only file:///android_asset/assist/ is served; everything else is blocked
        s.setBlockNetworkLoads(true);
        page.addJavascriptInterface(new Bridge(), "ScreenNative");
        page.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                if (r.getUrl().toString().startsWith("file:///android_asset/assist/")) return null;
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", null, new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public void onPageFinished(WebView v, String url) { pageReady = true; sendOpen(); }
        });
        root.addView(page, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(screenW, screenH,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.OPAQUE);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = 0; lp.y = 0;
        lp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN;
        lp.windowAnimations = android.R.style.Animation_Dialog;
        if (Build.VERSION.SDK_INT >= 30) {
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            lp.setFitInsetsTypes(0);
        } else {
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        lp.setTitle("WizScreen");
        try {
            wm.addView(root, lp);
        } catch (Exception e) {
            Log.w(TAG, "screen mode refused: " + e.getMessage());
            open = false; root = null; page.destroy(); page = null;
            Toast.makeText(ctx, "Android blocked the screen overlay here", Toast.LENGTH_SHORT).show();
            host.screenClosed();
            return;
        }
        root.post(() -> { measure(); laidOut = true; sendOpen(); });
        page.loadUrl("file:///android_asset/assist/screen.html");
        Log.i(TAG, "screen mode open (" + mode + ") blocks=" + blocks.size() + " shot=" + (jpeg == null ? 0 : jpeg.length));
    }

    @SuppressWarnings("deprecation")
    private void measure() {
        if (root == null) return;
        int[] loc = new int[2];
        root.getLocationOnScreen(loc);
        winX = loc[0]; winY = loc[1];
        WindowInsets wi = root.getRootWindowInsets();
        if (wi != null) {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets in = wi.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                insetTop = in.top; insetBottom = in.bottom;
            } else {
                insetTop = wi.getStableInsetTop(); insetBottom = wi.getStableInsetBottom();
            }
        }
        if (insetTop <= 0) {
            int id = ctx.getResources().getIdentifier("status_bar_height", "dimen", "android");
            insetTop = id > 0 ? ctx.getResources().getDimensionPixelSize(id) : Math.round(24 * density);
        }
    }

    private void sendOpen() {
        if (!open || !pageReady || !laidOut || sent) return;
        sent = true;
        try {
            JSONObject o = new JSONObject()
                    .put("mode", mode).put("dpr", density).put("ox", winX).put("oy", winY).put("sw", sw).put("sh", sh)
                    .put("top", insetTop / density).put("bot", insetBottom / density)
                    .put("shot", shot != null && shot.length > 0)
                    .put("few", ScreenPolicy.wantsPictureText(blocks))
                    .put("blocks", ScreenPolicy.toJson(blocks));
            js("S.open(" + o + ")");
        } catch (JSONException e) { Log.w(TAG, "screen open json", e); }
    }

    private void js(String code) {
        main.post(() -> { if (page != null) page.evaluateJavascript("try{" + code + "}catch(e){ScreenNative.log('js '+e)}", null); });
    }

    void back() {
        if (!open) return;
        if (page == null || !pageReady) { close(); return; }
        page.evaluateJavascript("(window.S && S.back && S.back()) ? 'y' : 'n'", r -> { if (!"\"y\"".equals(r)) close(); });
    }

    void close() {
        if (!open) return;
        open = false;
        try { if (root != null) wm.removeViewImmediate(root); } catch (Exception ignored) { }
        if (search != null) { search.stopLoading(); search.destroy(); search = null; }
        if (page != null) { page.destroy(); page = null; }
        root = null; shot = null; blocks = null;
        Log.i(TAG, "screen mode closed");
        host.screenClosed();
    }

    /* ------------------------------------------------------------------ search sheet (Wizard Search) */

    @SuppressLint("SetJavaScriptEnabled")
    private void showSearch(String q, float frac) {
        if (!open || root == null) return;
        q = ScreenPolicy.clipContext(q, 300);
        if (q.isEmpty()) return;
        if (search == null) {
            search = new WebView(ctx);
            search.setBackgroundColor(Color.rgb(11, 11, 20));
            WebSettings s = search.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            search.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                    Uri u = r.getUrl();
                    if (isSearchUrl(u)) return false;
                    openExternal(u);
                    return true;
                }
            });
            final float radius = 22 * density;
            search.setOutlineProvider(new ViewOutlineProvider() {
                @Override public void getOutline(View v, Outline o) { o.setRoundRect(0, 0, v.getWidth(), v.getHeight() + Math.round(radius), radius); }
            });
            search.setClipToOutline(true);
            root.addView(search, sheetParams(frac));
        }
        searchFrac = frac;
        search.setLayoutParams(sheetParams(frac));
        search.setVisibility(View.VISIBLE);
        try {
            String url = origin + "/wizard-search/?q=" + URLEncoder.encode(q, "UTF-8");
            if (!url.equals(search.getUrl())) search.loadUrl(url);
        } catch (IOException ignored) { }
        js("S.searchShown(" + JSONObject.quote(q) + "," + sheetCssPx(frac) + ")");
        Log.i(TAG, "screen search q.len=" + q.length());
    }

    private boolean isSearchUrl(Uri u) {
        Uri o = Uri.parse(origin);
        return u != null && String.valueOf(o.getScheme()).equals(u.getScheme()) && String.valueOf(o.getAuthority()).equals(u.getAuthority())
                && u.getPath() != null && u.getPath().startsWith("/wizard-search");
    }

    private void openExternal(Uri u) {
        if (u == null || !("https".equals(u.getScheme()) || "http".equals(u.getScheme()))) return;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent.getActivity(ctx, 41, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE).send();
            close();
        } catch (Exception e) { Log.w(TAG, "open link failed: " + e.getMessage()); }
    }

    private int sheetPx(float frac) { return Math.round(sh * Math.max(0.2f, Math.min(0.9f, frac))); }

    private float sheetCssPx(float frac) { return sheetPx(frac) / density; }

    private FrameLayout.LayoutParams sheetParams(float frac) {
        FrameLayout.LayoutParams p = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, sheetPx(frac), Gravity.BOTTOM);
        p.bottomMargin = insetBottom;
        return p;
    }

    private void hideSearch() {
        if (search == null) return;
        search.setVisibility(View.GONE);
        searchFrac = 0;
        js("S.searchHidden()");
    }

    /* ------------------------------------------------------------------ Wizard Search calls (private Tinfoil) */

    private String post(String path, byte[] body, String type) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(origin + path).openConnection();
        c.setConnectTimeout(15_000);
        c.setReadTimeout(100_000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", type);
        c.setFixedLengthStreamingMode(body.length);
        try (OutputStream o = c.getOutputStream()) { o.write(body); }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String s = in == null ? "" : new String(EverywhereOutbox.readAll(in), StandardCharsets.UTF_8);
        c.disconnect();
        if (code >= 400) throw new IOException(code == 403 ? "Wizard sign-in needed" : "Wizard Search answered " + code);
        return s;
    }

    private void translate(String id, String itemsJson) {
        io.execute(() -> {
            String reply;
            try {
                JSONArray items = new JSONArray(itemsJson);
                JSONObject body = new JSONObject().put("items", items).put("to", "English");
                JSONObject r = new JSONObject(post("/wizard-search/api/translate", body.toString().getBytes(StandardCharsets.UTF_8), "application/json"));
                reply = r.toString();
                Log.i(TAG, "screen translate items=" + items.length() + " ms=" + r.optInt("ms"));
            } catch (Exception e) {
                Log.w(TAG, "screen translate failed: " + e.getMessage());
                reply = "{\"error\":" + JSONObject.quote(friendly(e)) + "}";
            }
            js("S.translated(" + JSONObject.quote(id) + "," + reply + ")");
        });
    }

    private void picture(String id) {
        final byte[] img = shot;
        io.execute(() -> {
            String reply;
            if (img == null || img.length == 0) reply = "{\"error\":\"This screen blocked capture, so there is no picture to read\"}";
            else try {
                JSONObject r = new JSONObject(post("/wizard-search/api/read-image", img, "image/jpeg"));
                reply = r.toString();
                Log.i(TAG, "screen picture lines=" + (r.optJSONArray("lines") == null ? 0 : r.optJSONArray("lines").length()));
            } catch (Exception e) {
                Log.w(TAG, "screen picture failed: " + e.getMessage());
                reply = "{\"error\":" + JSONObject.quote(friendly(e)) + "}";
            }
            js("S.pictured(" + JSONObject.quote(id) + "," + reply + ")");
        });
    }

    private static String friendly(Exception e) {
        String m = e.getMessage();
        if (e instanceof java.net.UnknownHostException || e instanceof java.net.ConnectException || e instanceof java.net.SocketTimeoutException)
            return "Couldn’t reach Wizard · check Tailscale";
        return m == null || m.isEmpty() ? "Something went wrong" : m;
    }

    /* ------------------------------------------------------------------ Copy · Ask Wizard */

    private void copy(String text) {
        ClipboardManager cm = ctx.getSystemService(ClipboardManager.class);
        if (cm == null) return;
        cm.setPrimaryClip(ClipData.newPlainText("Wizard", text));
        Log.i(TAG, "screen copied chars=" + text.length());
    }

    /** Ask Wizard: the selection (quoted) and the frozen screen, opened in Wizard OS's share sheet to add a question. */
    private void ask(String text) {
        byte[] img = shot;
        String quoted = "";
        for (String line : ScreenPolicy.clipContext(text, 6000).split("\n")) quoted += "> " + line + "\n";
        try {
            String id = ai.wizards.os.share.ShareStore.stage(ctx, quoted + "\n", img);
            Intent i = new Intent(ctx, ai.wizards.os.MainActivity.class).setAction(ai.wizards.os.device.DeviceBridge.ACTION_SHARE)
                    .putExtra(ai.wizards.os.device.DeviceBridge.EXTRA_SHARE, id)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent.getActivity(ctx, 42, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE).send();
            Log.i(TAG, "screen ask staged " + id + " chars=" + text.length() + " shot=" + (img == null ? 0 : img.length));
            close();
        } catch (Exception e) {
            Log.w(TAG, "screen ask failed", e);
            Toast.makeText(ctx, "Couldn’t open Wizard OS", Toast.LENGTH_SHORT).show();
        }
    }

    /* ------------------------------------------------------------------ the page's bridge (binder thread) */

    private final class Bridge {
        @JavascriptInterface public void close() { main.post(ScreenMode.this::close); }
        @JavascriptInterface public void copy(String t) { main.post(() -> ScreenMode.this.copy(String.valueOf(t))); }
        @JavascriptInterface public void search(String q, float frac) { main.post(() -> showSearch(String.valueOf(q), frac)); }
        @JavascriptInterface public void sheet(float frac) { main.post(() -> { if (search != null && searchFrac > 0) showSearch(searchQuery(), frac); }); }
        @JavascriptInterface public void closeSearch() { main.post(ScreenMode.this::hideSearch); }
        @JavascriptInterface public void translate(String id, String items) { ScreenMode.this.translate(String.valueOf(id), String.valueOf(items)); }
        @JavascriptInterface public void picture(String id) { ScreenMode.this.picture(String.valueOf(id)); }
        @JavascriptInterface public void ask(String t) { main.post(() -> ScreenMode.this.ask(String.valueOf(t))); }
        @JavascriptInterface public String shot() { byte[] b = shot; return b == null ? "" : Base64.encodeToString(b, Base64.NO_WRAP); }
        @JavascriptInterface public void log(String s) { Log.i(TAG, "screen page: " + s); }
    }

    private String searchQuery() {
        if (search == null || search.getUrl() == null) return "";
        String q = Uri.parse(search.getUrl()).getQueryParameter("q");
        return q == null ? "" : q;
    }
}
