package ai.wizards.os.recording;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Cancelled recordings worth keeping (James, 11 Oct 2026): an X tapped by accident must not throw away a long
 * message. Any take cancelled after {@link CancelPolicy#KEEP_FROM_MS} or more is moved here instead of deleted —
 * from the floating orb, the in-app orb and the side button alike. Settings → Cancelled recordings lists them:
 * Transcribe &amp; copy puts the words on the clipboard, Delete removes them. A short cancel is still just gone.
 *
 * Files: files/cancelled/&lt;id&gt;.&lt;ext&gt; + &lt;id&gt;.json ({id, at, ms, source, mime, bytes}). Only this phone has them;
 * the newest {@link CancelPolicy#MAX_KEPT} are kept, none longer than {@link CancelPolicy#MAX_AGE_MS}.
 */
public final class CancelledTakes {
    static final String TAG = "WizardOSCancelled";
    private CancelledTakes() { }

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "cancelled");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    /**
     * Keep a cancelled take if it is long enough. Moves (or copies) audio into the cancelled folder; the caller may
     * delete its own copy afterwards either way. Returns true when kept. Never throws.
     */
    public static boolean keep(Context c, File audio, long ms, String source, String mime) {
        try {
            if (audio == null || !audio.isFile()) return false;
            if (!CancelPolicy.keep(ms, audio.length())) { Log.i(TAG, "not kept ms=" + ms + " bytes=" + audio.length()); return false; }
            long now = System.currentTimeMillis();
            String id = "c" + now + "-" + (source == null ? "orb" : source.replaceAll("[^a-z]", ""));
            String name = audio.getName();
            String ext = name.contains(".") ? name.substring(name.lastIndexOf('.')).toLowerCase(java.util.Locale.ROOT) : ".m4a";
            File d = dir(c), out = new File(d, id + ext);
            if (!audio.renameTo(out)) copy(audio, out);
            JSONObject o = new JSONObject()
                    .put("id", id).put("at", now).put("ms", ms).put("source", source == null ? "orb" : source)
                    .put("mime", mime == null || mime.isEmpty() ? (".aac".equals(ext) ? "audio/aac" : "audio/mp4") : mime)
                    .put("file", out.getName()).put("bytes", out.length());
            File tmp = new File(d, id + ".json.tmp");
            try (OutputStream w = new FileOutputStream(tmp)) { w.write(o.toString().getBytes(StandardCharsets.UTF_8)); }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(new File(d, id + ".json"));
            Log.i(TAG, "kept " + id + " ms=" + ms + " bytes=" + out.length() + " from " + source);
            prune(c);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "keep failed", e);
            return false;
        }
    }

    private static void copy(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            byte[] b = new byte[65536];
            for (int n; (n = in.read(b)) > 0; ) out.write(b, 0, n);
        }
    }

    /** Newest first. */
    public static List<JSONObject> list(Context c) {
        List<JSONObject> out = new ArrayList<>();
        File[] fs = dir(c).listFiles((d, n) -> n.endsWith(".json"));
        if (fs == null) return out;
        for (File f : fs) {
            try {
                JSONObject o = new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
                File a = new File(f.getParentFile(), o.optString("file"));
                if (!a.isFile()) { //noinspection ResultOfMethodCallIgnored
                    f.delete(); continue; }
                out.add(o);
            } catch (IOException | JSONException e) { //noinspection ResultOfMethodCallIgnored
                f.delete(); }
        }
        out.sort((x, y) -> Long.compare(y.optLong("at"), x.optLong("at")));
        return out;
    }

    public static String listJson(Context c) {
        prune(c);
        JSONArray a = new JSONArray();
        for (JSONObject o : list(c)) a.put(o);
        return a.toString();
    }

    public static File audio(Context c, String id) {
        for (JSONObject o : list(c)) if (o.optString("id").equals(id)) return new File(dir(c), o.optString("file"));
        return new File(dir(c), "missing");
    }

    public static void delete(Context c, String id) {
        File d = dir(c);
        String safe = String.valueOf(id).replaceAll("[^A-Za-z0-9._-]", "_");
        File[] fs = d.listFiles((x, n) -> n.startsWith(safe + "."));
        if (fs != null) for (File f : fs) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    static void prune(Context c) {
        List<JSONObject> l = list(c);
        long now = System.currentTimeMillis();
        long[] ats = new long[l.size()];
        for (int i = 0; i < l.size(); i++) ats[i] = l.get(i).optLong("at");
        for (int i : CancelPolicy.drop(ats, now)) delete(c, l.get(i).optString("id"));
    }

    /** For logs and QA. */
    static String describe(Context c) { return Arrays.toString(list(c).toArray()); }
}
