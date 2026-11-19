package ai.wizards.os.badge;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;

/** (3) Fallback: refresh any placed 1x1 Messenger widget. A no-op (counts as in sync) when none is placed. */
final class WidgetBadge implements BadgeSync.Mechanism {
    private final Context c;
    WidgetBadge(Context c) { this.c = c; }
    @Override public String id() { return "widget"; }
    @Override public boolean rateLimited() { return false; }
    @Override public boolean apply(int count) {
        AppWidgetManager w = c.getSystemService(AppWidgetManager.class);
        if (w == null) return false;
        int[] ids = w.getAppWidgetIds(new ComponentName(c, UnreadWidget.class));
        if (ids.length == 0) return true;
        w.updateAppWidget(ids, UnreadWidget.views(c, count));
        return true;
    }
}
