package ai.wizards.os.everywhere;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

import ai.wizards.os.MainActivity;
import ai.wizards.os.assist.SilenceDetector;

/**
 * Wizard Everywhere: the floating Wizard orb (formerly Archimedes Anywhere) inside Wizard OS.
 *
 *  - The same orb as the app (web/orb.js, drawn in assets/assist/everywhere.html), not a portrait.
 *  - Switched on in Wizard OS → Settings. Floats over other apps and the home screen, bottom right by default;
 *    drag to move, it snaps to the nearer edge and remembers where you left it — one place with the keyboard
 *    closed and another with it open.
 *  - Hidden whenever Wizard OS itself is in front (the app has its own orb); back as soon as you leave.
 *  - Tap to talk. While it listens, Cancel · Pause · Screen fan out around it, like the app's orb. Tap the orb
 *    again (or just stop talking) to send. The recording goes into {@link EverywhereOutbox} before any network
 *    call, so a dropped connection never loses it.
 *  - With a keyboard open it becomes voice typing: tap, talk, and the words are typed where the cursor is
 *    (needs Accessibility → Wizard OS, see {@link WizardKeyboardService}). Nothing goes to Wizard.
 *  - "Not sent" raises a notification with Retry; replies raise a notification that opens the thread.
 */
public class EverywhereService extends Service implements EverywhereOutbox.Listener {
    static final String TAG = EverywhereOutbox.TAG;
    public static final String PREFS = "everywhere";
    static final String KEY_ENABLED = "enabled";
    static final String ACTION_START = "ai.wizards.os.everywhere.START";
    static final String ACTION_STOP = "ai.wizards.os.everywhere.STOP";
    static final String ACTION_FRONT = "ai.wizards.os.everywhere.FRONT";
    static final String ACTION_RETRY = "ai.wizards.os.everywhere.RETRY";
    static final String ACTION_KEYBOARD = "ai.wizards.os.everywhere.KEYBOARD";
    static final String EXTRA_FRONT = "front", EXTRA_KB = "kb", EXTRA_IME_TOP = "imeTop";
    static final String CH_RUNNING = "everywhere";
    static final String CH_UNSENT = "unsent";
    static final String CH_REPLIES = "replies";
    static final int N_RUNNING = 7101, N_UNSENT = 7102, N_APP_UNSENT = 7103, N_REPLY_BASE = 7200;
    static final int ORB_DP = 88, EXPANDED_DP = 270, MARGIN_DP = 4;
    static final int MAX_SHOTS = 4;

    private static boolean appInFront;
    private static boolean keyboardOpen;
    private static int imeTop = -1;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private WebView web;
    private boolean pageReady;
    private WindowManager.LayoutParams lp;
    private boolean attached, expanded;
    private EverywhereOutbox outbox;
    private MediaRecorder recorder;
    private File recording;
    private SilenceDetector detector;
    private boolean listening, paused, dictating;
    private long startedAt;
    private int size, big, margin;
    private float density;
    /** Centre of the orb on screen; the window is placed around it. */
    private int cx = -1, cy = -1;
    private final List<byte[]> shots = new ArrayList<>();
    private String lastState = "";

    /* ------------------------------------------------------------------ static API (MainActivity / Settings) */

    public static boolean enabled(Context c) { return prefs(c).getBoolean(KEY_ENABLED, false); }

