package ai.wizards.os.badge;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.widget.RemoteViews;

import ai.wizards.os.AppSessionActivity;
import ai.wizards.os.HomeScreenPolicy;
import ai.wizards.os.HomeScreenShortcuts;
import ai.wizards.os.R;

/**
 * (3) Fallback: a 1x1 "Messenger" widget that draws the same icon plus count bubble. Not on the default path: it
 * exists only when James places it (page bridge op "pin-widget" -> requestPinAppWidget) if the shortcut redraw
 * proves unreliable on his launcher.
 */
public final class UnreadWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context c, AppWidgetManager mgr, int[] ids) {
        mgr.updateAppWidget(ids, views(c, UnreadBadges.storedCount(c, UnreadBadges.APP_ID)));
        // Newly placed: bring the count up to date without waiting for the next loop tick.
        new Thread(() -> { try { UnreadBadges.pollNow(c.getApplicationContext()); } catch (RuntimeException ignored) { /* next tick */ } }, "wizard-unread-widget").start();
    }

    static RemoteViews views(Context c, int count) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_messenger);
        v.setImageViewBitmap(R.id.widget_icon, BadgeCompositor.compose(base(c), count));
        Intent open = new Intent(c, AppSessionActivity.class).setAction(Intent.ACTION_VIEW)
                .setData(HomeScreenShortcuts.taskUri(c, UnreadBadges.APP_ID))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.widget_icon, PendingIntent.getActivity(c, 7491, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }

    /** The shell-drawn Messenger icon if we have one, else the app's own launcher icon. */
    static Bitmap base(Context c) {
        String id = HomeScreenPolicy.identity(HomeScreenShortcuts.origin(c), UnreadBadges.APP_ID);
        SharedPreferences pins = c.getSharedPreferences("home-screen-pins", Context.MODE_PRIVATE);
        String png = pins.getString(id + ":icon", pins.getString(id + ":wicon", null));
        Bitmap b = png == null ? null : HomeScreenShortcuts.decodeIcon(png);
        if (b != null) return b;
        Drawable d = c.getPackageManager().getApplicationIcon(c.getApplicationInfo());
        Bitmap out = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
        d.setBounds(0, 0, 192, 192);
        d.draw(new Canvas(out));
        return out;
    }

    /** Page-bridge entry: remember the icon the shell drew and ask the launcher to place the widget (user confirms). */
    public static String requestPin(Context c, String png) {
        AppWidgetManager mgr = c.getSystemService(AppWidgetManager.class);
        if (mgr == null || !mgr.isRequestPinAppWidgetSupported()) return "unsupported";
        if (png != null && !png.isEmpty()) {
            String id = HomeScreenPolicy.identity(HomeScreenShortcuts.origin(c), UnreadBadges.APP_ID);
            c.getSharedPreferences("home-screen-pins", Context.MODE_PRIVATE).edit().putString(id + ":wicon", png).apply();
        }
        return mgr.requestPinAppWidget(new ComponentName(c, UnreadWidget.class), null, null) ? "pending" : "unsupported";
    }
}
