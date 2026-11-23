package ai.wizards.os;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Times WizardOS stopped answering (wizard-ux#1762): the UI thread blocked for seconds ("main", with its stack) or the
 * WebView's page process stopped responding ("webview"). Kept on the phone (filesDir/diagnostics/hangs.json, last 10)
 * so a freeze is explained afterwards, also when the owner tapped Wait and the process lived on. Pure data + one file.
 *
 * Only code locations are kept (class.method:line, lock lines), never page content or values.
 */
public final class HangLog {
    public static final int KEEP = 10;
    static final int FRAMES = 40, FRAME_MAX = 200;

    public static final class Hang {
        public long at, ms;
        /** Uptime when it started; this process only, never saved. */
        long at0;
        public String kind = "main";
        public final List<String> frames = new ArrayList<>();

        JSONObject json() throws JSONException {
            JSONArray f = new JSONArray();
            for (String s : frames) f.put(s);
            return new JSONObject().put("at", at).put("kind", kind).put("ms", ms).put("frames", f);
        }

        static Hang from(JSONObject o) {
            Hang h = new Hang();
            h.at = o.optLong("at"); h.ms = o.optLong("ms"); h.kind = o.optString("kind", "main");
            JSONArray f = o.optJSONArray("frames");
            if (f != null) for (int i = 0; i < f.length() && h.frames.size() < FRAMES; i++) h.frames.add(frame(f.optString(i)));
            return h;
        }
    }

    private final File file;
    private final List<Hang> hangs = new ArrayList<>();
    private boolean unreported;

    public HangLog(File file) {
        this.file = file;
        try (FileInputStream in = new FileInputStream(file)) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) > 0) bytes.write(buf, 0, n);
            JSONObject o = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            unreported = o.optBoolean("unreported");
            JSONArray a = o.optJSONArray("hangs");
            if (a != null) for (int i = 0; i < a.length(); i++) { JSONObject h = a.optJSONObject(i); if (h != null) hangs.add(Hang.from(h)); }
        } catch (Exception ignored) { /* first run or unreadable: start empty */ }
    }

    /** One stack frame as a short code location: letters, digits and . _ $ < > : ( ) , # - and spaces only. */
    static String frame(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (char ch : s.trim().toCharArray()) {
            if (Character.isLetterOrDigit(ch) && ch < 0x80 || " ._$<>:(),#-".indexOf(ch) >= 0) b.append(ch);
            if (b.length() >= FRAME_MAX) break;
        }
        return b.toString().trim();
    }

    public static List<String> frames(StackTraceElement[] stack) {
        List<String> out = new ArrayList<>();
        if (stack == null) return out;
        for (StackTraceElement e : stack) {
            if (out.size() >= FRAMES) break;
            String f = frame(e.getClassName() + "." + e.getMethodName() + (e.getLineNumber() > 0 ? ":" + e.getLineNumber() : ""));
            if (!f.isEmpty()) out.add(f);
        }
        return out;
    }

    /**
     * The "main" thread's Java frames and lock lines from an Android ANR trace (ApplicationExitInfo.getTraceInputStream,
     * the same text as /data/anr). "  at a.B.c(B.java:12)" becomes "a.B.c(B.java:12)"; "  - waiting to lock ..." is
     * kept; native frames (paths) and every other thread are dropped.
     */
    public static List<String> mainFrames(InputStream trace) throws IOException {
        List<String> out = new ArrayList<>();
        if (trace == null) return out;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(trace, StandardCharsets.UTF_8))) {
            boolean in = false; String line; int read = 0;
            while ((line = r.readLine()) != null && read++ < 200_000) {
                if (!in) { if (line.startsWith("\"main\"")) in = true; continue; }
                if (line.trim().isEmpty() || line.startsWith("\"")) break;
                String t = line.trim();
                if (t.startsWith("at ")) t = t.substring(3);
                else if (!t.startsWith("- ")) continue;
                String f = frame(t);
                if (!f.isEmpty()) out.add(f);
                if (out.size() >= FRAMES) break;
            }
        }
        return out;
    }

    public synchronized void add(Hang h) {
        hangs.add(0, h);
        while (hangs.size() > KEEP) hangs.remove(hangs.size() - 1);
        unreported = true;
        save();
    }

    /** A hang still in the log ended after {@code ms}: keep how long it really lasted. */
    public synchronized void lasted(Hang h, long ms) {
        if (h == null || ms <= h.ms) return;
        boolean kept = false;
        for (Hang x : hangs) if (x == h) { kept = true; break; }
        if (!kept) return;
        h.ms = ms;
        unreported = true;
        save();
    }

    /** True once after new hangs were added: the diagnostics report should go out again. */
    public synchronized boolean takeUnreported() {
        if (!unreported) return false;
        unreported = false;
        save();
        return true;
    }

    public synchronized List<Hang> hangs() { return new ArrayList<>(hangs); }

    public synchronized JSONArray json(int max) {
        JSONArray a = new JSONArray();
        try { for (Hang h : hangs) { if (a.length() >= max) break; a.put(h.json()); } } catch (JSONException ignored) { }
        return a;
    }

    private void save() {
        try {
            File dir = file.getParentFile();
            //noinspection ResultOfMethodCallIgnored
            if (dir != null) dir.mkdirs();
            JSONObject o = new JSONObject().put("v", 1).put("unreported", unreported).put("hangs", json(KEEP));
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(o.toString().getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(file);
        } catch (Exception ignored) { /* diagnostics only: never break the app */ }
    }
}
