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
        if (!HomeScreenPolicy.validId(appId)) return false;
        ShortcutManager manager = c.getSystemService(ShortcutManager.class);
        if (manager == null) return false;
        String id = HomeScreenPolicy.identity(origin(c),appId);
        for (ShortcutInfo shortcut : manager.getPinnedShortcuts())
            if (ownsPinned(c,shortcut,id)) return true;
        return false;
    }
    private static boolean ownsPinned(Context c, ShortcutInfo shortcut, String id) {
        return c.getPackageName().equals(shortcut.getPackage()) && id.equals(shortcut.getId()) && shortcut.isPinned();
    }
    private static boolean trusted(WebView web, String origin) {
        Uri u = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        return origin.equals(u.getScheme() + "://" + u.getEncodedAuthority())
            && ("/wizard-os-home/".equals(u.getPath()) || "/wizard-os-home/index.html".equals(u.getPath()))
            && u.getQueryParameter("app-session") == null;
    }
    private static final java.util.concurrent.ExecutorService WORKER = java.util.concurrent.Executors.newSingleThreadExecutor();
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
                    if (!request.matches("[0-9]{1,12}")) return;
                    java.util.function.Consumer<String> send = status -> {
                        try { if (trusted(view,origin)) reply.postMessage(new JSONObject().put("requestId",request).put("status",status).toString()); } catch (Exception ignored) { /* navigation closed port */ }
                    };
                    // ShortcutManager queries/updates are @WorkerThread; replies go back on the UI thread.
                    java.util.function.Consumer<String> sendLater = status -> activity.runOnUiThread(() -> send.accept(status));
                    ShortcutManager manager = activity.getSystemService(ShortcutManager.class);
                    if (manager == null) { send.accept("unsupported"); return; }
                    String op = data.optString("op");
                    if ("pinned".equals(op)) {
                        // One bounded candidate query; never enumerate another package or create a shortcut.
                        org.json.JSONArray candidates = data.optJSONArray("candidates"), found = new org.json.JSONArray();
                        if (candidates == null || candidates.length() > 128) return;
                        java.util.List<String> ids = new java.util.ArrayList<>();
                        for (int i = 0; i < candidates.length(); i++) {
                            String candidate = candidates.getString(i);
                            if (!HomeScreenPolicy.validId(candidate)) return;
                            ids.add(candidate);
                        }
                        WORKER.execute(() -> {
                            try {
                                java.util.List<ShortcutInfo> shortcuts = manager.getPinnedShortcuts();
                                java.util.Set<String> seen = new java.util.HashSet<>();
                                for (String candidate : ids) {
                                    String id = HomeScreenPolicy.identity(origin,candidate);
                                    for (ShortcutInfo shortcut : shortcuts)
                                        if (ownsPinned(activity,shortcut,id) && seen.add(candidate)) found.put(candidate);
                                }
                                String out = new JSONObject().put("requestId",request).put("status","pinned-list").put("appIds",found).toString();
                                activity.runOnUiThread(() -> { try { if (trusted(view,origin)) reply.postMessage(out); } catch (Exception ignored) { /* port closed */ } });
                            } catch (Exception ignored) { /* fail closed */ }
                        });
                        return;
                    }
                    if (!HomeScreenPolicy.validId(app)) return;
                    if ("refresh".equals(op)) {
                        WORKER.execute(() -> { String r; try { r = refresh(activity,data); } catch (Exception error) { r = "error"; } sendLater.accept(r); });
                        return;
                    }
                    if (!manager.isRequestPinShortcutSupported()) { send.accept("unsupported"); return; }
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
    /** Both paths enforce the same PNG format and decoded size bounds. */
    private static Bitmap icon(String png) {
        if (!png.startsWith("data:image/png;base64,") || png.length() > 90000) return null;
        byte[] bytes = Base64.decode(png.substring(22),Base64.DEFAULT);
        BitmapFactory.Options size = new BitmapFactory.Options(); size.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes,0,bytes.length,size);
        if (!"image/png".equals(size.outMimeType) || size.outWidth < 48 || size.outWidth > 256 || size.outHeight < 48 || size.outHeight > 256) return null;
        return BitmapFactory.decodeByteArray(bytes,0,bytes.length);
    }
    /** No tap needed: can only change this package's existing pinned identity, never request a pin. */
    private static String refresh(Context c, JSONObject data) {
        String app = data.optString("appId"), png = data.optString("icon");
        String name = HomeScreenPolicy.displayName(app,data.optString("name"));
        if (!HomeScreenPolicy.validId(app) || name.trim().isEmpty() || name.length() > 80) return "error";
        boolean ownPinned = pinned(c,app);
        if (!ownPinned) return "ready";
        Bitmap bitmap = icon(png);
        if (bitmap == null) return "error";
        String id = HomeScreenPolicy.identity(origin(c),app);
        android.content.SharedPreferences prefs = c.getSharedPreferences("home-screen-pins",Context.MODE_PRIVATE);
        if (!HomeScreenPolicy.needsUpdate(ownPinned,prefs.getString(id + ":name",null),
                prefs.getString(id + ":icon",null),name,png)) return "unchanged";
        ShortcutInfo shortcut = new ShortcutInfo.Builder(c,id).setShortLabel(name).setLongLabel(name)
            .setIcon(Icon.createWithBitmap(bitmap)).build();
        // Recheck ownership immediately before the update; updateShortcuts itself cannot create a pin.
        if (!pinned(c,app) || !c.getSystemService(ShortcutManager.class).updateShortcuts(Collections.singletonList(shortcut))) return "error";
        prefs.edit().putString(id + ":name",name).putString(id + ":icon",png).apply();
        if (BuildConfig.DEBUG) android.util.Log.i("WizardHomeShortcuts","updated " + id);
        return "updated";
    }
    private static String pin(Context c, JSONObject data) {
        String app = data.optString("appId"), name = data.optString("name"), png = data.optString("icon");
        name = HomeScreenPolicy.displayName(app,name);
        if (!HomeScreenPolicy.validId(app) || name.trim().isEmpty() || name.length() > 80) return "error";
        if (pinned(c,app)) {
            String result = refresh(c,data);
            return "updated".equals(result) || "unchanged".equals(result) ? "pinned" : result;
        }
        Bitmap bitmap = icon(png);
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
