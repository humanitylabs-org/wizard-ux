package ai.wizards.shell.orb;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Collections;

import ai.wizards.shell.ShellOrigin;
import ai.wizards.shell.device.DevicePort;
import ai.wizards.shell.recorder.RecorderService;

/**
 * The floating orb (device.orb): a small overlay over other apps while the Wizard app is not in front.
 * Tap talks to the Wizard (a device.recording take marked "send"; tap again to send), drag moves it, a long hold
 * pauses the current take without hiding it. Its web page owns Cancel / Pause / Resume (remote with a bundled
 * 1.5 s fallback); an exact-origin main-frame message port exposes only those take-bound device operations.
 */
public class OrbService extends Service {
    static final String TAG = OrbPage.TAG;
    private static final String CHANNEL = "orb";
    private static final String ACTION_SYNC = "ai.wizards.shell.orb.SYNC", ACTION_HIDE = "ai.wizards.shell.orb.HIDE";
    private static final String PREFS = "orb";
    private static final int N_ORB = 4201;
    private static volatile boolean appFront;
    private static volatile OrbService live;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private WindowManager wm;
    private WebView web;
    private OrbPage page;
    private WindowManager.LayoutParams lp;
    private boolean attached, pageReady;
    private boolean closing, busy, controlTouch, controlsReady, pauseOnStart;
    private String pageOwner;
    private String take; // the take this orb is recording, if any
    private int size, margin;
    private String lastState = "";

