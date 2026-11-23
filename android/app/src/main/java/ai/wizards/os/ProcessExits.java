package ai.wizards.os;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Records why earlier WizardOS processes died, once per process start (wizard-ux#1724): Android 11+ keeps
 * ApplicationExitInfo for each dead process; this copies the new ones into {@link ProcessExitLog}, logs them and lets
 * the recorder and the phone diagnostics report name the cause.
 */
public final class ProcessExits {
    private static final String TAG = "WizardExit";
    private static ProcessExitLog log;
    private static boolean read;

    private ProcessExits() {}

    public static synchronized ProcessExitLog log(Context c) {
        if (log == null) log = new ProcessExitLog(new File(new File(c.getApplicationContext().getFilesDir(), "diagnostics"), "process-exits.json"));
        return log;
    }

    /** Reads Android's exit records once per process. Cheap and safe to call from every start path. */
    public static synchronized ProcessExitLog refresh(Context c) {
        ProcessExitLog l = log(c);
        if (read) return l;
        read = true;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return l;
        List<ProcessExitLog.Exit> got = new ArrayList<>();
        try {
            ActivityManager am = c.getSystemService(ActivityManager.class);
            for (ApplicationExitInfo i : am.getHistoricalProcessExitReasons(null, 0, ProcessExitLog.KEEP)) {
                ProcessExitLog.Exit e = new ProcessExitLog.Exit();
                e.timestamp = i.getTimestamp(); e.pid = i.getPid(); e.process = String.valueOf(i.getProcessName());
                e.reason = i.getReason(); e.status = i.getStatus(); e.importance = i.getImportance();
                e.pssKb = i.getPss(); e.rssKb = i.getRss();
                e.description = i.getDescription() == null ? "" : i.getDescription();
                // An ANR comes with Android's own thread dump: keep the main thread's frames (wizard-ux#1762).
                if (e.reason == ApplicationExitInfo.REASON_ANR && e.timestamp > l.lastSeen()) {
                    try (java.io.InputStream in = i.getTraceInputStream()) { e.frames.addAll(HangLog.mainFrames(in)); }
                    catch (java.io.IOException | RuntimeException x) { Log.w(TAG, "could not read the ANR trace", x); }
                }
                got.add(e);
            }
        } catch (RuntimeException e) { Log.w(TAG, "could not read process exit reasons", e); return l; }
        for (ProcessExitLog.Exit e : l.add(got)) Log.w(TAG, "earlier process ended: " + ProcessExitLog.line(e));
        return l;
    }

    /**
     * A recording started and Android still optimises WizardOS's battery: a microphone foreground service is exempt
     * from Doze and app standby, but not from OEM app killers (Samsung's sleeping apps / memory management), which
     * respect only the "Unrestricted" setting this dialog grants. Asked once per install, from a visible start.
     * Returns whether the dialog was opened.
     */
    @android.annotation.SuppressLint("BatteryLife")
    public static boolean askBatteryExemptionOnce(Context c) {
        boolean exempt = batteryExempt(c);
        Log.i(TAG, "recording started; battery optimisation exempt=" + exempt);
        if (exempt) return false;
        android.content.SharedPreferences p = c.getSharedPreferences("wizard_battery", Context.MODE_PRIVATE);
        if (p.getBoolean("askedForRecorder", false)) return false;
        p.edit().putBoolean("askedForRecorder", true).apply();
        try {
            c.startActivity(new android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    android.net.Uri.parse("package:" + c.getPackageName())).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "could not ask for the battery exemption", e);
            return false;
        }
    }

    /** Whether Android leaves WizardOS out of battery optimisation ("Unrestricted"), which OEM app killers respect. */
    public static boolean batteryExempt(Context c) {
        try {
            PowerManager pm = c.getSystemService(PowerManager.class);
            return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
        } catch (RuntimeException e) { return false; }
    }
}
