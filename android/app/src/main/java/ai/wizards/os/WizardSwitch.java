package ai.wizards.os;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Intent;
import android.widget.Toast;
import java.net.URI;
import java.util.Locale;

/**
 * Switching to another of the owner's Wizards stays inside this app: the same steps as Change Wizard
 * (check the address answers like a Wizard, save it as the app's Wizard, reopen), started by one tap in the
 * shell's switcher. Without this the shell's browser fallback navigated the WebView to the other
 * Wizard's origin, which {@code shouldOverrideUrlLoading} hands to the system browser.
 */
final class WizardSwitch {
    private WizardSwitch() {}

    /**
     * The origin to switch to, or null when this is not a one-tap switch: only https Wizards on the same
     * tailnet (*.ts.net, same tailnet name) as the current Wizard, never the current one, never a
     * path/query/credentials. Anything else keeps the pasted-address Change Wizard flow.
     */
    static String target(String current, String requested) { return target(current, requested, false); }

    /** {@code qa}: debug builds only, where two loopback fakes on the emulator host stand in for two Wizards. */
    static String target(String current, String requested, boolean qa) {
        String to = ServerOrigin.parse(requested, qa);
        String from = ServerOrigin.parse(current, qa);
        if (to == null || from == null || to.equals(from)) return null;
        if (qa && to.startsWith("http://") && from.startsWith("http://")) return to;
        String a = tailnet(host(from)), b = tailnet(host(to));
        return a != null && a.equals(b) ? to : null;
    }

    /** "name.tailXXXX.ts.net" -> "tailxxxx.ts.net"; null for anything that is not a ts.net machine name. */
    static String tailnet(String host) {
        if (host == null) return null;
        String[] parts = host.toLowerCase(Locale.ROOT).split("\\.");
        if (parts.length < 4 || !parts[parts.length - 1].equals("net") || !parts[parts.length - 2].equals("ts")) return null;
        return parts[parts.length - 3] + ".ts.net";
    }

    private static String host(String origin) {
        try { return new URI(origin).getHost(); } catch (Exception e) { return null; }
    }

    /** Check the Wizard answers, then save it and reopen the app on it. Failure keeps the current Wizard. */
    static void start(Activity a, String origin, Runnable failed) {
        new Thread(() -> {
            String error = null;
            try { WizardProbe.check(origin); }
            catch (Exception e) { error = "Couldn't reach that Wizard. Check that Tailscale is on, then try again."; }
            final String problem = error;
            a.runOnUiThread(() -> {
                if (a.isFinishing() || a.isDestroyed()) return;
                if (problem == null && !ServerSettings.save(a, origin)) {
                    ServerSwitchGuard.Reason why = ServerSwitchGuard.blocker(a);
                    Toast.makeText(a, ServerSwitchGuard.say(why), Toast.LENGTH_LONG).show();
                    failed.run();
                    // Not a dead end: the page opens the unsent recording with Send / Delete (#1220).
                    if (why == ServerSwitchGuard.Reason.SAVED_RECORDING && a instanceof MainActivity) ((MainActivity) a).showUnsentRecordings();
                    return;
                }
                if (problem != null) { Toast.makeText(a, problem, Toast.LENGTH_LONG).show(); failed.run(); return; }
                relaunch(a);
            });
        }, "WizardSwitch").start();
    }

    /** Same as leaving Connect: old app-session documents must not keep the old Wizard's bridges. */
    static void relaunch(Activity a) {
        ActivityManager am = a.getSystemService(ActivityManager.class);
        if (am != null) for (ActivityManager.AppTask task : am.getAppTasks()) {
            if (task.getTaskInfo().id != a.getTaskId()) task.finishAndRemoveTask();
        }
        a.startActivity(new Intent(a, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
        a.finish();
    }
}
