package ai.wizards.os.share;

import android.content.ContentResolver;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Set;

import ai.wizards.os.device.AppState;

/**
 * The share outbox worker: one background thread per process that takes shares oldest first, copies what was
 * shared into app-private storage (streamed, never whole in memory) while Android's read grant is held by the
 * foreground service's start, then uploads the copies with {@link ShareClient} and drops them once the Wizard has
 * delivered the share. Network loss or a Wizard restart backs off 2 s … 60 s (and jumps ahead the moment a network
 * returns); nothing gives up on its own. A process death resumes from item.json (offsets the Wizard acknowledged).
 *
 * The thread does the work; {@link ShareService} (foreground, started from the sheet or the app) or {@link ShareJob}
 * (JobScheduler: after a reboot, a process death or a long outage) keeps the process alive while it runs.
 */
public final class ShareUploader {
    static final String TAG = "WizardShare";
    /** Free space kept on the phone beyond what the copies need. */
    static final long PHONE_RESERVE = 200L * 1024 * 1024;
    public static final String NO_SPACE_PHONE = "Not enough space on phone";

    public interface Host { void idle(); }

    private static ShareUploader instance;
    private final Context app;
    private final ShareQueue queue;
    private final Object lock = new Object();
    private final Set<Host> hosts = new HashSet<>();
    private boolean kicked;
    private volatile boolean busy;
    private volatile long retryingSince;
    private volatile String phase = "";
    private long lastNote;
    private int fails;

    public static synchronized ShareUploader get(Context c) {
        if (instance == null) instance = new ShareUploader(c.getApplicationContext());
        return instance;
    }

