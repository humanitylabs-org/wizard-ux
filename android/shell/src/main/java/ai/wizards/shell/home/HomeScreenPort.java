package ai.wizards.shell.home;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.webkit.WebView;

import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.util.Collections;
import java.util.UUID;
import java.util.function.Consumer;

import ai.wizards.shell.ShellOrigin;

/**
 * window.wizardHomeScreenPort: the contract web/core/home-screen-apps.js already speaks to the full app
 * (android/app HomeScreenShortcuts), unchanged. Page → native {op:'status'|'pin', requestId, appId, name?, icon?};
 * native → page {requestId, status: ready|pinned|pending|unsupported|error}.
 *
 * Injected only for the selected Wizard's exact origin, answered only for the main frame while the top-level page is
 * that Wizard's own /wizard-os-home/ shell (never a pinned-app session). A pin needs a fresh native tap on the WebView
 * plus the page's live user activation on its own pin sheet. No URL crosses: the pin opens a registered app ID.
 */
public final class HomeScreenPort {
    private static final String TAG = "ShellHome";
    public static final String NAME = "wizardHomeScreenPort";
    static final String PREFS = "home-screen-pins";

    private HomeScreenPort() {}

    /** Canonical task URI of one app on the selected Wizard. */
    public static Uri taskUri(Context c, String origin, String appId) {
        return Uri.parse(HomeScreenPolicy.taskUri(c.getPackageName(), origin, appId));
    }

    /** The app a launch intent asks for on the selected Wizard, else null. */
    public static String appId(Context c, Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        return u == null ? null : HomeScreenPolicy.appFromTask(u.toString(), c.getPackageName(), ShellOrigin.selected(c));
    }

    static boolean pinned(Context c, String origin, String appId) {
        ShortcutManager manager = c.getSystemService(ShortcutManager.class);
        if (manager == null) return false;
        String id = HomeScreenPolicy.identity(origin, appId);
        for (ShortcutInfo s : manager.getPinnedShortcuts()) if (id.equals(s.getId()) && s.isPinned()) return true;
        return false;
    }

    /** Installs the port on the shell's WebView for exactly this origin. Before the first load. */
    public static void install(Activity activity, WebView web, String origin) {
        if (origin == null || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        final HomeScreenPolicy.TapGate touch = new HomeScreenPolicy.TapGate(ViewConfiguration.get(activity).getScaledTouchSlop());
        web.setOnTouchListener((v, e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: touch.down(e.getX(), e.getY()); break;
                case MotionEvent.ACTION_MOVE: touch.move(e.getX(), e.getY()); break;
                case MotionEvent.ACTION_UP: touch.up(SystemClock.elapsedRealtime()); break;
                case MotionEvent.ACTION_CANCEL:
                case MotionEvent.ACTION_POINTER_DOWN: touch.cancel(); break;
                default: break;
            }
            return false;
        });
        try {
            WebViewCompat.addWebMessageListener(web, NAME, Collections.singleton(origin), (view, message, source, isMainFrame, reply) -> {
                if (!isMainFrame || source == null || !ShellOrigin.same(origin, source.toString())
                        || !HomeScreenPolicy.shellPage(origin, view.getUrl()) || message.getType() != WebMessageCompat.TYPE_STRING) return;
                String body = message.getData();
                if (body == null || body.length() > 100000) return;
                try {
                    JSONObject data = new JSONObject(body);
                    String app = data.optString("appId"), request = data.optString("requestId");
                    if (!HomeScreenPolicy.validId(app) || !HomeScreenPolicy.validRequest(request)) return;
                    Consumer<String> send = status -> {
                        try {
                            if (HomeScreenPolicy.shellPage(origin, view.getUrl()))
                                reply.postMessage(new JSONObject().put("requestId", request).put("status", status).toString());
                        } catch (Exception ignored) { /* navigation closed the port */ }
                    };
                    ShortcutManager manager = activity.getSystemService(ShortcutManager.class);
                    if (manager == null || !manager.isRequestPinShortcutSupported()) { send.accept("unsupported"); return; }
                    String op = data.optString("op");
                    if ("status".equals(op)) { send.accept(pinned(activity, origin, app) ? "pinned" : "ready"); return; }
                    if (!"pin".equals(op)) return;
                    final long gesture = touch.claim(SystemClock.elapsedRealtime());
                    final String page = view.getUrl();
                    if (gesture < 0 || !activity.hasWindowFocus()) { Log.i(TAG, "pin refused: no fresh tap"); send.accept("error"); return; }
                    final long asked = SystemClock.elapsedRealtime();
                    // The scoped port proves origin + main frame; this proves the page's own pin sheet holds a live tap.
                    String activation = "Boolean(navigator.userActivation && navigator.userActivation.isActive"
                            + " && window.WizHomeScreenApps && WizHomeScreenApps.state.pending"
                            + " && WizHomeScreenApps.state.appId === " + JSONObject.quote(app)
                            + " && window.WizCore && window.WizHomeScreenPolicy && (function(){"
                            + "var a=WizCore.apps('mobile').APP[" + JSONObject.quote(app) + "];"
                            + "return a && a.kind==='wizard' && a.url && !WizHomeScreenPolicy.isShell(a.url)"
                            + " && WizHomeScreenPolicy.within(a.url,a.url);})())";
                    view.evaluateJavascript(activation, result -> {
                        if (!"true".equals(result) || !touch.current(gesture) || !activity.hasWindowFocus()
                                || SystemClock.elapsedRealtime() - asked > 1500 || page == null || !page.equals(view.getUrl())
                                || !HomeScreenPolicy.shellPage(origin, view.getUrl())) {
                            Log.i(TAG, "pin refused: activation " + result); send.accept("error"); return;
                        }
                        try { String s = pin(activity, origin, data); Log.i(TAG, "pin " + app + ": " + s); send.accept(s); }
                        catch (Exception error) { Log.w(TAG, "pin failed", error); send.accept("error"); }
                    });
                } catch (Exception ignored) { /* malformed or untrusted messages fail closed */ }
            });
        } catch (RuntimeException e) {
            Log.w(TAG, "no home-screen port", e);
        }
    }