    public static boolean overlayAllowed(Context c) { return Settings.canDrawOverlays(c); }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE); }

    /** Turn the orb on/off. Returns what is still missing ("overlay"), or "" when it is running. */
    public static String setEnabled(Context c, boolean on) {
        prefs(c).edit().putBoolean(KEY_ENABLED, on).apply();
        if (!on) { c.startService(new Intent(c, EverywhereService.class).setAction(ACTION_STOP)); return ""; }
        if (!overlayAllowed(c)) return "overlay";
        ensureRunning(c);
        return "";
    }

    public static void ensureRunning(Context c) {
        if (!enabled(c) || !overlayAllowed(c)) return;
        try { c.startForegroundService(new Intent(c, EverywhereService.class).setAction(ACTION_START)); }
        catch (Exception e) { Log.w(TAG, "could not start Everywhere: " + e.getMessage()); }
    }

    /** Wizard OS tells the orb when it comes to the front / leaves, so the orb hides while the app is open. */
    public static void setAppInFront(Context c, boolean front) {
        appInFront = front;
        if (!enabled(c) || !overlayAllowed(c)) return;
        try { c.startService(new Intent(c, EverywhereService.class).setAction(ACTION_FRONT).putExtra(EXTRA_FRONT, front)); }
        catch (Exception e) { // background start refused (rare): the foreground start path still works
            if (!front) ensureRunning(c);
        }
    }

    /** The keyboard service reports the on-screen keyboard coming and going. */
    static void keyboardChanged(Context c, boolean open, int top) {
        keyboardOpen = open;
        if (top >= 0) imeTop = top;
        if (!enabled(c) || !overlayAllowed(c)) return;
        try { c.startService(new Intent(c, EverywhereService.class).setAction(ACTION_KEYBOARD).putExtra(EXTRA_KB, open).putExtra(EXTRA_IME_TOP, top)); }
        catch (Exception e) { Log.w(TAG, "keyboard update refused: " + e.getMessage()); }
    }

    /** JSON for Settings. */
    public static String status(Context c) {
        boolean notif = canNotify(c);
        boolean mic = c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        return "{\"enabled\":" + enabled(c) + ",\"overlay\":" + overlayAllowed(c) + ",\"notifications\":" + notif + ",\"mic\":" + mic
                + ",\"keyboard\":" + WizardKeyboardService.enabled(c) + ",\"keyboardLive\":" + (WizardKeyboardService.get() != null) + "}";
    }

    /** The web outbox reports its own "not sent" count, so a failure in the app is noticed after leaving it. */
    public static void appUnsent(Context c, int failed, String firstText) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        channels(c);
        if (failed <= 0) { nm.cancel(N_APP_UNSENT); return; }
        if (!canNotify(c)) return;
        String title = failed == 1 ? "1 message not sent" : failed + " messages not sent";
        Notification n = new Notification.Builder(c, CH_UNSENT)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(title)
                .setContentText(EverywherePolicy.clip(firstText, 90))
                .setContentIntent(openApp(c, MainActivity.ACTION_UNSENT, 1))
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .build();
        nm.notify(N_APP_UNSENT, n);
    }

    static boolean canNotify(Context c) {
        return Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static PendingIntent openApp(Context c, String action, int req) { return openApp(c, action, req, null); }

    static PendingIntent openApp(Context c, String action, int req, String thread) {
        Intent i = new Intent(c, MainActivity.class).setAction(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (thread != null) i.putExtra(MainActivity.EXTRA_THREAD, thread);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_RUNNING) != null) return;
        NotificationChannel run = new NotificationChannel(CH_RUNNING, "Wizard Everywhere", NotificationManager.IMPORTANCE_MIN);
        run.setDescription("Keeps the floating Wizard orb available over other apps");
        run.setShowBadge(false);
        NotificationChannel uns = new NotificationChannel(CH_UNSENT, "Not sent", NotificationManager.IMPORTANCE_HIGH);
        uns.setDescription("Messages that could not reach Wizard, with Retry");
        NotificationChannel rep = new NotificationChannel(CH_REPLIES, "Replies", NotificationManager.IMPORTANCE_DEFAULT);
        rep.setDescription("Wizard answered something you said to the orb or the side button");
        nm.createNotificationChannel(run);
        nm.createNotificationChannel(uns);
        nm.createNotificationChannel(rep);
    }

    /** "Not sent": raised by the outbox itself, so it works for the side button too, with or without the orb. */
    static void notifyFailed(Context c, EverywhereOutbox ob, EverywhereOutbox.Item it) {
        channels(c);
        if (!canNotify(c)) return;
        int n = 0;
        for (EverywhereOutbox.Item x : ob.unsent()) if ("failed".equals(x.state)) n++;
        PendingIntent retry = PendingIntent.getBroadcast(c, 5,
                new Intent(c, RetryReceiver.class).setAction(ACTION_RETRY), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification note = new Notification.Builder(c, CH_UNSENT)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(n > 1 ? n + " messages not sent" : "Not sent · " + it.error)
                .setContentText(EverywherePolicy.clip(it.text.isEmpty() ? "Voice note (kept on this phone)" : it.text, 90))
                .setContentIntent(openApp(c, MainActivity.ACTION_UNSENT, 6))
                .addAction(new Notification.Action.Builder(null, "Retry", retry).build())
                .addAction(new Notification.Action.Builder(null, "See all", openApp(c, MainActivity.ACTION_UNSENT, 7)).build())
                .setAutoCancel(true)
                .build();
        c.getSystemService(NotificationManager.class).notify(N_UNSENT, note);
    }

    static void clearFailed(Context c, EverywhereOutbox ob) {
        for (EverywhereOutbox.Item it : ob.unsent()) if ("failed".equals(it.state)) return;
        c.getSystemService(NotificationManager.class).cancel(N_UNSENT);
    }

    /** The answer is ready: a notification that opens the thread (not while Wizard OS is in front). */
    static void notifyReply(Context c, EverywhereOutbox.Item it, String text) {
        channels(c);
        if (!canNotify(c) || appInFront || it.dictation()) return;
        Notification note = new Notification.Builder(c, CH_REPLIES)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("Archimedes · " + EverywherePolicy.clip(it.text, 50))
                .setContentText(EverywherePolicy.clip(text, 140))
                .setStyle(new Notification.BigTextStyle().bigText(EverywherePolicy.clip(text, 600)))
                .setContentIntent(openApp(c, MainActivity.ACTION_THREAD, 100 + (it.id.hashCode() & 0xffff), it.sessionId))
                .setAutoCancel(true)
                .build();
        c.getSystemService(NotificationManager.class).notify(N_REPLY_BASE + (it.id.hashCode() & 0xff), note);
    }

    /* ------------------------------------------------------------------ lifecycle */

    @Override
    public void onCreate() {
        super.onCreate();
        wm = getSystemService(WindowManager.class);
        density = getResources().getDisplayMetrics().density;
        size = Math.round(ORB_DP * density);
        big = Math.round(EXPANDED_DP * density);
        margin = Math.round(MARGIN_DP * density);
        channels(this);
        outbox = EverywhereOutbox.get(this);
        outbox.addListener(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? ACTION_START : String.valueOf(intent.getAction());
        if (!startForegroundSafe(listening)) { stopSelf(); return START_NOT_STICKY; }
        if (ACTION_STOP.equals(a) || !enabled(this) || !overlayAllowed(this)) { shutdown(); return START_NOT_STICKY; }
        if (ACTION_FRONT.equals(a)) appInFront = intent.getBooleanExtra(EXTRA_FRONT, appInFront);
        if (ACTION_RETRY.equals(a)) { outbox.retry("*"); getSystemService(NotificationManager.class).cancel(N_UNSENT); }
        if (ACTION_KEYBOARD.equals(a)) {
            keyboardOpen = intent.getBooleanExtra(EXTRA_KB, keyboardOpen);
            int t = intent.getIntExtra(EXTRA_IME_TOP, -1);
            if (t >= 0) imeTop = t;
            onKeyboard();
        }
        syncBubble();
        outbox.pump();
        return START_STICKY;
    }

    private boolean startForegroundSafe(boolean mic) {
        Notification n = new Notification.Builder(this, CH_RUNNING)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(listening ? (dictating ? "Typing what you say…" : "Listening…") : "Wizard Everywhere is on")
                .setContentText(listening ? "Tap the orb to finish" : "Tap the floating orb to talk")
                .setContentIntent(openApp(this, MainActivity.ACTION_SETTINGS, 2))
                .setOngoing(true)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE | (mic ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
                startForeground(N_RUNNING, n, type);
            } else if (Build.VERSION.SDK_INT >= 30) {
                startForeground(N_RUNNING, n, mic ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : ServiceInfo.FOREGROUND_SERVICE_TYPE_NONE);
            } else {
                startForeground(N_RUNNING, n);
            }
            return true;
        } catch (Exception e) {
            Log.w(TAG, "foreground start refused: " + e.getMessage());
            return false;
        }
    }

    private void shutdown() {
        discard();
        detach();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        outbox.removeListener(this);
        discard();
        detach();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        cx = -1; // rotation / split screen: re-read the saved spot for this shape of screen and clamp it
        if (attached) place();
    }

    /* ------------------------------------------------------------------ the orb window */

    private void syncBubble() {
        boolean show = EverywherePolicy.bubbleVisible(enabled(this), overlayAllowed(this), appInFront) || listening;
        if (show) attach(); else detach();
        Log.i(TAG, "bubble " + (show ? "shown" : "hidden") + " (appInFront=" + appInFront + ", keyboard=" + keyboardOpen + ")");
    }

    @SuppressLint({"ClickableViewAccessibility", "SetJavaScriptEnabled", "JavascriptInterface"})
    private void attach() {
        if (attached) { pushState(); return; }
        if (web == null) {
            web = new WebView(this);
            web.setBackgroundColor(Color.TRANSPARENT);
            web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            web.setVerticalScrollBarEnabled(false);
            web.setHorizontalScrollBarEnabled(false);
            web.setOverScrollMode(View.OVER_SCROLL_NEVER);
            web.setContentDescription("Wizard Everywhere. Tap to talk, drag to move.");
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setAllowFileAccess(true); // only file:///android_asset/assist/ is served; everything else is blocked
            s.setBlockNetworkLoads(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            web.addJavascriptInterface(new Bridge(), "EverywhereNative");
            web.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                    if (r.getUrl().toString().startsWith("file:///android_asset/assist/")) return null;
                    return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", null, new ByteArrayInputStream(new byte[0]));
                }
                @Override public void onPageFinished(WebView v, String url) { pageReady = true; place(); lastState = ""; pushState(); }
            });
            web.setOnTouchListener(new Touch());
            web.loadUrl("file:///android_asset/assist/everywhere.html");
        }
        lp = new WindowManager.LayoutParams(size, size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.setTitle("WizardEverywhere");
        cx = -1;
        place();
        try {
            wm.addView(web, lp);
            attached = true;
            lastState = "";
            pushState();
        } catch (Exception e) {
            Log.w(TAG, "overlay refused: " + e.getMessage());
        }
    }

    private void detach() {
        if (!attached || web == null) return;
        try { wm.removeViewImmediate(web); } catch (Exception ignored) { }
        attached = false;
    }

    private Point screen() {
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Rect b = wm.getCurrentWindowMetrics().getBounds();
            return new Point(b.width(), b.height());
        }
        android.util.DisplayMetrics m = getResources().getDisplayMetrics();
        return new Point(m.widthPixels, m.heightPixels);
    }

    /** Which saved spot is in use: one for "keyboard open", one for everything else. */
    private String slot() { return keyboardOpen ? "kb" : ""; }

    /** Orb top-left from the saved spot for the current context (or the default), clamped to the screen. */
    private int[] savedSpot() {
        Point s = screen();
        String k = slot();
        SharedPreferences p = prefs(this);
        int[] def;
        if (keyboardOpen) {
            // First time over a keyboard: just above it on the same side, so it never covers the keys.
            int top = imeTop > 0 ? imeTop : Math.round(s.y * 0.55f);
            int side = p.contains("x") ? p.getInt("x", s.x) : s.x;
            def = EverywherePolicy.snap(side, top - size - margin * 2, size, s.x, s.y, margin);
        } else {
            def = EverywherePolicy.defaultPosition(size, s.x, s.y, margin);
        }
        int x = p.contains(k + "x") ? p.getInt(k + "x", def[0]) : def[0];
        int y = p.contains(k + "y") ? p.getInt(k + "y", def[1]) : def[1];
        if (keyboardOpen && !p.contains(k + "y") && imeTop > 0) y = Math.min(y, imeTop - size - margin);
        return EverywherePolicy.clamp(x, y, size, s.x, s.y, margin);
    }

    /** Lay the window out around the orb centre: small when idle, large (room for the controls) while listening. */
    private void place() {
        if (lp == null) return;
        if (cx < 0) { int[] p = savedSpot(); cx = p[0] + size / 2; cy = p[1] + size / 2; }
        Point s = screen();
        int w = expanded ? big : size;
        int dx = cx > s.x / 2 ? -1 : 1, dy = cy > s.y * 0.42f ? -1 : 1;  // controls fan towards the middle
        int ox = expanded ? (dx < 0 ? w - size / 2 : size / 2) : size / 2;
        int oy = expanded ? (dy < 0 ? w - size / 2 : size / 2) : size / 2;
        int wx = Math.max(0, Math.min(s.x - w, cx - ox)), wy = Math.max(0, Math.min(s.y - w, cy - oy));
        if (!expanded) { wx = cx - size / 2; wy = cy - size / 2; }
        lp.width = w; lp.height = w; lp.x = wx; lp.y = wy;
        if (attached) try { wm.updateViewLayout(web, lp); } catch (Exception ignored) { }
        js("E.layout({ox:" + px(cx - wx) + ",oy:" + px(cy - wy) + ",dx:" + dx + ",dy:" + dy + "})");
    }

    private float px(int p) { return p / density; }

    private void setExpanded(boolean on) {
        if (expanded == on) return;
        expanded = on;
        place();
    }

    private void onKeyboard() {
        if (listening) { pushState(); return; }  // never jump away mid-recording; the new spot applies after
        cx = -1;
        if (attached) place();
        pushState();
    }

    private void pushState() {
        if (!pageReady) return;
        int failed = 0;
        for (EverywhereOutbox.Item it : outbox.unsent()) if ("failed".equals(it.state)) failed++;
        String mode = listening ? (paused ? "paused" : dictating ? "typing" : "listen") : keyboardOpen ? "type" : "idle";
        String st = "{mode:'" + mode + "',kb:" + (keyboardOpen || dictating) + ",expanded:" + expanded + ",failed:" + failed + ",shots:" + shots.size() + "}";
        if (st.equals(lastState)) return;
        lastState = st;
        js("E.state(" + st + ")");
    }

    private void js(String code) {
        if (web == null || !pageReady) return;
        main.post(() -> { if (web != null) web.evaluateJavascript("try{" + code + "}catch(e){}", null); });
    }

    /** Touches on the orb: tap = talk / finish, drag = move. Anything else (the controls) goes to the page. */
    private final class Touch implements View.OnTouchListener {
        float downX, downY; int startCx, startCy; boolean mine, moved;
        final int slop = ViewConfiguration.get(EverywhereService.this).getScaledTouchSlop();

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: {
                    int ox = cx - lp.x, oy = cy - lp.y;
                    mine = Math.hypot(e.getX() - ox, e.getY() - oy) <= size * 0.5f;
                    if (!mine) return false;
                    downX = e.getRawX(); downY = e.getRawY(); startCx = cx; startCy = cy; moved = false;
                    return true;
                }
                case MotionEvent.ACTION_MOVE: {
                    if (!mine) return false;
                    float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                    if (!moved && Math.hypot(dx, dy) < slop * 1.5) return true;
                    moved = true;
                    Point s = screen();
                    int[] p = EverywherePolicy.clamp(startCx - size / 2 + Math.round(dx), startCy - size / 2 + Math.round(dy), size, s.x, s.y, margin);
                    cx = p[0] + size / 2; cy = p[1] + size / 2;
                    if (expanded) { setExpanded(false); }
                    lp.x = p[0]; lp.y = p[1];
                    if (attached) try { wm.updateViewLayout(web, lp); } catch (Exception ignored) { }
                    return true;
                }
                case MotionEvent.ACTION_UP: {
                    if (!mine) return false;
                    mine = false;
                    if (moved) {
                        Point sc = screen();
                        int[] q = EverywherePolicy.snap(cx - size / 2, cy - size / 2, size, sc.x, sc.y, margin);
                        cx = q[0] + size / 2; cy = q[1] + size / 2;
                        String k = slot();
                        prefs(EverywhereService.this).edit().putInt(k + "x", q[0]).putInt(k + "y", q[1]).apply();
                        Log.i(TAG, "moved to " + q[0] + "," + q[1] + (keyboardOpen ? " (keyboard)" : ""));
                        if (listening) setExpanded(true); else place();
                    } else {
                        v.performClick();
                        tap();
                    }
                    return true;
                }
                case MotionEvent.ACTION_CANCEL:
                    boolean was = mine; mine = false; return was;
                default:
                    return mine;
            }
        }
    }

    /** The page's buttons (Cancel · Pause · Screen). Called on a binder thread. */
    private final class Bridge {
        @JavascriptInterface public void cancel() { main.post(EverywhereService.this::cancelByUser); }
        @JavascriptInterface public void pause() { main.post(EverywhereService.this::togglePause); }
        @JavascriptInterface public void shot() { main.post(EverywhereService.this::screenshot); }
        @JavascriptInterface public void log(String s) { Log.i(TAG, "page: " + s); }
    }

    private void tap() {
        buzz(12);
        if (listening) { finish(); return; }
        WizardKeyboardService k = WizardKeyboardService.get();
        boolean dictate = KeyboardSignal.dictate(k != null && k.inputActiveNow(), keyboardOpen);
        start(dictate);
    }

    /* ------------------------------------------------------------------ recording */

    private void start(boolean dictate) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Open Wizard OS once and allow the microphone", Toast.LENGTH_LONG).show();
            try { openApp(this, MainActivity.ACTION_SETTINGS, 4).send(); } catch (PendingIntent.CanceledException ignored) { }
            return;
        }
        listening = true; // the foreground notification and the window both read it
        if (!startForegroundSafe(true)) {
            listening = false;
            Toast.makeText(this, "Android blocked the microphone. Open Wizard OS and try again.", Toast.LENGTH_LONG).show();
            return;
        }
        File qa = qaAudio(); // debug builds on the emulator (no microphone): a staged recording, used once
        if (qa != null) recording = qa;
        else try {
            recording = new File(getCacheDir(), "everywhere-" + SystemClock.elapsedRealtime() + ".m4a");
            MediaRecorder r = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            r.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION);
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            r.setAudioChannels(1);
            r.setAudioSamplingRate(32000);
            r.setAudioEncodingBitRate(64000);
            r.setOutputFile(recording.getAbsolutePath());
            r.prepare();
            r.start();
            recorder = r;
        } catch (Exception e) {
            Log.w(TAG, "recorder failed", e);
            dropRecorder();
            listening = false;
            Toast.makeText(this, "The microphone is busy. Try again in a moment.", Toast.LENGTH_SHORT).show();
            startForegroundSafe(false);
            return;
        }
        dictating = dictate;
        paused = false;
        shots.clear();
        startedAt = SystemClock.elapsedRealtime();
        detector = dictate ? SilenceDetector.dictation() : SilenceDetector.standard();
        Log.i(TAG, "listening" + (dictate ? " (voice typing)" : ""));
        setExpanded(true);
        pushState();
        main.post(meter);
        if (recorder == null) main.postDelayed(qaAutoFinish, 2500); // QA canned audio
    }

    /** QA builds: the staged recording finishes by itself after 2.5 s of not being paused. */
    private final Runnable qaAutoFinish = new Runnable() {
        @Override public void run() {
            if (!listening) return;
            if (paused) { main.postDelayed(this, 500); return; }
            finish();
        }
    };

    private final Runnable meter = new Runnable() {
        @Override
        public void run() {
            if (!listening) return;
            int amp = 0;
            if (recorder != null) {
                try { amp = recorder.getMaxAmplitude(); } catch (IllegalStateException e) { return; }
                if (!paused) {
                    SilenceDetector.Result res = detector.feed(amp, SystemClock.elapsedRealtime());
                    if (res == SilenceDetector.Result.SEND) { finish(); return; }
                    if (res == SilenceDetector.Result.NOTHING_HEARD) { discard(); toast("Didn’t catch anything"); return; }
                }
            }
            js("E.level(" + (paused ? 0 : Math.min(1f, amp / 12000f)) + ")");
            main.postDelayed(this, 90);
        }
    };

    private void togglePause() {
        if (!listening) return;
        long now = SystemClock.elapsedRealtime();
        if (!paused) {
            if (recorder != null) try { recorder.pause(); } catch (IllegalStateException e) { Log.w(TAG, "pause failed", e); return; }
            paused = true;
            detector.pause(now);
        } else {
            if (recorder != null) try { recorder.resume(); } catch (IllegalStateException e) { Log.w(TAG, "resume failed", e); return; }
            paused = false;
            detector.resume(now);
            if (recorder == null) { main.removeCallbacks(qaAutoFinish); main.postDelayed(qaAutoFinish, 2500); } // QA: 2.5 s more after carrying on
        }
        Log.i(TAG, paused ? "paused" : "resumed");
        buzz(10);
        pushState();
    }

    private void cancelByUser() {
        if (!listening) return;
        Log.i(TAG, "cancelled");
        discard();
        buzz(14);
        toast("Discarded");
    }

    /** Screen: hide the orb, capture what is behind it, attach it to this message (up to four). */
    private boolean shotPending, finishAfterShot;

    private void screenshot() {
        Log.i(TAG, "screenshot requested listening=" + listening + " dictating=" + dictating);
        if (!listening || dictating || shotPending) return;
        if (shots.size() >= MAX_SHOTS) { toast("Four screenshots already attached"); return; }
        WizardKeyboardService k = WizardKeyboardService.get();
        if (k == null || Build.VERSION.SDK_INT < 30) {
            Toast.makeText(this, "Turn on Accessibility → Wizard OS to attach screenshots", Toast.LENGTH_LONG).show();
            return;
        }
        if (web != null) web.setAlpha(0f);
        shotPending = true;
        main.postDelayed(() -> k.screenshot(png -> main.post(() -> {
            shotPending = false;
            if (web != null) web.setAlpha(1f);
            if (!listening) return;
            if (png == null || png.length == 0) { Log.w(TAG, "screenshot empty"); toast("This screen blocked capture"); }
            else {
                shots.add(png);
                Log.i(TAG, "screenshot attached " + shots.size() + " bytes=" + png.length);
                toast("Screenshot attached (" + shots.size() + "/" + MAX_SHOTS + ")");
            }
            pushState();
            if (finishAfterShot) { finishAfterShot = false; finish(); }
        })), 160);
    }

    private void finish() {
        if (!listening) return;
        if (shotPending) { finishAfterShot = true; return; } // the screenshot being taken rides along
        if (paused && recorder != null) try { recorder.resume(); } catch (IllegalStateException ignored) { }
        listening = false; paused = false;
        main.removeCallbacks(meter);
        main.removeCallbacks(qaAutoFinish);
        boolean ok = true;
        MediaRecorder r = recorder;
        recorder = null;
        if (r != null) {
            try { r.stop(); } catch (RuntimeException e) { ok = false; }
            r.release();
        }
        File f = recording;
        recording = null;
        final boolean dict = dictating;
        List<byte[]> attach = new ArrayList<>(shots);
        shots.clear();
        setExpanded(false);
        startForegroundSafe(false);
        if (!ok || f == null || !f.isFile() || f.length() < 512) {
            if (f != null) //noinspection ResultOfMethodCallIgnored
                f.delete();
            toast("Didn’t catch anything");
            dictating = false;
            pushState();
            return;
        }
        try {
            // Saved on the phone before any network call.
            outbox.enqueueRecording(f, dict ? EverywhereOutbox.SRC_DICTATION : EverywhereOutbox.SRC_EVERYWHERE, attach);
            buzz(20);
            if (!dict) toast(attach.isEmpty() ? "Sending to Wizard…" : "Sending to Wizard with " + attach.size() + " screenshot" + (attach.size() == 1 ? "" : "s") + "…");
        } catch (Exception e) {
            Log.e(TAG, "could not keep the recording", e);
            toast("Couldn’t save that recording");
        }
        dictating = false;
        pushState();
        syncBubble();
    }

    private void discard() {
        listening = false; paused = false; dictating = false; finishAfterShot = false;
        main.removeCallbacks(meter);
        main.removeCallbacks(qaAutoFinish);
        dropRecorder();
        if (recording != null) //noinspection ResultOfMethodCallIgnored
            recording.delete();
        recording = null;
        shots.clear();
        if (lp != null) setExpanded(false);
        startForegroundSafe(false);
        pushState();
    }

    private void dropRecorder() {
        if (recorder == null) return;
        try { recorder.stop(); } catch (RuntimeException ignored) { }
        recorder.release();
        recorder = null;
    }

    /** Debug builds only: files/qa_next.m4a stands in for the emulator's missing microphone; used once. */
    private File qaAudio() {
        if (!ai.wizards.os.BuildConfig.DEBUG) return null;
        File f = new File(getFilesDir(), "qa_next.m4a");
        if (!f.isFile()) return null;
        File copy = new File(getCacheDir(), "everywhere-qa-" + SystemClock.elapsedRealtime() + ".m4a");
        return f.renameTo(copy) ? copy : null;
    }

    /* ------------------------------------------------------------------ outbox events */

    @Override
    public void onOutboxChanged() {
        pushState();
        MainActivity.notifyUnsentChanged();
        clearFailed(this, outbox);
    }

    @Override
    public void onFailed(EverywhereOutbox.Item it) {
        if (!canNotify(this)) toast("Not sent: " + it.error);
    }

    @Override
    public void onSent(EverywhereOutbox.Item it) {
        if (EverywhereOutbox.SRC_EVERYWHERE.equals(it.source)) toast("Sent to Wizard");
    }

    /** Voice typing: type the words where the cursor is; if no field takes them, they're on the clipboard. */
    @Override
    public void onDictated(EverywhereOutbox.Item it, String words) {
        boolean fresh = System.currentTimeMillis() - it.createdAt < 3 * 60_000L;
        WizardKeyboardService k = WizardKeyboardService.get();
        boolean typed = fresh && k != null && k.insertText(words);
        if (!typed) {
            ClipboardManager cb = getSystemService(ClipboardManager.class);
            cb.setPrimaryClip(ClipData.newPlainText("Wizard", words.trim()));
            toast(k == null ? "Copied · turn on Accessibility → Wizard OS to type it for you" : "Copied · paste it where you want it");
        }
        Log.i(TAG, "dictation " + (typed ? "typed" : "copied") + " chars=" + words.length());
        buzz(typed ? 18 : 30);
    }

    /* ------------------------------------------------------------------ util */

    private void toast(String s) { main.post(() -> Toast.makeText(this, s, Toast.LENGTH_SHORT).show()); }

    private void buzz(int ms) {
        Vibrator v = getSystemService(Vibrator.class);
        if (v != null && v.hasVibrator()) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
    }

    /** "Retry" on a Not-sent notification: works whether or not the floating orb is switched on. */
    public static final class RetryReceiver extends android.content.BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent i) {
            EverywhereOutbox ob = EverywhereOutbox.get(c);
            ob.retry("*");
            c.getSystemService(NotificationManager.class).cancel(N_UNSENT);
        }
    }

    static String quote(String s) { return JSONObject.quote(s == null ? "" : s); }
}
