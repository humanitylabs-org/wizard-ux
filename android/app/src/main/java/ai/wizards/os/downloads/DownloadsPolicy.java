package ai.wizards.os.downloads;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Pure rules for the in-app Downloads list (no Android classes, so they are unit-testable off-device).
 * The list is a small recent history of files Wizard OS handed to Android's DownloadManager; the web shell
 * (web/core/downloads.js) shows it as a banner when one finishes and as the Downloads sheet.
 */
public final class DownloadsPolicy {
    public static final int MAX_ITEMS = 30;
    public static final int MAX_NAME = 120;
    // DownloadManager.STATUS_* (compile-time constants, repeated here so this class stays pure Java).
    static final int DM_PENDING = 1, DM_RUNNING = 2, DM_PAUSED = 4, DM_SUCCESSFUL = 8, DM_FAILED = 16;

    private DownloadsPolicy() {}

    /** One row of the list. {@code status}: pending | running | paused | done | failed | gone. */
    public static final class Item {
        public long id;
        public String name = "";
        public String mime = "";
        public long total = -1;   // bytes, -1 until the server says
        public long got = 0;      // bytes so far
        public String status = "pending";
        public long started;      // ms epoch
        public long finished;     // ms epoch, 0 while in flight

        public boolean inFlight() { return "pending".equals(status) || "running".equals(status) || "paused".equals(status); }

        public JSONObject toJson() {
            try {
                return new JSONObject().put("id", String.valueOf(id)).put("name", name).put("mime", mime)
                        .put("size", total >= 0 ? total : (got > 0 ? got : -1)).put("got", got)
                        .put("status", status).put("started", started).put("finished", finished);
            } catch (JSONException e) { throw new IllegalStateException(e); }
        }

        static Item from(JSONObject o) {
            long id = o.optLong("id", -1);
            if (id < 0) return null;
            Item it = new Item();
            it.id = id;
            it.name = displayName(o.optString("name", ""));
            it.mime = o.optString("mime", "");
            it.total = o.optLong("total", -1);
            it.got = o.optLong("got", 0);
            it.status = knownStatus(o.optString("status", "pending"));
            it.started = o.optLong("started", 0);
            it.finished = o.optLong("finished", 0);
            return it;
        }
    }

    /** A file name safe to show and to keep: no path, no control characters, capped (extension kept when cut). */
    public static String displayName(String raw) {
        String n = raw == null ? "" : raw;
        int slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (slash >= 0) n = n.substring(slash + 1);
        n = n.replaceAll("[\\p{Cntrl}\\u2028\\u2029]", " ").trim();
        if (n.isEmpty() || n.equals(".") || n.equals("..")) return "download";
        if (n.length() > MAX_NAME) {
            int dot = n.lastIndexOf('.');
            String ext = dot > 0 && n.length() - dot <= 8 ? n.substring(dot) : "";
            n = n.substring(0, MAX_NAME - ext.length()) + ext;
        }
        return n;
    }

    static String knownStatus(String s) {
        switch (s == null ? "" : s) {
            case "pending": case "running": case "paused": case "done": case "failed": case "gone": return s;
            default: return "pending";
        }
    }

    /** DownloadManager.COLUMN_STATUS → our status word. */
    public static String status(int dm) {
        switch (dm) {
            case DM_SUCCESSFUL: return "done";
            case DM_FAILED: return "failed";
            case DM_PAUSED: return "paused";
            case DM_RUNNING: return "running";
            case DM_PENDING: default: return "pending";
        }
    }

    /** Ids are the DownloadManager's own long ids, passed through the bridge as digits only. */
    public static long parseId(String s) {
        if (s == null || !s.matches("[0-9]{1,18}")) return -1;
        return Long.parseLong(s);
    }

    /**
     * The type handed to the app that opens the file. A specific type from the server or DownloadManager wins; a
     * generic one (octet-stream, wildcard, empty) falls back to what the file name says, then to octet-stream.
     */
    public static String openMime(String stored, String name) {
        String m = stored == null ? "" : stored.trim().toLowerCase(Locale.ROOT);
        int semi = m.indexOf(';');
        if (semi >= 0) m = m.substring(0, semi).trim();
        boolean generic = m.isEmpty() || m.equals("application/octet-stream") || m.equals("binary/octet-stream") || m.contains("*");
        if (!generic && m.matches("[a-z0-9.+-]+/[a-z0-9.+-]+")) return m;
        String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
        int dot = n.lastIndexOf('.');
        String ext = dot < 0 ? "" : n.substring(dot + 1);
        switch (ext) {
            case "pdf": return "application/pdf";
            case "jpg": case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "svg": return "image/svg+xml";
            case "mp4": return "video/mp4";
            case "mov": return "video/quicktime";
            case "webm": return "video/webm";
            case "mp3": return "audio/mpeg";
            case "m4a": return "audio/mp4";
            case "wav": return "audio/wav";
            case "txt": case "log": return "text/plain";
            case "md": return "text/markdown";
            case "csv": return "text/csv";
            case "json": return "application/json";
            case "zip": return "application/zip";
            case "apk": return "application/vnd.android.package-archive";
            case "doc": return "application/msword";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xls": return "application/vnd.ms-excel";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "ppt": return "application/vnd.ms-powerpoint";
            case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            default: return "application/octet-stream";
        }
    }

    /** Newest first; keeps at most MAX_ITEMS but never drops a download that is still running. */
    public static List<Item> trim(List<Item> items) {
        List<Item> sorted = new ArrayList<>(items);
        sorted.sort((a, b) -> Long.compare(b.started, a.started));
        List<Item> out = new ArrayList<>();
        int kept = 0;
        for (Item it : sorted) {
            if (it.inFlight() || kept < MAX_ITEMS) { out.add(it); if (!it.inFlight()) kept++; }
        }
        return out;
    }

    public static String serialize(List<Item> items) {
        JSONArray a = new JSONArray();
        for (Item it : items) {
            try {
                a.put(it.toJson().put("total", it.total));
            } catch (JSONException e) { throw new IllegalStateException(e); }
        }
        return a.toString();
    }

    public static List<Item> parse(String json) {
        List<Item> out = new ArrayList<>();
        if (json == null || json.isEmpty()) return out;
        try {
            JSONArray a = new JSONArray(json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                Item it = o == null ? null : Item.from(o);
                if (it != null) out.add(it);
            }
        } catch (JSONException e) { return new ArrayList<>(); }
        return out;
    }

    /** What the page gets: {"v":1,"items":[…]} newest first. */
    public static String listJson(List<Item> items) {
        JSONArray a = new JSONArray();
        for (Item it : trim(items)) a.put(it.toJson());
        try { return new JSONObject().put("v", 1).put("items", a).toString(); }
        catch (JSONException e) { throw new IllegalStateException(e); }
    }

    /** One event for window.__wosDownloads: type is start | done | failed | sync. */
    public static String eventJson(String type, Item item) {
        try {
            JSONObject o = new JSONObject().put("v", 1).put("type", type);
            if (item != null) o.put("item", item.toJson());
            return o.toString();
        } catch (JSONException e) { throw new IllegalStateException(e); }
    }
}