    private ShareUploader(Context app) {
        this.app = app;
        this.queue = ShareQueue.get(app);
        Thread t = new Thread(this::loop, "wizard-share-uploader");
        t.setDaemon(true);
        t.start();
        try {
            ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
            if (cm != null) cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { Log.i(TAG, "network back: resuming shares"); fails = 0; kick(); }
            });
        } catch (RuntimeException e) { Log.w(TAG, "network callback: " + e); }
    }

    public void addHost(Host h) { synchronized (lock) { hosts.add(h); } kick(); }
    public void removeHost(Host h) { synchronized (lock) { hosts.remove(h); } }
    public void kick() { synchronized (lock) { kicked = true; lock.notifyAll(); } }
    public boolean outstanding() { return busy || queue.pending(); }
    /** Since when the current share has been waiting on the network/Wizard (0 = moving). */
    public long retryingSince() { return retryingSince; }
    public boolean copying() { return "copying".equals(phase); }

    private void loop() {
        while (true) {
            JSONObject it;
            try { it = queue.next(); } catch (RuntimeException e) { it = null; }
            if (it == null) {
                busy = false; retryingSince = 0; phase = "";
                Set<Host> hs; synchronized (lock) { hs = new HashSet<>(hosts); }
                ShareNotifier.clearProgress(app); // a foreground service's own notification goes with stopForeground
                for (Host h : hs) h.idle();
                synchronized (lock) { while (!kicked) try { lock.wait(); } catch (InterruptedException ignored) { } kicked = false; }
                continue;
            }
            busy = true;
            try { step(it); }
            catch (RuntimeException e) { Log.w(TAG, "share step", e); sleep(5000); }
        }
    }

    private void step(JSONObject it) {
        String id = it.optString("id");
        if (ShareQueue.COPYING.equals(it.optString("state"))) { copy(it); return; }
        if (!online()) { waiting(it, "waiting", 0); return; }
        phase = "uploading";
        final long total = ShareQueue.totalBytes(it);
        ShareClient client = new ShareClient(new ShareHttp(AppState.origin(app)), new ShareClient.Listener() {
            @Override public void saved(JSONObject x) { save(x); }
            @Override public void progress(JSONObject x, long sent, long tot) { retryingSince = 0; note(x, "uploading", sent, tot, false); }
        }, () -> false);
        note(it, "uploading", ShareQueue.sentBytes(it), total, true);
        ShareClient.Outcome o = client.run(it, n -> queue.file(id, n));
        Log.i(TAG, "share " + id + " → " + o + (client.reason.isEmpty() ? "" : " (" + client.reason + ")"));
        switch (o) {
            case DELIVERED:
                fails = 0; retryingSince = 0;
                queue.dropCopies(id);
                put(it, "finished", System.currentTimeMillis());
                save(it);
                ShareNotifier.done(app, it);
                break;
            case FAILED:
                fail(it, client.reason);
                break;
            case HANDOFF:
                handoff(it);
                break;
            default:
                waiting(it, online() ? "retry" : "waiting", ShareQueue.sentBytes(it));
        }
    }

    private void waiting(JSONObject it, String why, long sent) {
        if (retryingSince == 0) retryingSince = System.currentTimeMillis();
        note(it, why, sent, ShareQueue.totalBytes(it), true);
        long ms = Math.min(60_000L, 2000L << Math.min(fails++, 5));
        synchronized (lock) {
            long until = System.currentTimeMillis() + ms;
            while (!kicked) {
                long left = until - System.currentTimeMillis();
                if (left <= 0) break;
                try { lock.wait(left); } catch (InterruptedException ignored) { }
            }
            kicked = false;
        }
    }

    /* ------------------------------------------------------------------ copy */

    private void copy(JSONObject it) {
        phase = "copying";
        String id = it.optString("id");
        ContentResolver cr = app.getContentResolver();
        JSONArray fs = it.optJSONArray("files");
        long total = ShareQueue.totalBytes(it), done = 0;
        if (fs == null || fs.length() == 0) { fail(it, "Nothing to share"); return; }
        for (int i = 0; i < fs.length(); i++) {
            JSONObject f = fs.optJSONObject(i);
            File out = queue.file(id, i);
            if (f.optBoolean("copied")) { done += out.length(); continue; }
            long expect = f.optLong("bytes", -1), have = out.length();
            if (expect > 0 && have > expect) { //noinspection ResultOfMethodCallIgnored
                out.delete(); have = 0; }
            long need = queue.bytesToCopy();
            if (need + PHONE_RESERVE > out.getParentFile().getUsableSpace()) { fail(it, NO_SPACE_PHONE); return; }
            MessageDigest md;
            try { md = MessageDigest.getInstance("SHA-256"); } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
            try {
                if (have > 0) digest(out, md);
                try (InputStream in = cr.openInputStream(Uri.parse(f.optString("uri")));
                     FileOutputStream os = new FileOutputStream(out, true)) {
                    if (in == null) throw new FileNotFoundException("no stream");
                    skipFully(in, have);
                    byte[] b = new byte[256 * 1024];
                    int r;
                    long n = have;
                    while ((r = in.read(b)) > 0) {
                        os.write(b, 0, r); md.update(b, 0, r); n += r;
                        if (total > 0) note(it, "copying", done + n, total, false);
                    }
                    os.getFD().sync();
                    done += n;
                }
                put(f, "bytes", out.length()); put(f, "sha256", hex(md.digest())); put(f, "copied", true);
                save(it);
            } catch (SecurityException | FileNotFoundException e) {
                Log.w(TAG, "copy " + id + "#" + i + ": " + e);
                fail(it, "Couldn’t read a shared file · share it again");
                return;
            } catch (IOException e) {
                Log.w(TAG, "copy " + id + "#" + i + ": " + e);
                boolean full = String.valueOf(e.getMessage()).contains("ENOSPC") || out.getParentFile().getUsableSpace() < 8L * 1024 * 1024;
                fail(it, full ? NO_SPACE_PHONE : "Couldn’t read a shared file · share it again");
                return;
            }
        }
        put(it, "state", ShareQueue.READY);
        save(it);
        Log.i(TAG, "copied " + id + " " + ShareQueue.fileCount(it) + " files " + ShareQueue.totalBytes(it) + " bytes");
    }

    private static void skipFully(InputStream in, long n) throws IOException {
        byte[] b = null;
        while (n > 0) {
            long s = in.skip(n);
            if (s > 0) { n -= s; continue; }
            if (b == null) b = new byte[65536];
            int r = in.read(b, 0, (int) Math.min(b.length, n));
            if (r < 0) throw new IOException("source shrank");
            n -= r;
        }
    }

    private static void digest(File f, MessageDigest md) throws IOException {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[256 * 1024];
            int r;
            while ((r = in.read(b)) > 0) md.update(b, 0, r);
        }
    }

    static String hex(byte[] d) {
        StringBuilder s = new StringBuilder(d.length * 2);
        for (byte x : d) s.append(String.format("%02x", x & 0xff));
        return s.toString();
    }

    /* ------------------------------------------------------------------ outcomes */

    private void fail(JSONObject it, String reason) {
        queue.dropCopies(it.optString("id"));
        put(it, "state", ShareQueue.FAILED); put(it, "error", reason); put(it, "finished", System.currentTimeMillis());
        save(it);
        ShareNotifier.failed(app, it, reason);
        Log.w(TAG, "share " + it.optString("id") + " failed: " + reason);
    }

    /** No /wizard/v1/shares on this Wizard: move the copies into the web picker's staging area and let James finish there. */
    private void handoff(JSONObject it) {
        String id = it.optString("id");
        try {
            ShareStore st = ShareStore.get(app);
            String sid = st.newId();
            File dir = st.dir(sid);
            JSONArray items = new JSONArray(), fs = it.optJSONArray("files");
            for (int i = 0; fs != null && i < fs.length(); i++) {
                JSONObject f = fs.getJSONObject(i);
                if (!queue.file(id, i).renameTo(new File(dir, i + ".bin"))) throw new IOException("move");
                items.put(new JSONObject().put("n", i).put("name", f.optString("name")).put("mime", f.optString("mime")).put("bytes", f.optLong("bytes")));
            }
            JSONObject meta = new JSONObject().put("id", sid).put("at", System.currentTimeMillis()).put("items", items).put("skipped", 0)
                    .put("text", it.optString("note")).put("subject", "").put("from", "");
            st.save(sid, meta.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            put(it, "state", ShareQueue.HANDOFF); put(it, "legacy", sid); put(it, "finished", System.currentTimeMillis());
            save(it);
            ShareNotifier.handoff(app, it, sid);
        } catch (IOException | JSONException e) {
            fail(it, "This Wizard can’t take shares yet · update it");
        }
    }

    /* ------------------------------------------------------------------ helpers */

    private void note(JSONObject it, String why, long sent, long total, boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastNote < 1000) return;
        lastNote = now;
        ShareNotifier.showProgress(app, ShareNotifier.progress(app, it, why, sent, total));
    }

    private void save(JSONObject it) {
        try { queue.save(it); } catch (IOException e) { Log.w(TAG, "save: " + e); }
    }

    private static void put(JSONObject o, String k, Object v) { try { o.put(k, v); } catch (JSONException ignored) { } }

    private boolean online() {
        try {
            ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
            Network n = cm == null ? null : cm.getActiveNetwork();
            NetworkCapabilities nc = n == null ? null : cm.getNetworkCapabilities(n);
            return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (RuntimeException e) { return true; }
    }

    private static void sleep(long ms) { try { Thread.sleep(ms); } catch (InterruptedException ignored) { } }
}
