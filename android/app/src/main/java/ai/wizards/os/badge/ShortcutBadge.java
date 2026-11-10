package ai.wizards.os.badge;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.util.Log;

import java.util.Collections;

import ai.wizards.os.HomeScreenPolicy;
import ai.wizards.os.HomeScreenShortcuts;

/** (1) Primary: redraw the pinned Messenger shortcut's own icon with the red bubble. Updates, never pins. */
final class ShortcutBadge implements BadgeSync.Mechanism {
    private final Context c;
    ShortcutBadge(Context c) { this.c = c; }
    @Override public String id() { return "shortcut"; }

    @Override public boolean rateLimited() {
        ShortcutManager m = c.getSystemService(ShortcutManager.class);
        return m != null && m.isRateLimitingActive(); // foreground-service apps are exempt; others retry next tick
    }

    @Override public boolean apply(int count) {
        ShortcutManager m = c.getSystemService(ShortcutManager.class);
        if (m == null) return false;
        if (!HomeScreenShortcuts.pinned(c, UnreadBadges.APP_ID)) return true; // nothing on the home screen to badge
        String id = HomeScreenPolicy.identity(HomeScreenShortcuts.origin(c), UnreadBadges.APP_ID);
        SharedPreferences pins = c.getSharedPreferences("home-screen-pins", Context.MODE_PRIVATE);
        String png = pins.getString(id + ":icon", null), name = pins.getString(id + ":name", null);
        // The shell page stores the plain icon at each pin/refresh; without it there is nothing to draw on yet.
        if (png == null || name == null) { Log.i(UnreadBadges.TAG, "shortcut: no base icon yet (icon=" + (png != null) + " name=" + (name != null) + ")"); return false; }
        Bitmap base = HomeScreenShortcuts.decodeIcon(png);
        if (base == null) return false;
        ShortcutInfo s = new ShortcutInfo.Builder(c, id).setShortLabel(name).setLongLabel(name)
                .setIcon(Icon.createWithBitmap(BadgeCompositor.compose(base, count))).build();
        boolean ok = m.updateShortcuts(Collections.singletonList(s));
        Log.i(UnreadBadges.TAG, "shortcut icon count=" + count + " ok=" + ok);
        return ok;
    }
}