    private static String pin(Context c, String origin, JSONObject data) {
        String app = data.optString("appId"), png = data.optString("icon");
        String name = HomeScreenPolicy.displayName(app, data.optString("name"));
        if (!HomeScreenPolicy.validLabel(name) || !HomeScreenPolicy.validIconData(png)) return "error";
        if (pinned(c, origin, app)) return "pinned";
        byte[] bytes = Base64.decode(png.substring(22), Base64.DEFAULT);
        BitmapFactory.Options size = new BitmapFactory.Options();
        size.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, size);
        if (!HomeScreenPolicy.validIconSize(size.outWidth, size.outHeight)) return "error";
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) return "error";
        String shortcutId = HomeScreenPolicy.identity(origin, app), token = UUID.randomUUID().toString();
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(shortcutId, token)
                .putString(shortcutId + ":icon", png).apply();
        Intent launch = new Intent(c, AppSessionActivity.class).setAction(Intent.ACTION_VIEW).setData(taskUri(c, origin, app))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_NEW_TASK);
        ShortcutInfo shortcut = new ShortcutInfo.Builder(c, shortcutId).setShortLabel(name).setLongLabel(name)
                .setIcon(Icon.createWithBitmap(bitmap)).setIntent(launch).build();
        Intent callback = new Intent(c, PinConfirmed.class).setData(taskUri(c, origin, app)).putExtra("token", token);
        PendingIntent pending = PendingIntent.getBroadcast(c, 0, callback, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return c.getSystemService(ShortcutManager.class).requestPinShortcut(shortcut, pending.getIntentSender()) ? "pending" : "unsupported";
    }

    /** The launcher calls back only after the owner confirmed. Dispatching the request is never a successful pin. */
    public static final class PinConfirmed extends BroadcastReceiver {
        @Override public void onReceive(Context c, Intent intent) {
            String app = appId(c, intent), origin = ShellOrigin.selected(c);
            if (app == null || origin == null) return;
            String id = HomeScreenPolicy.identity(origin, app);
            String expected = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(id, "");
            if (expected.isEmpty() || !expected.equals(intent.getStringExtra("token")) || !pinned(c, origin, app)) return;
            c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).putBoolean(id + ":confirmed", true).apply();
            Log.i(TAG, "pin confirmed " + app);
        }
    }
}
