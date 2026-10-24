package ai.wizards.shell.home;

import android.app.ActivityManager;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.util.Base64;

import ai.wizards.shell.ShellActivity;

/**
 * One home-screen app in its own Android task (port of android/app AppSessionActivity). The component + canonical
 * task URI pick exactly one document task per (selected Wizard, app). It opens only
 * {@code <selected Wizard>/wizard-os-home/?app-session=<id>} (the Wizard's web shows just that app), keeps the status
 * and navigation bars, consumes Back inside the app, hands tapped public links to the phone and refuses every other
 * page. Re-tapping the icon resumes it where it was (intoExisting + ShellActivity.onNewIntent). It has no connect flow and no device ports; the floating orb stays over it like over any other app.
 */
public final class AppSessionActivity extends ShellActivity {
    private String app;

    @Override protected boolean session() { return true; }

    @Override protected void onCreate(Bundle saved) {
        // An exported document target is not a connect/share entry point: drop caller actions and extras.
        app = HomeScreenPort.appId(this, getIntent());
        setIntent(new Intent(this, AppSessionActivity.class).setAction(Intent.ACTION_VIEW)
                .setData(app == null ? null : getIntent().getData()));
        super.onCreate(saved);
    }

    @Override protected void begin(Bundle saved) {
        if (origin() == null || app == null) {
            showNote("App unavailable", "This shortcut belongs to another Wizard or is no longer valid. Open Wizard to choose your Wizard, then add the app again.");
            return;
        }
        open(saved);
        // ShortcutManager does binder and disk work: keep it off the first paint.
        final String id = app;
        new Thread(() -> label(id), "home-app-label").start();
    }

    @Override protected String startUrl() { return HomeScreenPolicy.sessionUrl(origin(), app); }

    @Override protected boolean ownPage(String url) { return app != null && HomeScreenPolicy.sessionPage(origin(), url, app); }

    /** Recents shows the app's own name and icon, not "Wizard". */
    private void label(String id) {
        try {
            ShortcutManager manager = getSystemService(ShortcutManager.class);
            if (manager == null) return;
            String want = HomeScreenPolicy.identity(origin(), id);
            for (ShortcutInfo s : manager.getPinnedShortcuts()) {
                if (!want.equals(s.getId())) continue;
                Bitmap bitmap = null;
                try {
                    String png = getSharedPreferences(HomeScreenPort.PREFS, MODE_PRIVATE).getString(want + ":icon", "");
                    if (HomeScreenPolicy.validIconData(png)) {
                        byte[] bytes = Base64.decode(png.substring(22), Base64.DEFAULT);
                        bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    }
                } catch (RuntimeException ignored) { /* the name alone is still useful */ }
                @SuppressWarnings("deprecation")
                ActivityManager.TaskDescription d = new ActivityManager.TaskDescription(String.valueOf(s.getShortLabel()), bitmap, 0xff110d1b);
                runOnUiThread(() -> { if (!isFinishing() && !isDestroyed()) setTaskDescription(d); });
                return;
            }
        } catch (RuntimeException ignored) { /* launcher unavailable: the task still works */ }
    }
}
