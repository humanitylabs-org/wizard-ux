package ai.wizards.os;

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
import android.view.MotionEvent;
import android.webkit.WebView;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.util.Collections;
import java.util.UUID;

/** Exact-origin main-frame port. No URL parameter, arbitrary intent or generic privileged RPC. */
public final class HomeScreenShortcuts {
    private HomeScreenShortcuts() {}
    public static String origin(Context c) { return ai.wizards.os.device.AppState.primaryOrigin(c); }
    public static Uri taskUri(Context c, String appId) {
        return new Uri.Builder().scheme("wizard-homeapp").authority(c.getPackageName())
            .appendPath(HomeScreenPolicy.identity(origin(c), appId)).appendQueryParameter("app", appId).build();
    }
    public static String appId(Context c, Intent intent) {
        try {
            Uri u = intent == null ? null : intent.getData();
            String id = u == null ? null : u.getQueryParameter("app");
            if (!HomeScreenPolicy.validId(id) || !taskUri(c,id).equals(u)) return null;
            return id;
        } catch (RuntimeException malformed) { return null; }
    }
    public static boolean pinned(Context c, String appId) {
        ShortcutManager manager = c.getSystemService(ShortcutManager.class);
        if (manager == null) return false;
        String id = HomeScreenPolicy.identity(origin(c),appId);
        for (ShortcutInfo shortcut : manager.getPinnedShortcuts()) if (id.equals(shortcut.getId()) && shortcut.isPinned()) return true;
        return false;
    }
    private static boolean trusted(WebView web, String origin) {
        Uri u = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        return origin.equals(u.getScheme() + "://" + u.getEncodedAuthority())
            && ("/wizard-os-home/".equals(u.getPath()) || "/wizard-os-home/index.html".equals(u.getPath()))
            && u.getQueryParameter("app-session") == null;
    }
    public static void attach(Activity activity, WebView web) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        final HomeScreenPolicy.TapGate touch = new HomeScreenPolicy.TapGate(android.view.ViewConfiguration.get(activity).getScaledTouchSlop());
        web.setOnTouchListener((v,e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: touch.down(e.getX(),e.getY()); break;
                case MotionEvent.ACTION_MOVE: touch.move(e.getX(),e.getY()); break;
                case MotionEvent.ACTION_UP: touch.up(SystemClock.elapsedRealtime()); break;
                case MotionEvent.ACTION_CANCEL:
                case MotionEvent.ACTION_POINTER_DOWN: touch.cancel(); break;
            }
            return false;
        });
        final String origin = origin(activity);
        WebViewCompat.addWebMessageListener(web, "wizardHomeScreenPort", Collections.singleton(origin),
            (view,message,source,isMainFrame,reply) -> {
                if (!isMainFrame || source == null || !origin.equals(source.toString()) || !trusted(view,origin) || message.getType() != WebMessageCompat.TYPE_STRING) return;
                String body = message.getData(); if (body == null || body.length() > 100000) return;
                try {
                    JSONObject data = new JSONObject(body);
                    String app = data.optString("appId"), request = data.optString("requestId");
                    if (!HomeScreenPolicy.validId(app) || !request.matches("[0-9]{1,12}")) return;
                    java.util.function.Consumer<String> send = status -> {
                        try { if (trusted(view,origin)) reply.postMessage(new JSONObject().put("requestId",request).put("status",status).toString()); } catch (Exception ignored) { /* navigation closed port */ }
                    };
                    ShortcutManager manager = activity.getSystemService(ShortcutManager.class);
                    if (manager == null || !manager.isRequestPinShortcutSupported()) { send.accept("unsupported"); return; }
                    String op = data.optString("op");
                    if ("status".equals(op)) { send.accept(pinned(activity,app) ? "pinned" : "ready"); return; }
                    if (!"pin".equals(op)) return;
                    final long gesture = touch.claim(SystemClock.elapsedRealtime());
                    final String page = view.getUrl();
                    if (gesture < 0 || !activity.hasWindowFocus()) { send.accept("error"); return; }
                    // The scoped port proves origin/main-frame, activation proves a current intentional gesture.
                    final long requestedAt = SystemClock.elapsedRealtime();
                    String activation = "Boolean(navigator.userActivation && navigator.userActivation.isActive"
                        + " && window.WizHomeScreenApps && WizHomeScreenApps.state.pending"
                        + " && WizHomeScreenApps.state.appId === " + JSONObject.quote(app)
                        + " && window.WizCore && window.WizHomeScreenPolicy && (function(){"
                        + "var a=WizCore.apps('mobile').APP[" + JSONObject.quote(app) + "];"
                        + "return a && a.kind==='wizard' && a.url && !WizHomeScreenPolicy.isShell(a.url)"
                        + " && WizHomeScreenPolicy.within(a.url,a.url);})())";
                    view.evaluateJavascript(activation, result -> {
                        if (!"true".equals(result) || !touch.current(gesture) || !activity.hasWindowFocus()
                                || SystemClock.elapsedRealtime() - requestedAt > 1500
                                || !page.equals(view.getUrl()) || !trusted(view,origin)) { send.accept("error"); return; }
                        try { send.accept(pin(activity,data)); } catch (Exception error) { send.accept("error"); }
                    });
                } catch (Exception ignored) { /* malformed/untrusted messages fail closed */ }
            });
    }
    private static String pin(Context c, JSONObject data) {
        String app = data.optString("appId"), name = data.optString("name"), png = data.optString("icon");
        name = HomeScreenPolicy.displayName(app,name);
        if (name.trim().isEmpty() || name.length() > 80 || !png.startsWith("data:image/png;base64,") || png.length() > 90000) return "error";
        if (pinned(c,app)) return "pinned";
        byte[] bytes = Base64.decode(png.substring(22),Base64.DEFAULT);
        BitmapFactory.Options size = new BitmapFactory.Options(); size.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes,0,bytes.length,size);
        if (size.outWidth < 48 || size.outWidth > 256 || size.outHeight < 48 || size.outHeight > 256) return "error";
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes,0,bytes.length);
        if (bitmap == null) return "error";
        String shortcutId = HomeScreenPolicy.identity(origin(c),app), token = UUID.randomUUID().toString();
        c.getSharedPreferences("home-screen-pins",Context.MODE_PRIVATE).edit().putString(shortcutId,token)
            .putString(shortcutId + ":name",name).putString(shortcutId + ":icon",png).apply();
        Intent launch = new Intent(c,AppSessionActivity.class).setAction(Intent.ACTION_VIEW).setData(taskUri(c,app))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_NEW_TASK);
        ShortcutInfo shortcut = new ShortcutInfo.Builder(c,shortcutId).setShortLabel(name).setLongLabel(name)
            .setIcon(Icon.createWithBitmap(bitmap)).setIntent(launch).build();
        Intent callback = new Intent(c,PinConfirmed.class).setData(taskUri(c,app)).putExtra("token",token);
        PendingIntent pending = PendingIntent.getBroadcast(c,0,callback,PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return c.getSystemService(ShortcutManager.class).requestPinShortcut(shortcut,pending.getIntentSender()) ? "pending" : "unsupported";
    }
    /** Launcher invokes only after confirmation. A request dispatch is never a successful pin. */
    public static final class PinConfirmed extends BroadcastReceiver {
        @Override public void onReceive(Context c, Intent intent) {
            String app = appId(c,intent); if (app == null) return;
            String id = HomeScreenPolicy.identity(origin(c),app);
            String expected = c.getSharedPreferences("home-screen-pins",Context.MODE_PRIVATE).getString(id,"");
            if (expected.isEmpty() || !expected.equals(intent.getStringExtra("token")) || !pinned(c,app)) return;
            c.getSharedPreferences("home-screen-pins",Context.MODE_PRIVATE).edit().remove(id).putBoolean(id + ":confirmed",true).apply();
        }
    }
}
