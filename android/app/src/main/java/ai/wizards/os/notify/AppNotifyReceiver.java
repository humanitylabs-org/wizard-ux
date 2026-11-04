package ai.wizards.os.notify;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;

import ai.wizards.os.device.AppState;
import ai.wizards.os.device.Http;

/**
 * A button or inline reply on an app notification: posted as the owner to the app's own inbox action route
 * (`POST /<app>/api/inbox/act` {key, action, text}), the same one the Chats inbox uses. Not exported; only our
 * PendingIntents reach it. Success removes the notification (the app also drops the item from its feed, which
 * clears it everywhere); a failure says so on the same notification and keeps Reply.
 */
public final class AppNotifyReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !AppNotifications.ACTION_ACT.equals(intent.getAction())) return;
        final Context c = context.getApplicationContext();
        final String app = intent.getStringExtra(AppNotifications.EXTRA_APP), key = intent.getStringExtra(AppNotifications.EXTRA_KEY),
                action = intent.getStringExtra(AppNotifications.EXTRA_ACTION);
        if (!AppNotifyPolicy.validApp(app) || !AppNotifyPolicy.validKey(key) || !AppNotifyPolicy.validAction(action)) return;
        Bundle in = RemoteInput.getResultsFromIntent(intent);
        CharSequence typed = in == null ? null : in.getCharSequence(AppNotifications.REPLY_KEY);
        final String text = typed == null ? null : typed.toString().trim();
        final PendingResult pending = goAsync();
        new Thread(() -> {
            String origin = AppState.origin(c);
            if (!origin.equals(intent.getStringExtra(AppNotifications.EXTRA_ORIGIN))) {
                // From the Wizard the owner switched away from: never answer it to the new one.
                AppNotifications.cancel(c, app, key);
                pending.finish();
                return;
            }
            try {
                JSONObject body = new JSONObject().put("key", key).put("action", action);
                if (text != null) {
                    if (text.isEmpty()) { AppNotifications.failed(c, origin, app, key, "Type a reply first."); return; }
                    body.put("text", text);
                }
                Http.json("POST", AppNotifyPolicy.actUrl(origin, AppNotifications.appPath(c, origin, app)), origin,
                        body.toString().getBytes(StandardCharsets.UTF_8), "application/json");
                AppNotifications.cancel(c, app, key);
                Log.i(AppNotifications.TAG, "sent " + action + " to " + app);
            } catch (Exception e) {
                Log.w(AppNotifications.TAG, action + " to " + app + " failed: " + e.getMessage());
                String name = AppNotifications.appName(c, origin, app);
                AppNotifications.failed(c, origin, app, key, text != null
                        ? "Not sent: \u201c" + (text.length() > 120 ? text.substring(0, 120) + "\u2026" : text) + "\u201d. Is Tailscale on? Try again or tap to open " + name + "."
                        : "Couldn\u2019t reach " + name + ". Tap to open it.");
            } finally {
                pending.finish();
            }
        }, "wizard-app-action").start();
    }
}
