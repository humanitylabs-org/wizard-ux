package ai.wizards.os.downloads;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * The in-app Downloads list: files Wizard OS handed to Android's DownloadManager, remembered (last 30) so the
 * web shell can say "Downloaded · Open" inside Wizard instead of leaving it to the system tray.
 *
 * Never a file:// URI: opening goes through DownloadManager's own content URI with a one-off read grant.
 * Nothing here touches the network or reads file contents; it only mirrors DownloadManager's own records.
 */
public final class Downloads {
    private static final String TAG = "WizardDownloads";
    private static final String PREFS = "wizard_downloads", KEY = "items";

    /** The shell page (MainActivity / AppSessionActivity) receives events here and pushes them to the web shell. */
    public interface Listener { void onDownloadEvent(String json); }
    private static final CopyOnWriteArraySet<Listener> LISTENERS = new CopyOnWriteArraySet<>();

    private Downloads() {}

    public static void addListener(Listener l) { if (l != null) LISTENERS.add(l); }
    public static void removeListener(Listener l) { LISTENERS.remove(l); }

    private static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private static DownloadManager dm(Context c) { return (DownloadManager) c.getApplicationContext().getSystemService(Context.DOWNLOAD_SERVICE); }

    private static synchronized List<DownloadsPolicy.Item> load(Context c) { return DownloadsPolicy.parse(prefs(c).getString(KEY, "")); }

    private static synchronized void save(Context c, List<DownloadsPolicy.Item> items) {
        prefs(c).edit().putString(KEY, DownloadsPolicy.serialize(DownloadsPolicy.trim(items))).apply();
    }

    private static void emit(String type, DownloadsPolicy.Item item) {
        String json = DownloadsPolicy.eventJson(type, item);
        for (Listener l : LISTENERS) {
            try { l.onDownloadEvent(json); } catch (RuntimeException e) { Log.w(TAG, "listener: " + e); }
        }
    }

    /** A new download was just enqueued. */
    public static synchronized void track(Context c, long id, String name, String mime) {
        List<DownloadsPolicy.Item> items = load(c);
        items.removeIf(i -> i.id == id);
        DownloadsPolicy.Item it = new DownloadsPolicy.Item();
        it.id = id;
        it.name = DownloadsPolicy.displayName(name);
        it.mime = mime == null ? "" : mime;
        it.status = "pending";
        it.started = System.currentTimeMillis();
        items.add(it);
        save(c, items);
        emit("start", it);
    }

    /** Whether Wizard OS started this download (a cheap list lookup; no DownloadManager query, no side effect). */
    public static synchronized boolean isTracked(Context c, long id) { return find(load(c), id) != null; }

    /** DownloadManager.ACTION_DOWNLOAD_COMPLETE (also for a failed download). Ignores ids Wizard OS did not start. */
    public static void onComplete(Context c, long id) {
        DownloadsPolicy.Item done = null;
        synchronized (Downloads.class) {
            List<DownloadsPolicy.Item> items = load(c);
            DownloadsPolicy.Item it = find(items, id);
            if (it == null) return;
            refresh(c, items);
            it = find(items, id);
            if (it == null || it.inFlight()) return;
            if (it.finished == 0) it.finished = System.currentTimeMillis();
            save(c, items);
            done = it;
        }
        emit("failed".equals(done.status) ? "failed" : "done", done);
    }

    /** The list for the sheet; in-flight rows are brought up to date from DownloadManager first. */
    public static synchronized String listJson(Context c) {
        List<DownloadsPolicy.Item> items = load(c);
        if (refresh(c, items)) save(c, items);
        return DownloadsPolicy.listJson(items);
    }