    /* ------------------------------------------------------------------ API */

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE); }
    public static boolean wanted(Context c) { return prefs(c).getBoolean("on", false); }
    public static boolean permitted(Context c) { return Settings.canDrawOverlays(c); }
    public static boolean running() { return live != null; }
    public static boolean visible() { OrbService s = live; return s != null && s.attached; }

    /** The owner turned the orb on or off (from the Wizard's Settings). Call from a foreground context. */
    public static void setWanted(Context c, boolean on) {
        prefs(c).edit().putBoolean("on", on).apply();
        sync(c);
    }

    /** ShellActivity start/stop: the orb hides while the Wizard app is in front. */
    public static void appFront(Context c, boolean front) {
        appFront = front;
        if (front) sync(c); // start (or refresh) only from the foreground, where Android allows it
        else { OrbService s = live; if (s != null) s.main.post(s::place); }
    }

    /** A pinned home-screen app came to the front (its own task): the orb stays over it, as over any other app. */
    public static void refresh(Context c) { sync(c); }

    private static void sync(Context c) {
        boolean on = wanted(c) && permitted(c) && ShellOrigin.selected(c) != null;
        if (!on) { OrbService s = live; if (s != null) s.main.post(s::shutdown); return; }
        try { c.startForegroundService(new Intent(c, OrbService.class).setAction(ACTION_SYNC)); }
        catch (RuntimeException e) { Log.w(TAG, "start: " + e); }
    }

    /* ------------------------------------------------------------------ service */

    @Override public void onCreate() {
        super.onCreate();
        live = this;
        wm = getSystemService(WindowManager.class);
        size = dp(64);
        margin = dp(8);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Floating orb", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Keeps the Wizard orb over your other apps");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!foreground()) { stopSelf(); return START_NOT_STICKY; }
        if (intent != null && ACTION_HIDE.equals(intent.getAction())) { hide("notification"); return START_NOT_STICKY; }
        if (!wanted(this) || !permitted(this) || ShellOrigin.selected(this) == null) { shutdown(); return START_NOT_STICKY; }
        place();
        return START_STICKY;
    }

    /** Attach while the Wizard app is not in front, detach while it is. */
    private void place() {
        if (live != this) return;
        if (web != null && !String.valueOf(pageOwner).equals(ShellOrigin.selected(this))) {
            stopOwnedTake();
            detach(); page.close(); web.destroy(); web = null; pageReady = false; controlsReady = false;
        }
        if (appFront) { detach(); return; }
        attach();
    }

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    private void attach() {
        if (attached) return;
        if (web == null) {
            web = new WebView(this);
            web.setBackgroundColor(Color.TRANSPARENT);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(false);
            s.setMediaPlaybackRequiresUserGesture(true);
            s.setSupportMultipleWindows(false);
            page = new OrbPage() {
                @Override protected void ready(WebView v, boolean fromWizard) { pageReady = true; lastState = ""; push(); }
            };
            web.setWebViewClient(page);
            web.setOnTouchListener(new Touch());
            pageOwner = ShellOrigin.selected(this);
            installControls();
            page.load(web);
        }
        Point sc = screen();
        SharedPreferences p = prefs(this);
        int[] at = OrbGesture.rest(p.getInt("x", sc.x), p.getInt("y", Math.round(sc.y * 0.6f)), size, sc.x, sc.y, margin);
        lp = new WindowManager.LayoutParams(size, size, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = at[0]; lp.y = at[1];
        lp.setTitle("WizardShellOrb");
        try {
            wm.addView(web, lp);
            attached = true;
            Log.i(TAG, "orb shown at " + lp.x + "," + lp.y);
            lastState = "";
            push();
            main.removeCallbacks(meter);
            meter.run();
        } catch (RuntimeException e) {
            Log.w(TAG, "overlay refused: " + e.getMessage());
        }
    }

    private void detach() {
        main.removeCallbacks(meter);
        if (!attached || web == null) return;
        try { wm.removeViewImmediate(web); } catch (RuntimeException ignored) { }
        attached = false;
        Log.i(TAG, "orb hidden (Wizard app in front)");
    }

    /** Explicit notification Hide: stop our own take unsent before removing its controls. */
    private void hide(String why) {
        Log.i(TAG, "orb off: " + why);
        prefs(this).edit().putBoolean("on", false).apply();
        shutdown();
    }

    private void shutdown() {
        closing = true;
        stopOwnedTake();
        detach();
        if (page != null) page.close();
        if (web != null) { web.destroy(); web = null; }
        page = null; pageReady = false;
        main.removeCallbacks(meter); // retain the completion of an in-flight start so it can stop its mic
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        closing = true;
        stopOwnedTake();
        main.removeCallbacks(meter); // retain the completion of an in-flight start so it can stop its mic
        if (live == this) live = null;
        if (page != null) page.close();
        if (web != null) { detach(); web.destroy(); web = null; }
        work.shutdown(); // a start already in flight must finish and be closed, never leave a hidden live mic
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    /* ------------------------------------------------------------------ talking to the Wizard */

    private void tap() {
        if (busy || closing || !pageReady || !controlsReady) return;
        final String origin = ShellOrigin.selected(this);
        if (origin == null || !origin.equals(pageOwner)) return;
        String active = RecorderService.active();
        if (active == null) {
            pauseOnStart = false;
            busy = true;
            setState("listen");
            work.execute(() -> {
                try {
                    String id = RecorderService.start(this, null, "orb", "floating-orb", origin);
                    Log.i(TAG, "orb take " + id + " recording");
                    main.post(() -> {
                        busy = false;
                        if (closing || !origin.equals(ShellOrigin.selected(this))) {
                            RecorderService.end(this, id, "stopped");
                            return;
                        }
                        take = id;
                        if (pauseOnStart) RecorderService.pause(id, origin, true);
                        main.removeCallbacks(meter); meter.run();
                    });
                } catch (Exception e) {
                    Log.w(TAG, "orb take refused: " + e.getMessage());
                    main.post(() -> { busy = false; setState("idle"); });
                }
            });
        } else if (RecorderService.owns(active, origin)) {
            busy = true;
            // Stop and mark it to send: the Wizard's page sends it (now if it's alive, else when the app next opens).
            setState("think");
            work.execute(() -> {
                JSONObject t = RecorderService.end(this, active, "stopped", true);
                Log.i(TAG, "orb take " + active + " " + (t == null ? "gone" : t.optBoolean("released") ? "empty" : "sent to the Wizard"));
                main.post(() -> { busy = false; take = null; setState(t != null && !t.optBoolean("released") ? "done" : "idle"); main.postDelayed(() -> setState("idle"), 1200); });
            });
        }
    }

    private final Runnable meter = new Runnable() {
        @Override public void run() {
            if (closing || !attached) return;
            String origin = ShellOrigin.selected(OrbService.this);
            if (origin == null) { shutdown(); return; }
            if (!origin.equals(pageOwner)) { place(); return; }
            if (take != null && !RecorderService.owns(take, origin)) stopOwnedTake();
            JSONObject st = RecorderService.status(origin);
            boolean recording = "recording".equals(st.optString("state")) || "paused".equals(st.optString("state"));
            if (recording) setState("paused".equals(st.optString("state")) ? "paused" : "listen");
            else if (!busy && (lastState.equals("listen") || lastState.equals("paused"))) { take = null; setState("idle"); }
            resize(recording);
            if (pageReady && attached) web.evaluateJavascript("window.WosShellOrb&&WosShellOrb.status(" + st + ")", null);
            if (pageReady && attached) web.evaluateJavascript("window.E&&E.level(" + (st.optInt("level") / 100.0) + ")", null);
            main.postDelayed(this, recording || busy ? 150 : 1000);
        }
    };

    private void setState(String mode) {
        if (mode.equals(lastState)) return;
        lastState = mode;
        push();
    }

    private void push() {
        if (!pageReady || web == null) return;
        String mode = lastState.isEmpty() ? (take != null ? "listen" : "idle") : lastState;
        web.evaluateJavascript("window.E&&E.state({mode:'" + mode + "'})", null);
    }

    private void hold() {
        if (closing) return;
        if (busy) pauseOnStart = true;
        String origin = ShellOrigin.selected(this), id = RecorderService.active();
        if (RecorderService.owns(id, origin)) RecorderService.pause(id, origin, true);
        // Idle hold is deliberately a no-op. Hiding is an explicit notification/settings action.
        main.removeCallbacks(meter); meter.run();
    }

    private void stopOwnedTake() {
        String id = take;
        if (id != null && id.equals(RecorderService.active())) RecorderService.end(this, id, "stopped");
        take = null;
    }

    private void installControls() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(web, "wizardOrbPort", Collections.singleton(OrbPolicy.VIRTUAL),
                (view, message, source, isMainFrame, reply) -> {
                    String owner = ShellOrigin.selected(this);
                    if (!pageReady || closing || !OrbRecordingControl.allowed(view.getUrl(), source == null ? null : source.toString(),
                            isMainFrame, pageOwner, owner) || message.getType() != WebMessageCompat.TYPE_STRING) return;
                    try {
                        String id = RecorderService.active();
                        JSONObject request = new JSONObject(message.getData());
                        String method = OrbRecordingControl.method(request, id);
                        if (busy || method == null || !RecorderService.owns(id, owner)) return;
                        if (method.equals("device.recording.cancel")) {
                            RecorderService.end(this, id, "cancelled"); take = null; setState("idle");
                        } else RecorderService.pause(id, owner, request.getJSONObject("params").getBoolean("on"));
                        main.removeCallbacks(meter); meter.run();
                        reply.postMessage(DevicePort.answer(request.getString("id"), RecorderService.status(owner), null).toString());
                    } catch (org.json.JSONException | RuntimeException e) { Log.w(TAG, "orb control refused: " + e.getMessage()); }
                });
        controlsReady = true;
    }

    /** Grow only during a take. The web's 48dp buttons sit beside the unchanged 64dp orb. */
    private void resize(boolean recording) {
        if (!attached || lp == null) return;
        Point sc = screen();
        int width = recording ? Math.min(dp(240), sc.x - margin * 2) : size;
        int height = size;
        if (lp.width == width && lp.height == height) return;
        lp.x += lp.width - width;
        lp.width = width; lp.height = height;
        clamp();
        try { wm.updateViewLayout(web, lp); } catch (RuntimeException ignored) { }
    }

    private void clamp() {
        Point sc = screen();
        lp.x = Math.max(margin, Math.min(lp.x, sc.x - lp.width - margin));
        lp.y = Math.max(margin, Math.min(lp.y, sc.y - lp.height - margin));
    }

    /* ------------------------------------------------------------------ touch */

    private final class Touch implements android.view.View.OnTouchListener {
        final OrbGesture g = new OrbGesture(ViewConfiguration.get(OrbService.this).getScaledTouchSlop());
        float rawX0, rawY0; int x0, y0;
        final Runnable holdCheck = () -> { if (g.held(android.os.SystemClock.uptimeMillis())) { g.cancel(); hold(); } };

        @Override public boolean onTouch(android.view.View v, MotionEvent e) {
            if (lp == null) return true;
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) controlTouch = e.getY() >= size || e.getX() < lp.width - size;
            if (controlTouch) return false; // don't swallow web button gestures or turn them into orb tap/send
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    Log.i(TAG, "touch down " + Math.round(e.getRawX()) + "," + Math.round(e.getRawY()));
                    g.down(e.getRawX(), e.getRawY(), e.getEventTime());
                    rawX0 = e.getRawX(); rawY0 = e.getRawY(); x0 = lp.x; y0 = lp.y;
                    main.postDelayed(holdCheck, OrbGesture.HOLD_MS);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (g.move(e.getRawX(), e.getRawY())) {
                        main.removeCallbacks(holdCheck);
                        lp.x = x0 + Math.round(e.getRawX() - rawX0);
                        lp.y = y0 + Math.round(e.getRawY() - rawY0);
                        try { wm.updateViewLayout(web, lp); } catch (RuntimeException ignored) { }
                    }
                    return true;
                case MotionEvent.ACTION_UP: {
                    main.removeCallbacks(holdCheck);
                    OrbGesture.Kind k = g.up(e.getRawX(), e.getRawY(), e.getEventTime());
                    Log.i(TAG, "touch " + k);
                    if (k == OrbGesture.Kind.TAP) tap();
                    else if (k == OrbGesture.Kind.HOLD) hold();
                    else if (k == OrbGesture.Kind.DRAG) {
                        Point sc = screen();
                        int[] at = OrbGesture.rest(lp.x, lp.y, lp.width, lp.height, sc.x, sc.y, margin);
                        lp.x = at[0]; lp.y = at[1];
                        try { wm.updateViewLayout(web, lp); } catch (RuntimeException ignored) { }
                        prefs(OrbService.this).edit().putInt("x", lp.x + lp.width - size).putInt("y", lp.y).apply();
                        Log.i(TAG, "orb moved to " + lp.x + "," + lp.y);
                    }
                    return true;
                }
                case MotionEvent.ACTION_CANCEL:
                    main.removeCallbacks(holdCheck);
                    g.cancel();
                    return true;
                default:
                    return true;
            }
        }
    }

    /* ------------------------------------------------------------------ helpers */

    private Point screen() {
        if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Rect b = wm.getCurrentWindowMetrics().getBounds();
            return new Point(b.width(), b.height());
        }
        android.util.DisplayMetrics m = getResources().getDisplayMetrics();
        return new Point(m.widthPixels, m.heightPixels);
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private boolean foreground() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = PendingIntent.getActivity(this, 51, open == null ? new Intent() : open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent hide = PendingIntent.getService(this, 52, new Intent(this, OrbService.class).setAction(ACTION_HIDE),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Wizard orb is on")
                .setContentText("Tap to talk or send · hold to pause")
                .setContentIntent(tap)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "Hide", hide).build())
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(N_ORB, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(N_ORB, n);
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "foreground: " + e);
            return false;
        }
    }
}
