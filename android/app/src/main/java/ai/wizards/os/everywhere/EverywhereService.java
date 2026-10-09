package ai.wizards.os.everywhere;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Paint;
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
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import java.io.File;

import ai.wizards.os.MainActivity;
import ai.wizards.os.R;
import ai.wizards.os.assist.SilenceDetector;

/**
 * Wizard Everywhere: the floating Wizard button (formerly Archimedes Anywhere) inside Wizard OS.
 *
 *  - Switched on in Wizard OS → Settings. Floats over other apps and the home screen, bottom right by default;
 *    drag to move, it snaps to the nearer edge and remembers where you left it.
 *  - Hidden whenever Wizard OS itself is in front (the app has its own orb); back as soon as you leave.
 *  - Tap to talk, tap again to send (or just pause). The recording goes into {@link EverywhereOutbox}
 *    before any network call, so a dropped connection never loses it.
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
    static final String ACTION_APP_UNSENT = "ai.wizards.os.everywhere.APP_UNSENT";
    static final String EXTRA_FRONT = "front";
    static final String CH_RUNNING = "everywhere";
    static final String CH_UNSENT = "unsent";
    static final String CH_REPLIES = "replies";
    static final int N_RUNNING = 7101, N_UNSENT = 7102, N_APP_UNSENT = 7103, N_REPLY_BASE = 7200;

    private static boolean appInFront;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private FrameLayout bubble;
    private RingView ring;
    private WindowManager.LayoutParams lp;
    private boolean attached;
    private EverywhereOutbox outbox;
    private MediaRecorder recorder;
    private File recording;
    private SilenceDetector detector;
    private boolean listening;
    private long startedAt;
    private int size, margin;

    /* ------------------------------------------------------------------ static API (MainActivity / Settings) */

    public static boolean enabled(Context c) { return prefs(c).getBoolean(KEY_ENABLED, false); }

    public static boolean overlayAllowed(Context c) { return Settings.canDrawOverlays(c); }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE); }

    /** Turn the button on/off. Returns what is still missing ("overlay"), or "" when it is running. */
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

    /** Wizard OS tells the button when it comes to the front / leaves, so the button hides while the app is open. */
    public static void setAppInFront(Context c, boolean front) {
        appInFront = front;
        if (!enabled(c) || !overlayAllowed(c)) return;
        try { c.startService(new Intent(c, EverywhereService.class).setAction(ACTION_FRONT).putExtra(EXTRA_FRONT, front)); }
        catch (Exception e) { // background start refused (rare): the foreground start path still works
            if (!front) ensureRunning(c);
        }
    }

    /** JSON for Settings. */
    public static String status(Context c) {
        boolean notif = Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        boolean mic = c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        return "{\"enabled\":" + enabled(c) + ",\"overlay\":" + overlayAllowed(c) + ",\"notifications\":" + notif + ",\"mic\":" + mic + "}";
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
        run.setDescription("Keeps the floating Wizard button available over other apps");
        run.setShowBadge(false);
        NotificationChannel uns = new NotificationChannel(CH_UNSENT, "Not sent", NotificationManager.IMPORTANCE_HIGH);
        uns.setDescription("Messages that could not reach Wizard, with Retry");
        NotificationChannel rep = new NotificationChannel(CH_REPLIES, "Replies", NotificationManager.IMPORTANCE_DEFAULT);
        rep.setDescription("Wizard answered something you said to the floating button");
        nm.createNotificationChannel(run);
        nm.createNotificationChannel(uns);
        nm.createNotificationChannel(rep);
    }

    /* ------------------------------------------------------------------ lifecycle */

    @Override
    public void onCreate() {
        super.onCreate();
        wm = getSystemService(WindowManager.class);
        float d = getResources().getDisplayMetrics().density;
        size = Math.round(58 * d);
        margin = Math.round(8 * d);
        channels(this);
        outbox = EverywhereOutbox.get(this);
        outbox.addListener(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent == null ? ACTION_START : String.valueOf(intent.getAction());
        if (!startForegroundSafe(false)) { stopSelf(); return START_NOT_STICKY; }
        if (ACTION_STOP.equals(a) || !enabled(this) || !overlayAllowed(this)) { shutdown(); return START_NOT_STICKY; }
        if (ACTION_FRONT.equals(a)) appInFront = intent.getBooleanExtra(EXTRA_FRONT, appInFront);
        if (ACTION_RETRY.equals(a)) { outbox.retry("*"); getSystemService(NotificationManager.class).cancel(N_UNSENT); }
        syncBubble();
        outbox.pump();
        return START_STICKY;
    }

    private boolean startForegroundSafe(boolean mic) {
        Notification n = new Notification.Builder(this, CH_RUNNING)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(listening ? "Listening…" : "Wizard Everywhere is on")
                .setContentText(listening ? "Tap the Wizard button to send" : "Tap the floating Wizard button to talk")
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
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    /* ------------------------------------------------------------------ bubble */

    private void syncBubble() {
        boolean show = EverywherePolicy.bubbleVisible(enabled(this), overlayAllowed(this), appInFront) || listening;
        if (show) attach(); else detach();
        Log.i(TAG, "bubble " + (show ? "shown" : "hidden") + " (appInFront=" + appInFront + ")");
    }

    @SuppressLint("ClickableViewAccessibility")
    private void attach() {
        if (attached) { refreshBadge(); return; }
        if (bubble == null) {
            bubble = new FrameLayout(this);
            bubble.setContentDescription("Wizard Everywhere. Tap to talk, drag to move.");
            ring = new RingView(this);
            bubble.addView(ring, new FrameLayout.LayoutParams(size, size));
            ImageView face = new ImageView(this);
            face.setImageResource(R.drawable.wizard_everywhere_face);
            face.setScaleType(ImageView.ScaleType.CENTER_CROP);
            int inset = Math.round(size * 0.09f);
            FrameLayout.LayoutParams fl = new FrameLayout.LayoutParams(size - inset * 2, size - inset * 2, Gravity.CENTER);
            face.setOutlineProvider(new ViewOutlineProvider() {
                @Override public void getOutline(View v, Outline o) { o.setOval(0, 0, v.getWidth(), v.getHeight()); }
            });
            face.setClipToOutline(true);
            bubble.addView(face, fl);
            bubble.setOnTouchListener(new Drag());
            bubble.setElevation(10 * getResources().getDisplayMetrics().density);
        }
        lp = new WindowManager.LayoutParams(size, size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.setTitle("WizardEverywhere");
        Point s = screen();
        int[] def = EverywherePolicy.defaultPosition(size, s.x, s.y, margin);
        int[] p = EverywherePolicy.clamp(prefs(this).getInt("x", def[0]), prefs(this).getInt("y", def[1]), size, s.x, s.y, margin);
        lp.x = p[0]; lp.y = p[1];
        try {
            wm.addView(bubble, lp);
            attached = true;
            refreshBadge();
        } catch (Exception e) {
            Log.w(TAG, "overlay refused: " + e.getMessage());
        }
    }

    private void detach() {
        if (!attached || bubble == null) return;
        try { wm.removeViewImmediate(bubble); } catch (Exception ignored) { }
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

    private void refreshBadge() {
        syncAwake();
        if (ring == null) return;
        int failed = 0, waiting = 0;
        for (EverywhereOutbox.Item it : outbox.unsent()) { if ("failed".equals(it.state)) failed++; else waiting++; }
        ring.set(listening ? RingView.LISTEN : waiting > 0 ? RingView.SENDING : RingView.IDLE, failed);
    }

    /** The bubble's window keeps the screen on while it listens, so a lock can't cut the take short. */
    private void syncAwake() {
        if (lp == null || bubble == null) return;
        int f = listening ? (lp.flags | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) : (lp.flags & ~WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (f == lp.flags) return;
        lp.flags = f;
        try { if (attached) wm.updateViewLayout(bubble, lp); } catch (RuntimeException ignored) { }
    }

    /** Tap = talk / send, drag = move (snaps to the nearer edge, remembered). */
    private final class Drag implements View.OnTouchListener {
        float downX, downY; int startX, startY; boolean moved;
        final int slop = ViewConfiguration.get(EverywhereService.this).getScaledTouchSlop();

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = e.getRawX(); downY = e.getRawY(); startX = lp.x; startY = lp.y; moved = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                    if (!moved && Math.hypot(dx, dy) < slop) return true;
                    moved = true;
                    Point s = screen();
                    int[] p = EverywherePolicy.clamp(startX + Math.round(dx), startY + Math.round(dy), size, s.x, s.y, margin);
                    lp.x = p[0]; lp.y = p[1];
                    if (attached) wm.updateViewLayout(bubble, lp);
                    return true;
                case MotionEvent.ACTION_UP:
                    if (moved) {
                        Point sc = screen();
                        int[] q = EverywherePolicy.snap(lp.x, lp.y, size, sc.x, sc.y, margin);
                        lp.x = q[0]; lp.y = q[1];
                        if (attached) wm.updateViewLayout(bubble, lp);
                        prefs(EverywhereService.this).edit().putInt("x", q[0]).putInt("y", q[1]).apply();
                    } else {
                        v.performClick();
                        tap();
                    }
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    return true;
                default:
                    return false;
            }
        }
    }

    private void tap() {
        buzz(12);
        if (listening) { send(); return; }
        start();
    }

    /* ------------------------------------------------------------------ recording */

    private void start() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Open Wizard OS once and allow the microphone", Toast.LENGTH_LONG).show();
            try { openApp(this, MainActivity.ACTION_SETTINGS, 4).send(); } catch (PendingIntent.CanceledException ignored) { }
            return;
        }
        if (!startForegroundSafe(true)) {
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
            Toast.makeText(this, "The microphone is busy. Try again in a moment.", Toast.LENGTH_SHORT).show();
            startForegroundSafe(false);
            return;
        }
        listening = true;
        startedAt = SystemClock.elapsedRealtime();
        detector = SilenceDetector.standard();
        Log.i(TAG, "listening");
        refreshBadge();
        main.post(meter);
        if (recorder == null) main.postDelayed(this::send, 2500); // QA canned audio
    }

    private final Runnable meter = new Runnable() {
        @Override
        public void run() {
            if (!listening) return;
            int amp = 0;
            if (recorder != null) {
                try { amp = recorder.getMaxAmplitude(); } catch (IllegalStateException e) { return; }
                SilenceDetector.Result res = detector.feed(amp, SystemClock.elapsedRealtime());
                if (res == SilenceDetector.Result.SEND) { send(); return; }
                if (res == SilenceDetector.Result.NOTHING_HEARD) { discard(); toast("Didn’t catch anything"); return; }
            }
            if (ring != null) ring.level(Math.min(1f, amp / 12000f));
            main.postDelayed(this, 90);
        }
    };

    private void send() {
        if (!listening) return;
        listening = false;
        main.removeCallbacks(meter);
        boolean ok = true;
        MediaRecorder r = recorder;
        recorder = null;
        if (r != null) {
            try { r.stop(); } catch (RuntimeException e) { ok = false; }
            r.release();
        }
        File f = recording;
        recording = null;
        startForegroundSafe(false);
        if (!ok || f == null || !f.isFile() || f.length() < 512) {
            if (f != null) //noinspection ResultOfMethodCallIgnored
                f.delete();
            toast("Didn’t catch anything");
            refreshBadge();
            return;
        }
        try {
            outbox.enqueueRecording(f); // saved on the phone before any network call
            buzz(20);
            toast("Sending to Wizard…");
        } catch (Exception e) {
            Log.e(TAG, "could not keep the recording", e);
            toast("Couldn’t save that recording");
        }
        refreshBadge();
        syncBubble();
    }

    private void discard() {
        listening = false;
        main.removeCallbacks(meter);
        dropRecorder();
        if (recording != null && !recording.getName().startsWith("qa_")) //noinspection ResultOfMethodCallIgnored
            recording.delete();
        recording = null;
        refreshBadge();
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
        refreshBadge();
        MainActivity.notifyUnsentChanged();
        boolean anyFailed = false;
        for (EverywhereOutbox.Item it : outbox.unsent()) if ("failed".equals(it.state)) anyFailed = true;
        if (!anyFailed) getSystemService(NotificationManager.class).cancel(N_UNSENT);
    }

    @Override
    public void onFailed(EverywhereOutbox.Item it) {
        if (!canNotify(this)) { toast("Not sent: " + it.error); return; }
        int n = 0;
        for (EverywhereOutbox.Item x : outbox.unsent()) if ("failed".equals(x.state)) n++;
        PendingIntent retry = PendingIntent.getService(this, 5,
                new Intent(this, EverywhereService.class).setAction(ACTION_RETRY), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification note = new Notification.Builder(this, CH_UNSENT)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle(n > 1 ? n + " messages not sent" : "Not sent · " + it.error)
                .setContentText(EverywherePolicy.clip(it.text.isEmpty() ? "Voice note (kept on this phone)" : it.text, 90))
                .setContentIntent(openApp(this, MainActivity.ACTION_UNSENT, 6))
                .addAction(new Notification.Action.Builder(null, "Retry", retry).build())
                .addAction(new Notification.Action.Builder(null, "See all", openApp(this, MainActivity.ACTION_UNSENT, 7)).build())
                .setAutoCancel(true)
                .build();
        getSystemService(NotificationManager.class).notify(N_UNSENT, note);
    }

    @Override
    public void onSent(EverywhereOutbox.Item it) { toast("Sent to Wizard"); }

    @Override
    public void onReply(EverywhereOutbox.Item it, String text) {
        if (!canNotify(this) || appInFront) return;
        Notification note = new Notification.Builder(this, CH_REPLIES)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("Archimedes · " + EverywherePolicy.clip(it.text, 50))
                .setContentText(EverywherePolicy.clip(text, 140))
                .setStyle(new Notification.BigTextStyle().bigText(EverywherePolicy.clip(text, 600)))
                .setContentIntent(openApp(this, MainActivity.ACTION_THREAD, 100 + (it.id.hashCode() & 0xffff), it.sessionId))
                .setAutoCancel(true)
                .build();
        getSystemService(NotificationManager.class).notify(N_REPLY_BASE + (it.id.hashCode() & 0xff), note);
    }

    /* ------------------------------------------------------------------ util */

    private void toast(String s) { main.post(() -> Toast.makeText(this, s, Toast.LENGTH_SHORT).show()); }

    private void buzz(int ms) {
        Vibrator v = getSystemService(Vibrator.class);
        if (v != null && v.hasVibrator()) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
    }

    /** The ring around the face: violet idle, red + level while listening, pulsing while sending, amber dot = not sent. */
    static final class RingView extends View {
        static final int IDLE = 0, LISTEN = 1, SENDING = 2;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG), dot = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int mode; private int failed; private float level;

        RingView(Context c) { super(c); p.setStyle(Paint.Style.STROKE); dot.setColor(Color.rgb(255, 176, 32)); }

        void set(int m, int f) { mode = m; failed = f; invalidate(); }
        void level(float l) { level = l; invalidate(); }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), r = w / 2f, sw = w * 0.07f;
            p.setStrokeWidth(sw);
            int col = mode == LISTEN ? Color.rgb(255, 77, 109) : mode == SENDING ? Color.rgb(192, 160, 255) : Color.rgb(155, 123, 255);
            p.setColor(col);
            p.setAlpha(mode == SENDING ? 110 + (int) (100 * Math.abs(Math.sin(SystemClock.uptimeMillis() / 300.0))) : 235);
            float rr = r - sw / 2f - (mode == LISTEN ? 0 : sw * 0.2f);
            c.drawCircle(r, r, rr, p);
            if (mode == LISTEN && level > 0.02f) {
                p.setAlpha(90);
                p.setStrokeWidth(sw * (1 + level * 1.6f));
                c.drawCircle(r, r, rr, p);
            }
            if (failed > 0) c.drawCircle(w * 0.82f, w * 0.18f, w * 0.13f, dot);
            if (mode == SENDING) postInvalidateDelayed(60);
        }
    }
}