    /** One tap on Open: "ok" | "missing" (file gone or not finished) | "none" (no app handles it). */
    public static String open(Context c, String rawId) {
        long id = DownloadsPolicy.parseId(rawId);
        if (id < 0) return "missing";
        DownloadsPolicy.Item it;
        synchronized (Downloads.class) { it = find(load(c), id); }
        if (it == null) return "missing";
        DownloadManager dm = dm(c);
        Uri uri;
        String stored;
        try {
            uri = dm.getUriForDownloadedFile(id); // null unless the download finished and the file is still there
            stored = dm.getMimeTypeForDownloadedFile(id);
        } catch (RuntimeException e) { return "missing"; }
        if (uri == null) return "missing";
        String mime = DownloadsPolicy.openMime(stored != null && !stored.isEmpty() ? stored : it.mime, it.name);
        if (("application/octet-stream".equals(mime)) && it.mime != null && !it.mime.isEmpty()) mime = DownloadsPolicy.openMime(it.mime, it.name);
        Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        view.setClipData(ClipData.newRawUri("", uri));
        if (!(c instanceof android.app.Activity)) view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { c.startActivity(view); return "ok"; }
        catch (ActivityNotFoundException | SecurityException e) { return "none"; }
    }

    /** Stops a running download and drops it (DownloadManager deletes the partial file). */
    public static synchronized String cancel(Context c, String rawId) {
        long id = DownloadsPolicy.parseId(rawId);
        if (id < 0) return "missing";
        List<DownloadsPolicy.Item> items = load(c);
        DownloadsPolicy.Item it = find(items, id);
        if (it == null) return "missing";
        if (it.inFlight()) { try { dm(c).remove(id); } catch (RuntimeException ignored) { } }
        items.removeIf(i -> i.id == id);
        save(c, items);
        return "ok";
    }

    /** Takes a row off the list. The file itself stays in Downloads. */
    public static synchronized String remove(Context c, String rawId) {
        long id = DownloadsPolicy.parseId(rawId);
        if (id < 0) return "missing";
        List<DownloadsPolicy.Item> items = load(c);
        if (!items.removeIf(i -> i.id == id && !i.inFlight())) return "missing";
        save(c, items);
        return "ok";
    }

    private static DownloadsPolicy.Item find(List<DownloadsPolicy.Item> items, long id) {
        for (DownloadsPolicy.Item i : items) if (i.id == id) return i;
        return null;
    }

    /** Brings in-flight rows (and finished ones whose file may have been deleted) up to date. True if anything changed. */
    private static boolean refresh(Context c, List<DownloadsPolicy.Item> items) {
        List<Long> ids = new ArrayList<>();
        for (DownloadsPolicy.Item i : items) if (i.inFlight() || "done".equals(i.status)) ids.add(i.id);
        if (ids.isEmpty()) return false;
        long[] arr = new long[ids.size()];
        for (int k = 0; k < arr.length; k++) arr[k] = ids.get(k);
        boolean changed = false;
        java.util.Set<Long> seen = new java.util.HashSet<>();
        try (Cursor q = dm(c).query(new DownloadManager.Query().setFilterById(arr))) {
            if (q != null) while (q.moveToNext()) {
                long id = q.getLong(q.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
                DownloadsPolicy.Item it = find(items, id);
                if (it == null) continue;
                seen.add(id);
                String st = DownloadsPolicy.status(q.getInt(q.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)));
                long total = q.getLong(q.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                long got = q.getLong(q.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                String mt = q.getString(q.getColumnIndexOrThrow(DownloadManager.COLUMN_MEDIA_TYPE));
                if (!st.equals(it.status) || total != it.total || got != it.got) changed = true;
                if (!it.status.equals(st) && ("done".equals(st) || "failed".equals(st)) && it.finished == 0) it.finished = System.currentTimeMillis();
                it.status = st; it.total = total; it.got = got;
                if (mt != null && !mt.isEmpty() && !mt.equals(it.mime)) { it.mime = mt; changed = true; }
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "refresh: " + e);
            return changed;
        }
        for (DownloadsPolicy.Item i : items) {
            if (seen.contains(i.id) || !(i.inFlight() || "done".equals(i.status))) continue;
            // DownloadManager no longer knows it: removed in the system Downloads app, or cancelled elsewhere.
            i.status = i.inFlight() ? "failed" : "gone";
            if (i.finished == 0) i.finished = System.currentTimeMillis();
            changed = true;
        }
        return changed;
    }
}
