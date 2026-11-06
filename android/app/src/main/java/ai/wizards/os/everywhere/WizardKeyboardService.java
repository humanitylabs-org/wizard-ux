package ai.wizards.os.everywhere;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.accessibilityservice.InputMethod;
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
import android.view.inputmethod.SurroundingText;

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
    private AccessibilityNodeInfo lastFocusedNode;
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
        ai.wizards.os.usuals.UsualsRunner.get(this).serviceConnected();
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
        ai.wizards.os.usuals.UsualsRunner.get(this).onEvent(e); // records taps in Grab only while James teaches a usual
        int t = e.getEventType();
        if (t == AccessibilityEvent.TYPE_VIEW_FOCUSED || t == AccessibilityEvent.TYPE_VIEW_CLICKED
                || t == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED) {
            AccessibilityNodeInfo n = e.getSource();
            if (n != null && n.isEditable() && !ownPackage(n)) { signal.editorEvidence(SystemClock.uptimeMillis()); lastFocusedNode = n; }
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

    /**
     * Types the words where the cursor is: Archimedes Anywhere's insertText, copied verbatim. Strategy 1 is the
     * accessibility InputConnection (commitText at the cursor, works in Obsidian/WebViews/everything on Android 13+),
     * verified by re-reading the field; strategy 2 is a clipboard paste that restores the old clipboard.
     * Never replaces the whole field (ACTION_SET_TEXT rewrote Obsidian documents).
     */
    public boolean insertText(String text) {
        // Find target for capitalization context
        AccessibilityNodeInfo target = findEditable();
        if (target == null) target = lastFocusedNode;

        // Trim leading whitespace
        text = text.stripLeading();

        // Get the field text BEFORE insertion (via accessibility node) for verification
        String fieldTextBefore = null;
        AccessibilityNodeInfo verifyNode = target;
        if (verifyNode != null && verifyNode.getText() != null) {
            fieldTextBefore = verifyNode.getText().toString();
        }

        // Strategy 1: InputConnection (API 33+) — works in ALL apps including Obsidian
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                InputMethod inputMethod = getInputMethod();
                if (inputMethod != null) {
                    InputMethod.AccessibilityInputConnection ic = inputMethod.getCurrentInputConnection();
                    if (ic != null) {
                        // Get surrounding text for context-aware behavior
                        SurroundingText surrounding = ic.getSurroundingText(50, 50, 0);
                        
                        if (surrounding != null) {
                            CharSequence before = surrounding.getText().subSequence(
                                0, surrounding.getSelectionStart());
                            CharSequence after = surrounding.getText().subSequence(
                                surrounding.getSelectionEnd(), surrounding.getText().length());
                            
                            // Smart leading space: if cursor is right after a word character
                            // (no space between), prepend a space
                            if (before.length() > 0) {
                                char lastBefore = before.charAt(before.length() - 1);
                                if (Character.isLetterOrDigit(lastBefore) || lastBefore == ')' || lastBefore == '"') {
                                    text = " " + text;
                                }
                            }
                            
                            // Context-aware capitalization
                            text = adjustCapitalizationFromContext(
                                before.toString(), text);
                            
                            // Smart trailing space: don't add if next char is space/punctuation
                            if (text.endsWith(" ") && after.length() > 0) {
                                char nextChar = after.charAt(0);
                                if (nextChar == ' ' || nextChar == '.' || nextChar == ',' 
                                    || nextChar == '!' || nextChar == '?' || nextChar == ';'
                                    || nextChar == ':' || nextChar == ')') {
                                    text = text.stripTrailing();
                                }
                            }
                        } else {
                            // No surrounding text — capitalize first letter
                            text = capitalizeFirst(text);
                        }
                        
                        ic.commitText(text, 1, null);
                        
                        // Verify insertion via accessibility node (not InputConnection which may be stale)
                        try {
                            Thread.sleep(100); // Wait for field to update
                        } catch (InterruptedException ie) { /* ignore */ }
                        
                        // Re-find the editable node to get fresh text
                        AccessibilityNodeInfo freshNode = findEditable();
                        if (freshNode == null) freshNode = lastFocusedNode;
                        String fieldTextAfter = null;
                        if (freshNode != null) {
                            freshNode.refresh(); // Force refresh from the view
                            if (freshNode.getText() != null) {
                                fieldTextAfter = freshNode.getText().toString();
                            }
                        }
                        
                        // If we can verify and text didn't change, commitText silently failed
                        if (fieldTextBefore != null && fieldTextAfter != null 
                                && fieldTextBefore.equals(fieldTextAfter)) {
                            Log.w(TAG, "commitText silently failed — field text unchanged. Falling through to clipboard.");
                            throw new Exception("Stale InputConnection — field text unchanged after commitText");
                        }
                        
                        return true;
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "InputConnection strategy failed: " + e.getMessage());
                // Fall through to clipboard method
            }
        }

        // Strategy 2: Clipboard paste (fallback for older Android or when IME unavailable)
        if (target == null) return false;
        android.content.ClipboardManager clipboard = (android.content.ClipboardManager)
                getSystemService(CLIPBOARD_SERVICE);
        cancelClipRestore();
        android.content.ClipData oldClip = clipboard.getPrimaryClip();
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Wizard", text));
        boolean pasted = target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
        // A failed paste leaves the words on the clipboard as the newest entry. Restoring the old clip
        // afterwards buried the transcript under it in the keyboard's clipboard history.
        if (ClipRestore.shouldRestore(pasted, oldClip != null)) {
            final android.content.ClipData saved = oldClip;
            final String ours = text;
            pendingRestore = () -> {
                pendingRestore = null;
                try {
                    if (ClipRestore.stillOurs(primaryText(clipboard), ours)) clipboard.setPrimaryClip(saved);
                } catch (Exception ignored) {}
            };
            main.postDelayed(pendingRestore, 500);
        }
        return pasted;
    }

    private volatile Runnable pendingRestore;

    private void cancelClipRestore() {
        Runnable r = pendingRestore;
        pendingRestore = null;
        if (r != null) main.removeCallbacks(r);
    }

    private static String primaryText(android.content.ClipboardManager cb) {
        android.content.ClipData c = cb.getPrimaryClip();
        if (c == null || c.getItemCount() == 0 || c.getItemAt(0).getText() == null) return null;
        return c.getItemAt(0).getText().toString();
    }

    /**
     * Puts dictated words on the clipboard as the newest entry, cancelling any pending restore of an older clip
     * so nothing lands on top of them.
     */
    public static void copyAsLatest(android.content.Context ctx, String text) {
        WizardKeyboardService k = get();
        if (k != null) k.cancelClipRestore(); // Handler.removeCallbacks is safe from any thread
        android.content.ClipboardManager cb = ctx.getSystemService(android.content.ClipboardManager.class);
        cb.setPrimaryClip(android.content.ClipData.newPlainText("Wizard", text));
    }

    /**
     * Capitalize based on text before cursor (from InputConnection).
     * Works universally — Obsidian, Telegram, browsers, everything.
     */
    private String adjustCapitalizationFromContext(String before, String text) {
        if (text == null || text.isEmpty()) return text;
        
        boolean shouldCapitalize = false;
        
        if (before == null || before.isEmpty()) {
            shouldCapitalize = true; // Start of field
        } else {
            // Find last meaningful character before cursor
            int lookBack = before.length() - 1;
            while (lookBack >= 0 && before.charAt(lookBack) == ' ') lookBack--;
            
            if (lookBack < 0) {
                shouldCapitalize = true; // Only spaces
            } else {
                char lastChar = before.charAt(lookBack);
                shouldCapitalize = (lastChar == '.' || lastChar == '!' || lastChar == '?' 
                    || lastChar == '\n' || lastChar == '\r'
                    || lastChar == '-' || lastChar == '*' || lastChar == '•');
            }
        }
        
        // Find first letter
        int firstLetter = -1;
        for (int i = 0; i < text.length(); i++) {
            if (Character.isLetter(text.charAt(i))) {
                firstLetter = i;
                break;
            }
        }
        if (firstLetter < 0) return text;
        
        char c = text.charAt(firstLetter);
        if (shouldCapitalize && Character.isLowerCase(c)) {
            return text.substring(0, firstLetter) + Character.toUpperCase(c) + text.substring(firstLetter + 1);
        } else if (!shouldCapitalize && Character.isUpperCase(c)) {
            return text.substring(0, firstLetter) + Character.toLowerCase(c) + text.substring(firstLetter + 1);
        }
        return text;
    }

    private String capitalizeFirst(String text) {
        if (text == null || text.isEmpty()) return text;
        for (int i = 0; i < text.length(); i++) {
            if (Character.isLetter(text.charAt(i))) {
                if (Character.isLowerCase(text.charAt(i))) {
                    return text.substring(0, i) + Character.toUpperCase(text.charAt(i)) + text.substring(i + 1);
                }
                break;
            }
        }
        return text;
    }

    /** Package of the app whose text field has the cursor (or of the active window), "" when unknown. */
    public String targetPackage() {
        try {
            AccessibilityNodeInfo n = findEditable();
            CharSequence p = n == null ? null : n.getPackageName();
            if (p == null) { AccessibilityNodeInfo root = getRootInActiveWindow(); p = root == null ? null : root.getPackageName(); }
            return p == null ? "" : p.toString();
        } catch (Exception e) { return ""; }
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

    /* ------------------------------------------------------------------ screen text (orb long-press → Screen) */

    /**
     * Every piece of text Android exposes for the apps on screen right now (not our own windows, not the keyboard),
     * with where it sits. Works where an app blocks long-press copy: the text is read from the app's views, the
     * same way a screen reader reads it. Call on the main thread; walks at most a few thousand nodes.
     */
    public java.util.List<ScreenPolicy.Block> screenText() {
        java.util.List<ScreenPolicy.Block> out = new java.util.ArrayList<>();
        int[] budget = {6000};
        charDeadline = SystemClock.uptimeMillis() + 1500; // where each word sits: at most ~1.5 s of lookups
        java.util.Arrays.fill(charStats, 0);
        try {
            List<AccessibilityWindowInfo> ws = getWindows();
            boolean any = false;
            for (AccessibilityWindowInfo w : ws) {
                int t = w.getType();
                if (t == AccessibilityWindowInfo.TYPE_INPUT_METHOD || t == AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY) continue;
                AccessibilityNodeInfo r = w.getRoot();
                if (t == AccessibilityWindowInfo.TYPE_SYSTEM) continue; // status bar, nav bar: not part of the app
                if (r == null || ownPackage(r)) continue;
                walk(r, out, budget, 0);
                any = true;
            }
            if (!any) { AccessibilityNodeInfo r = getRootInActiveWindow(); if (r != null && !ownPackage(r)) walk(r, out, budget, 0); }
        } catch (Exception e) { Log.w(TAG, "screen text failed", e); }
        Log.i(TAG, "screen char positions: ok=" + charStats[0] + " noKey=" + charStats[1] + " refused=" + charStats[2]
                + " empty=" + charStats[3] + " late=" + charStats[4] + " long=" + charStats[5]);
        return out;
    }

    private void walk(AccessibilityNodeInfo n, java.util.List<ScreenPolicy.Block> out, int[] budget, int depth) {
        if (n == null || depth > 60 || --budget[0] < 0) return;
        if (!n.isVisibleToUser()) return;
        CharSequence text = n.getText();
        boolean label = false;
        if (text == null || text.length() == 0) { text = n.getContentDescription(); label = true; }
        if (n.isPassword()) text = null;
        if (text != null && text.length() > 0) {
            Rect b = new Rect();
            n.getBoundsInScreen(b);
            if (b.width() > 0 && b.height() > 0) {
                String t = text.toString();
                java.util.List<ScreenPolicy.Word> words = null;
                boolean exact = false;
                if (!label) {
                    float[][] rects = charRects(n, t.length());
                    words = ScreenPolicy.words(t, rects);
                    exact = rects != null;
                }
                out.add(new ScreenPolicy.Block(t, b.left, b.top, b.width(), b.height(), label, words, exact));
            }
        }
        for (int i = 0; i < n.getChildCount(); i++) walk(n.getChild(i), out, budget, depth + 1);
    }

    private long charDeadline;
    /** ok, no key, refresh refused, no rects, past the deadline, too long: why words were or weren't placed. */
    private final int[] charStats = new int[6];

    /**
     * Where Android drew each character of this node's text, in screen pixels (the same data TalkBack uses), so a
     * selection can start and end inside a line the way Google's does. Null when the app doesn't report it, the text
     * is long, or the lookup budget for this screen is spent; the page then lays the words out itself.
     */
    @SuppressWarnings("deprecation") // Bundle.getParcelableArray(String): the typed variant is API 33+, minSdk is 28
    private float[][] charRects(AccessibilityNodeInfo n, int len) {
        if (len <= 0) return null;
        if (len > 3000) { charStats[5]++; return null; }
        if (SystemClock.uptimeMillis() > charDeadline) { charStats[4]++; return null; }
        try {
            List<String> extra = n.getAvailableExtraData();
            if (extra == null || !extra.contains(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY)) { charStats[1]++; return null; }
            android.os.Bundle a = new android.os.Bundle();
            a.putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_START_INDEX, 0);
            a.putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_LENGTH, len);
            if (!n.refreshWithExtraData(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY, a)) { charStats[2]++; return null; }
            android.os.Parcelable[] ps = n.getExtras().getParcelableArray(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY);
            if (ps == null) { charStats[3]++; return null; }
            float[][] r = new float[len][];
            boolean any = false;
            for (int i = 0; i < Math.min(len, ps.length); i++) {
                if (!(ps[i] instanceof android.graphics.RectF)) continue;
                android.graphics.RectF f = (android.graphics.RectF) ps[i];
                if (f.width() <= 0 && f.height() <= 0) continue;
                r[i] = new float[]{f.left, f.top, f.right, f.bottom};
                any = true;
            }
            charStats[any ? 0 : 3]++;
            return any ? r : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /* ------------------------------------------------------------------ screenshots */

    public interface Shot { void done(byte[] png); }

    /** PNG of the screen (Android 11+), longest side ≤ 1600 px; null when the screen refuses capture. */
    public void screenshot(Shot cb) {
        if (Build.VERSION.SDK_INT < 30) { cb.done(null); return; }
        shotAttempt(cb, 1, false);
    }

    /** Same as a JPEG (fast to encode): the frozen background of Screen mode and what "Read picture text" reads. */
    public void screenshotJpeg(Shot cb) {
        if (Build.VERSION.SDK_INT < 30) { cb.done(null); return; }
        shotAttempt(cb, 1, true);
    }

    @android.annotation.SuppressLint("NewApi")
    private void shotAttempt(Shot cb, int retries, boolean jpeg) {
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override public void onSuccess(ScreenshotResult r) {
                    byte[] png = encode(r, jpeg);
                    if ((png == null || png.length == 0) && retries > 0) { main.postDelayed(() -> shotAttempt(cb, retries - 1, jpeg), 600); return; }
                    cb.done(png);
                }
                @Override public void onFailure(int code) {
                    Log.w(TAG, "screenshot failed " + code);
                    if (retries > 0) main.postDelayed(() -> shotAttempt(cb, retries - 1, jpeg), 600); else cb.done(null);
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "screenshot request failed", e);
            cb.done(null);
        }
    }

    @android.annotation.SuppressLint("NewApi")
    private static byte[] encode(ScreenshotResult r, boolean jpeg) {
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
            if (!out.compress(jpeg ? Bitmap.CompressFormat.JPEG : Bitmap.CompressFormat.PNG, jpeg ? 88 : 100, b)) return null;
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
