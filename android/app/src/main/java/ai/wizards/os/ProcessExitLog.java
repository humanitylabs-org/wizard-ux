package ai.wizards.os;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Why earlier WizardOS processes ended (Android's ApplicationExitInfo), kept on the phone so an early meeting stop or
 * any other sudden close can be explained afterwards (wizard-ux#1724). Pure data + one JSON file
 * (filesDir/diagnostics/process-exits.json); {@link ProcessExits} feeds it from ActivityManager.
 *
 * Only system facts are kept: reason code and name, status/signal, importance, memory, timestamp and Android's own short
 * description. Never page content.
 */
public final class ProcessExitLog {
    public static final int KEEP = 20;
    static final int DESCRIPTION_MAX = 200;

    /** One process exit, as Android reported it. */
    public static final class Exit {
        public long timestamp;
        public int pid, reason, status, importance;
        public long pssKb, rssKb;
        public String process = "", description = "";
        /** For an ANR: the main thread's frames from Android's trace ({@link HangLog#mainFrames}), else empty. */
        public final List<String> frames = new ArrayList<>();

        public String reasonName() { return ProcessExitLog.reasonName(reason); }

        JSONObject json() throws JSONException {
            JSONObject o = new JSONObject().put("timestamp", timestamp).put("pid", pid).put("process", process)
                    .put("reason", reason).put("reasonName", reasonName()).put("status", status)
                    .put("importance", importance).put("pssKb", pssKb).put("rssKb", rssKb).put("description", description);
            if (!frames.isEmpty()) { JSONArray f = new JSONArray(); for (String s : frames) f.put(s); o.put("frames", f); }
            return o;
        }

        static Exit from(JSONObject o) {
            Exit e = new Exit();
            e.timestamp = o.optLong("timestamp"); e.pid = o.optInt("pid"); e.process = o.optString("process", "");
            e.reason = o.optInt("reason"); e.status = o.optInt("status"); e.importance = o.optInt("importance");
            e.pssKb = o.optLong("pssKb"); e.rssKb = o.optLong("rssKb"); e.description = o.optString("description", "");
            JSONArray f = o.optJSONArray("frames");
            if (f != null) for (int i = 0; i < f.length() && e.frames.size() < HangLog.FRAMES; i++) { String s = HangLog.frame(f.optString(i)); if (!s.isEmpty()) e.frames.add(s); }
            return e;
        }
    }

    private final File file;
    private final List<Exit> exits = new ArrayList<>();
    private long lastSeen;
    private boolean unreported;

    public ProcessExitLog(File file) {
        this.file = file;
        try (FileInputStream in = new FileInputStream(file)) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) > 0) bytes.write(buf, 0, n);
            JSONObject o = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            lastSeen = o.optLong("lastSeen");
            unreported = o.optBoolean("unreported");
            JSONArray a = o.optJSONArray("exits");
            if (a != null) for (int i = 0; i < a.length(); i++) { JSONObject e = a.optJSONObject(i); if (e != null) exits.add(Exit.from(e)); }
        } catch (Exception ignored) { /* first run or unreadable: start empty */ }
    }

    /** Android's reason codes (ApplicationExitInfo.REASON_*), in plain words. */
    public static String reasonName(int reason) {
        switch (reason) {
            case 1: return "exit_self";
            case 2: return "signaled";
            case 3: return "low_memory";
            case 4: return "crash";
            case 5: return "crash_native";
            case 6: return "anr";
            case 7: return "initialization_failure";
            case 8: return "permission_change";
            case 9: return "excessive_resource_usage";
            case 10: return "user_requested";
            case 11: return "user_stopped";
            case 12: return "dependency_died";
            case 13: return "other";
            case 14: return "freezer";
            case 15: return "package_state_change";
            case 16: return "package_updated";
            default: return "unknown";
        }
    }

    /** One short phrase an owner understands, for a notice ("Android closed it: low memory"). */
    public static String plain(Exit e) {
        if (e == null) return "";
        switch (e.reason) {
            case 3: return "low memory";
            case 4: case 5: return "the app crashed";
            case 6: return "the app stopped responding";
            case 9: return "battery or resource limits";
            case 10: case 11: return "it was stopped from the phone's settings";
            case 14: return "the app was frozen in the background";
            case 15: case 16: return "an app update";
            case 2: return "the phone's system killed it";
            default: return "unknown (" + reasonName(e.reason) + ")";
        }
    }

    /** {@link #plain} for a stored reason name ("low_memory"); "" when there is none. */
    public static String plainName(String reasonName) {
        if (reasonName == null || reasonName.isEmpty()) return "";
        for (int code = 1; code <= 16; code++) if (reasonName(code).equals(reasonName)) {
            Exit e = new Exit(); e.reason = code; return plain(e);
        }
        return "";
    }

    static String clean(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (char ch : s.toCharArray()) if (ch >= 0x20 && ch != 0x7f) b.append(ch);
        String out = b.toString().trim();
        return out.length() > DESCRIPTION_MAX ? out.substring(0, DESCRIPTION_MAX) : out;
    }

    /**
     * Adds the exits newer than the last one seen (Android returns the newest first and keeps old ones around).
     * Returns the new ones, newest first; marks the log unreported when there are any.
     */
    public synchronized List<Exit> add(List<Exit> reported) {
        List<Exit> fresh = new ArrayList<>();
        long newest = lastSeen;
        for (Exit e : reported) {
            if (e == null || e.timestamp <= lastSeen) continue;
            e.description = clean(e.description);
            e.process = clean(e.process);
            fresh.add(e);
            newest = Math.max(newest, e.timestamp);
        }
        if (fresh.isEmpty()) return fresh;
        fresh.sort((a, b) -> Long.compare(b.timestamp, a.timestamp));
        exits.addAll(0, fresh);
        exits.sort((a, b) -> Long.compare(b.timestamp, a.timestamp));
        while (exits.size() > KEEP) exits.remove(exits.size() - 1);
        lastSeen = newest;
        unreported = true;
        save();
        return fresh;
    }

    /** The newest exit already recorded; older ones from Android are not new. */
    public synchronized long lastSeen() { return lastSeen; }

    /** Newest first. */
    public synchronized List<Exit> exits() { return new ArrayList<>(exits); }

    /**
     * The exit that most likely ended a process whose last sign of life was {@code lastAliveAt}: the earliest exit at
     * or after it (Android stamps the exit when it records the death), else the newest one before it within a minute.
     */
    public synchronized Exit near(long lastAliveAt) {
        Exit after = null, before = null;
        for (Exit e : exits) {
            if (e.timestamp >= lastAliveAt) { if (after == null || e.timestamp < after.timestamp) after = e; }
            else if (lastAliveAt - e.timestamp <= 60_000 && (before == null || e.timestamp > before.timestamp)) before = e;
        }
        return after != null ? after : before;
    }

    /** True once after new exits were added: the diagnostics report should go out again. */
    public synchronized boolean takeUnreported() {
        if (!unreported) return false;
        unreported = false;
        save();
        return true;
    }

    public synchronized JSONArray json(int max) {
        JSONArray a = new JSONArray();
        try { for (Exit e : exits) { if (a.length() >= max) break; a.put(e.json()); } } catch (JSONException ignored) { }
        return a;
    }

    /** One log line: "pid 123 low_memory status=0 importance=125 pss=...kB at <epoch ms>: <description>". */
    public static String line(Exit e) {
        return String.format(Locale.US, "pid %d %s status=%d importance=%d pss=%dkB at %d: %s",
                e.pid, e.reasonName(), e.status, e.importance, e.pssKb, e.timestamp, e.description);
    }

    private void save() {
        try {
            File dir = file.getParentFile();
            //noinspection ResultOfMethodCallIgnored
            if (dir != null) dir.mkdirs();
            JSONArray a = new JSONArray();
            for (Exit e : exits) a.put(e.json());
            JSONObject o = new JSONObject().put("v", 1).put("lastSeen", lastSeen).put("unreported", unreported).put("exits", a);
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(o.toString().getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(file);
        } catch (Exception ignored) { /* diagnostics only: never break a start over them */ }
    }
}
