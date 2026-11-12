package ai.wizards.os;

import android.content.Context;
import android.content.SharedPreferences;

/** One persisted origin for the shell and every native client, including background processes. */
public final class ServerSettings {
    private ServerSettings() {}
    public static synchronized String origin(Context context) {
        SharedPreferences p = context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE);
        String saved = p.getString("origin", null);
        String origin = ServerOrigin.parse(saved, BuildConfig.DEBUG);
        if (origin == null) origin = ServerOrigin.parse(BuildConfig.ORIGIN);
        if (origin != null && !origin.equals(saved)) p.edit().putString("origin", origin).commit();
        return origin == null ? "" : origin;
    }
    public static boolean save(Context context, String origin) {
        String clean = ServerOrigin.parse(origin, BuildConfig.DEBUG);
        if (clean == null) return false;
        String old = origin(context);
        if (!old.isEmpty() && !old.equals(clean) && ServerSwitchGuard.hasLocalWork(context)) return false;
        // Recordings the old Wizard's page already took stay with that Wizard: never offered to the new one (#1220).
        // If any of them can't be marked, the switch doesn't happen.
        if (!old.isEmpty() && !old.equals(clean) && !ai.wizards.os.recording.RecordingStore.get(context).stayWith(old)) return false;
        boolean saved;
        synchronized (ServerSettings.class) {
            if (!old.equals(origin(context))) return false; // another Connect finished during the probe/check
            saved = context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().putString("origin", clean).commit();
        }
        if (saved && !old.equals(clean)) {
            SharedPreferences p = context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE);
            synchronized (ServerSettings.class) { p.edit().putString("known", KnownWizards.add(KnownWizards.add(p.getString("known", null), old), clean)).commit(); }
            if (!old.isEmpty()) context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().putString("previous", old).commit();
            context.getSharedPreferences("reply-watch", Context.MODE_PRIVATE).edit().clear().commit();
            android.app.NotificationManager nm = context.getSystemService(android.app.NotificationManager.class);
            if (nm != null) nm.cancelAll();
        }
        return saved;
    }
    /** Every Wizard this app was connected to except the current one, as [{url, name}] (the previous one included). */
    public static synchronized String known(Context context) {
        SharedPreferences p = context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE);
        return KnownWizards.others(KnownWizards.withPrevious(p.getString("known", null), previous(context)), origin(context));
    }
    /** The current Wizard's own shell tells us its name, so another Wizard can list it by name. */
    public static synchronized void nameCurrent(Context context, String name) {
        String here = origin(context);
        if (here.isEmpty()) return;
        SharedPreferences p = context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE);
        String before = p.getString("known", null), after = KnownWizards.name(before, here, name);
        if (!after.equals(before)) p.edit().putString("known", after).apply();
    }
    /** The Wizard this app was on before the last switch, so Change Wizard can offer the way back in one tap. */
    public static synchronized String previous(Context context) {
        String prev = ServerOrigin.parse(context.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).getString("previous", null), BuildConfig.DEBUG);
        return prev == null || prev.equals(origin(context)) ? null : prev;
    }
}
