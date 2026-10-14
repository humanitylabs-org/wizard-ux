package ai.wizards.os;

import android.app.ActivityManager;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.os.Bundle;

/** Android document task: component + canonical data URI selects/reuses exactly one app session. */
public final class AppSessionActivity extends MainActivity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        applyImmersive(true);
        String app = HomeScreenShortcuts.appId(this,getIntent());
        if (app != null) {
            ShortcutManager manager = getSystemService(ShortcutManager.class);
            if (manager != null) for (ShortcutInfo shortcut : manager.getPinnedShortcuts()) {
                if (HomeScreenPolicy.identity(HomeScreenShortcuts.origin(this),app).equals(shortcut.getId())) {
                    android.graphics.Bitmap bitmap = null;
                    try {
                        String png = getSharedPreferences("home-screen-pins",MODE_PRIVATE).getString(shortcut.getId() + ":icon", "");
                        if (png.startsWith("data:image/png;base64,")) { byte[] bytes = android.util.Base64.decode(png.substring(22),android.util.Base64.DEFAULT); bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length); }
                    } catch (Exception ignored) { /* label remains useful */ }
                    setTaskDescription(new ActivityManager.TaskDescription(shortcut.getShortLabel().toString(),bitmap,0xff110d1b));
                    break;
                }
            }
        }
    }
    @Override String startUrl(Intent intent) {
        String app = HomeScreenShortcuts.appId(this,intent);
        return ai.wizards.os.device.AppState.homeUrl(this) + "?app-session=" + android.net.Uri.encode(app == null ? "" : app);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // intoExisting has already selected this exact canonical component/data task.
        // Re-tapping an icon resumes the WebView instead of resetting its route/history.
        if (getIntent().getData() != null && getIntent().getData().equals(intent.getData())) setIntent(intent);
    }
    boolean acceptsUrl(String raw) {
        try {
            android.net.Uri u = android.net.Uri.parse(raw);
            String id = HomeScreenShortcuts.appId(this,getIntent());
            return HomeScreenShortcuts.origin(this).equals(u.getScheme() + "://" + u.getEncodedAuthority())
                && ("/wizard-os-home/".equals(u.getPath()) || "/wizard-os-home/index.html".equals(u.getPath()))
                && (id == null ? "" : id).equals(u.getQueryParameter("app-session"));
        } catch (Exception invalid) { return false; }
    }
    @Override void applyImmersive(boolean ignored) { super.applyImmersive(true); }
}
