package ai.wizards.os.everywhere;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.ColorSpace;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * "Type with your voice" for Wizard Everywhere (the Archimedes Anywhere keyboard feature, ported).
 *
 *  - Watches for an on-screen keyboard / a focused text field and tells {@link EverywhereService}, which turns
 *    the floating orb into dictation: tap, talk, and the words are typed where the cursor is.
 *  - Types the words into the focused field (cursor-aware, with spacing and capitals), falling back to paste.
 *  - Takes the screenshots the orb's Screen button attaches to a message (Android 11+).
 *
 * James turns it on once in Android Settings → Accessibility → Wizard OS. Nothing else uses it.
 */
public class WizardKeyboardService extends AccessibilityService {
    static final String TAG = EverywhereOutbox.TAG;
    private static WizardKeyboardService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final KeyboardSignal signal = new KeyboardSignal();
    private boolean lastReported;
    private int lastImeTop = -1;

    public static WizardKeyboardService get() { return instance; }

    /** Is the service switched on in Android's accessibility settings? (True even before it connects.) */
    public static boolean enabled(Context c) {
        String on = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (on == null) return false;
        ComponentName me = new ComponentName(c, WizardKeyboardService.class);
        TextUtils.SimpleStringSplitter sp = new TextUtils.SimpleStringSplitter(':');
        sp.setString(on);
        for (String s : sp) {
            ComponentName cn = ComponentName.unflattenFromString(s);
            if (me.equals(cn)) return true;
        }
        return false;
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
            setServiceInfo(info);
        }
        Log.i(TAG, "keyboard service connected");
        main.post(poll);
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        main.removeCallbacks(poll);
        report(false);
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        main.removeCallbacks(poll);
        super.onDestroy();
    }

    @Override
    public void onInterrupt() { }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null) return;
        int t = e.getEventType();
        if (t == AccessibilityEvent.TYPE_VIEW_FOCUSED || t == AccessibilityEvent.TYPE_VIEW_CLICKED
                || t == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            AccessibilityNodeInfo n = e.getSource();
            if (n != null && n.isEditable() && !ownPackage(n)) signal.editorEvidence(SystemClock.uptimeMillis());
        }
        check();
    }

    /** Keep sampling: OEM keyboards do not always send window events when they slide away. */
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            check();
            main.postDelayed(this, 450);
        }
    };

    private void check() {
        boolean ime = imeVisible();
        report(signal.keyboardMode(ime, SystemClock.uptimeMillis()));
    }

    private int reportedTop = -1;

    private void report(boolean kb) {
        // Also re-report when the keyboard's top edge becomes known or moves (it slides up after the field focuses).
        if (kb == lastReported && (!kb || Math.abs(lastImeTop - reportedTop) < 8)) return;
        lastReported = kb;
        reportedTop = lastImeTop;
        Log.i(TAG, "keyboard " + (kb ? "open" : "closed") + (lastImeTop >= 0 ? " imeTop=" + lastImeTop : ""));
        EverywhereService.keyboardChanged(this, kb, lastImeTop);
    }

    private boolean imeVisible() {
        try {
            List<AccessibilityWindowInfo> ws = getWindows();
            for (AccessibilityWindowInfo w : ws) {
                if (w.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD) {
                    Rect r = new Rect();
                    w.getBoundsInScreen(r);
                    if (r.height() > 0) { lastImeTop = r.top; return true; }
                }
            }
        } catch (Exception ignored) { }
        return false;
    }

    private boolean ownPackage(AccessibilityNodeInfo n) {
        CharSequence p = n.getPackageName();
        return p != null && p.toString().equals(getPackageName());
    }

    /** Is a keyboard up (or a text field just focused) right now? Checked at tap time; the orb's icon is only a hint. */
    public boolean inputActiveNow() {
        return imeVisible() || signal.recentEditor(SystemClock.uptimeMillis());
    }

    /* ------------------------------------------------------------------ typing */

    /** Types the words where the cursor is. Returns false when no field would take them (caller copies instead). */
    public boolean insertText(String words) {
        if (words == null || words.trim().isEmpty()) return false;
        AccessibilityNodeInfo target = findEditable();
        if (target == null) { Log.w(TAG, "insert: no editable field"); return false; }
        CharSequence cur = target.getText();
        String existing = cur == null ? "" : cur.toString();
        // An empty field reports its hint as its text on some apps.
        CharSequence hint = Build.VERSION.SDK_INT >= 26 ? target.getHintText() : null;
        if (target.isShowingHintText() || (hint != null && existing.equals(hint.toString()))) existing = "";
        int start = target.getTextSelectionStart(), end = target.getTextSelectionEnd();
        if (start < 0 || start > existing.length()) start = existing.length();
        if (end < start || end > existing.length()) end = start;
        String before = existing.substring(0, start);
        String piece = DictationText.fit(before, existing.substring(end), words);
        String next = before + piece + existing.substring(end);
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, next);
        boolean ok = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
        if (ok) {
            int caret = before.length() + piece.length();
            Bundle sel = new Bundle();
            sel.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, caret);
            sel.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, caret);
            target.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, sel);
            Log.i(TAG, "typed " + piece.length() + " chars");
            return true;
        }
        // Some fields (web views, custom editors) refuse SET_TEXT: paste instead.
        ClipboardManager cb = getSystemService(ClipboardManager.class);
        cb.setPrimaryClip(ClipData.newPlainText("Wizard", piece));
        boolean pasted = target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
        Log.i(TAG, "set_text refused; paste=" + pasted);
        return pasted;
    }

    private AccessibilityNodeInfo findEditable() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        AccessibilityNodeInfo f = root == null ? null : root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (f != null && f.isEditable()) return f;
        // Focus can sit in another window (a dialog, a browser): look at every window.
        try {
            for (AccessibilityWindowInfo w : getWindows()) {
                AccessibilityNodeInfo r = w.getRoot();
                if (r == null) continue;
                AccessibilityNodeInfo n = r.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
                if (n != null && n.isEditable()) return n;
            }
        } catch (Exception ignored) { }
        return root == null ? null : firstFocusedEditable(root, 0);
    }

    private static AccessibilityNodeInfo firstFocusedEditable(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 40) return null;
        if (n.isEditable() && n.isFocused()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = firstFocusedEditable(n.getChild(i), depth + 1);
            if (r != null) return r;
        }
        return null;
    }

    /* ------------------------------------------------------------------ screenshots */

    public interface Shot { void done(byte[] png); }

    /** PNG of the screen (Android 11+), longest side ≤ 1600 px; null when the screen refuses capture. */
    public void screenshot(Shot cb) {
        if (Build.VERSION.SDK_INT < 30) { cb.done(null); return; }
        shotAttempt(cb, 1);
    }

    @android.annotation.SuppressLint("NewApi")
    private void shotAttempt(Shot cb, int retries) {
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override public void onSuccess(ScreenshotResult r) {
                    byte[] png = encode(r);
                    if ((png == null || png.length == 0) && retries > 0) { main.postDelayed(() -> shotAttempt(cb, retries - 1), 600); return; }
                    cb.done(png);
                }
                @Override public void onFailure(int code) {
                    Log.w(TAG, "screenshot failed " + code);
                    if (retries > 0) main.postDelayed(() -> shotAttempt(cb, retries - 1), 600); else cb.done(null);
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "screenshot request failed", e);
            cb.done(null);
        }
    }

    @android.annotation.SuppressLint("NewApi")
    private static byte[] encode(ScreenshotResult r) {
        if (r == null) return null;
        HardwareBuffer buf = r.getHardwareBuffer();
        if (buf == null) return null;
        Bitmap wrapped = null, soft = null, out = null;
        try {
            ColorSpace cs = r.getColorSpace();
            if (cs == null) cs = ColorSpace.get(ColorSpace.Named.SRGB);
            wrapped = Bitmap.wrapHardwareBuffer(buf, cs);
            if (wrapped == null) return null;
            soft = wrapped.copy(Bitmap.Config.ARGB_8888, false);
            if (soft == null) return null;
            int w = soft.getWidth(), h = soft.getHeight(), longest = Math.max(w, h);
            out = longest > 1600 ? Bitmap.createScaledBitmap(soft, Math.max(1, w * 1600 / longest), Math.max(1, h * 1600 / longest), true) : soft;
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            if (!out.compress(Bitmap.CompressFormat.PNG, 100, b)) return null;
            return b.toByteArray();
        } catch (Exception | OutOfMemoryError e) {
            Log.w(TAG, "screenshot encode failed", e);
            return null;
        } finally {
            if (out != null && out != soft) out.recycle();
            if (soft != null) soft.recycle();
            if (wrapped != null) wrapped.recycle();
            try { buf.close(); } catch (Exception ignored) { }
        }
    }
}
