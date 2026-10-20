package ai.wizards.os.mizel;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The meeting outbox worker: one background thread that uploads chunk files in seq order, sends each meeting's stop
 * once every chunk up to final_seq is acknowledged, asks finished meetings whether they are ready and prunes local
 * audio a day after that. Files stay on the phone until the server acknowledges them; failures back off 2 s … 2 min
 * and never give up. Network calls follow the Everywhere outbox: plain HTTPS to the private origin with an Origin
 * header, no cookies or tokens (the Wizard origin is reachable only over James's tailnet).
 */
public final class MizelUploader {
    private static MizelUploader instance;
    /** After a stop, the meeting's status is polled (for pruning) only this long by a live process. */
    private static final long STATUS_WINDOW_MS = 6 * 60 * 60_000L;

    private final Context app;
    private final MizelStore store;
    private final String origin;
    private final Object lock = new Object();
    private boolean kicked;
    private volatile boolean busy;

    public static synchronized MizelUploader get(Context c) {
        if (instance == null) instance = new MizelUploader(c.getApplicationContext());
        return instance;
    }

    private MizelUploader(Context app) {
        this.app = app;
        this.store = MizelHub.store(app);
        this.origin = MizelConfig.origin(app);
        Thread t = new Thread(this::loop, "mizel-uploader");
        t.setDaemon(true);
        t.start();
        try {
            ConnectivityManager cm = app.getSystemService(ConnectivityManager.class);
            if (cm != null) cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) {
                    Log.i(MizelHub.TAG, "network available: retrying meeting uploads now");
                    store.resetBackoff();
                    kick();
                }
            });
        } catch (RuntimeException e) { Log.w(MizelHub.TAG, "no network callback", e); }
    }

    public void kick() {
        synchronized (lock) { kicked = true; lock.notifyAll(); }
    }

    /** Chunks not yet acknowledged, or a stop not yet sent, anywhere. */
    public boolean outstanding() {
        if (busy) return true;
        for (MizelJournal j : store.all()) if (!j.pending.isEmpty() || j.stopPending()) return true;
        return false;
    }

    private void loop() {
        while (true) {
            long wait;
            busy = true;
            try { wait = drainOnce(); }
            catch (Throwable t) { Log.e(MizelHub.TAG, "uploader pass failed", t); wait = 5000; }
            finally { busy = false; }
            synchronized (lock) {
                if (!kicked) {
                    try { lock.wait(wait < 0 ? 0 : Math.max(250, Math.min(wait, 120_000))); }
                    catch (InterruptedException ignored) { }
                }
                kicked = false;
            }
        }
    }

    /** One pass over every meeting. Returns ms until something is due again, or -1 when there is nothing to do. */
    long drainOnce() {
        long next = -1;
        boolean changed = false;
        List<MizelJournal> all = store.all();
        for (MizelJournal live : all) {
            String id = live.meetingId;
            MizelJournal j = store.snapshot(id);
            if (j == null) continue;
            List<MizelJournal.Chunk> todo = new ArrayList<>(j.pending);
            Collections.sort(todo, (a, b) -> Integer.compare(a.seq, b.seq));
            for (MizelJournal.Chunk c : todo) {
                long now = System.currentTimeMillis();
                if (c.nextAt > now) { next = min(next, c.nextAt - now); break; }
                File f = store.chunkFile(id, c.seq);
                if (!f.isFile()) {
                    Log.w(MizelHub.TAG, "chunk file missing " + id + "/" + c.seq + ": dropped");
                    store.dropped(id, c.seq); changed = true; continue;
                }
                int code;
                try {
                    code = post(MizelPolicy.chunkPath(id, c.seq, c.startMs), readFile(f), "audio/wav");
                } catch (IOException e) { code = 0; }
                if (code >= 200 && code < 300) {
                    store.acked(id, c.seq); changed = true;
                    Log.i(MizelHub.TAG, "chunk acked " + id + " seq=" + c.seq + " start_ms=" + c.startMs);
                } else if (MizelPolicy.permanent(code)) {
                    Log.w(MizelHub.TAG, "chunk refused " + id + " seq=" + c.seq + " http=" + code + ": dropped");
                    store.dropped(id, c.seq); changed = true;
                } else {
                    long d = store.chunkFailed(id, c.seq, System.currentTimeMillis());
                    Log.i(MizelHub.TAG, "chunk upload failed " + id + " seq=" + c.seq + " http=" + code + "; retry in " + d + " ms");
                    next = min(next, d);
                    changed = true;
                    break; // keep seq order; the rest wait for this one
                }
            }
            j = store.snapshot(id);
            if (j == null) continue;
            if (j.stopPending()) {
                if (!MizelPolicy.stopReady(j.finalSeq, j.lowestPendingSeq())) {
                    if (j.pending.isEmpty()) next = min(next, 1000);
                } else {
                    long now = System.currentTimeMillis();
                    if (j.stopNextAt > now) next = min(next, j.stopNextAt - now);
                    else {
                        int code;
                        String body = MizelPolicy.stopBody(j.finalSeq, j.stopReason);
                        try { code = post(MizelPolicy.stopPath(id), body.getBytes(StandardCharsets.UTF_8), "application/json"); }
                        catch (IOException e) { code = 0; }
                        if ((code >= 200 && code < 300) || MizelPolicy.permanent(code)) {
                            store.stopSent(id, System.currentTimeMillis()); changed = true;
                            Log.i(MizelHub.TAG, "stop sent " + id + " " + body + " http=" + code);
                        } else {
                            long d = store.stopFailed(id, System.currentTimeMillis());
                            Log.i(MizelHub.TAG, "stop failed " + id + " http=" + code + "; retry in " + d + " ms");
                            next = min(next, d); changed = true;
                        }
                    }
                }
            }
            j = store.snapshot(id);
            if (j != null && j.stopSent && j.readyAt == 0 && !j.recording) {
                long every = MizelConfig.statusEveryMs(app);
                long now = System.currentTimeMillis();
                long due = j.statusCheckedAt + every;
                if (now >= due) {
                    String status = null; int code;
                    try {
                        JSONObject o = getJson(MizelPolicy.meetingPath(id));
                        code = o.optInt("__code");
                        status = o.optString("status", null);
                    } catch (IOException e) { code = 0; }
                    // Gone/refused is not a server receipt and must never authorize pruning.
                    boolean ready = code >= 200 && code < 300 && "ready".equals(status);
                    store.statusChecked(id, now, ready);
                    if (ready) Log.i(MizelHub.TAG, "meeting " + id + " is " + (code == 404 ? "gone" : "ready") + "; local audio kept " + MizelConfig.keepAfterReadyMs(app) + " ms more");
                    else due = now + every;
                }
                // Housekeeping only: ask again while this process lives, for a few hours after the stop. Anything
                // later is picked up by the cleanup pass when the app or the recorder next starts.
                if (j.readyAt == 0 && now - j.stopSentAt < STATUS_WINDOW_MS) next = min(next, Math.max(1000, due - now));
            }
            // Ready: come back when the keep time is up (if that falls within this process's housekeeping window).
            j = store.snapshot(id);
            if (j != null && j.readyAt > 0 && j.pending.isEmpty() && !j.recording) {
                long left = j.readyAt + MizelConfig.keepAfterReadyMs(app) - System.currentTimeMillis();
                if (left < STATUS_WINDOW_MS) next = min(next, Math.max(1000, left + 500));
            }
        }
        List<String> gone = store.prune(System.currentTimeMillis(), MizelConfig.keepAfterReadyMs(app));
        for (String id : gone) Log.i(MizelHub.TAG, "pruned local audio for " + id);
        if (changed || !gone.isEmpty()) MizelHub.pushState(app);
        return next;
    }

    private static long min(long a, long b) { return a < 0 ? b : Math.min(a, b); }

    /* ------------------------------------------------------------------ http */

    private HttpURLConnection open(String path) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(ai.wizards.os.device.AppState.live(origin) + path).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(30_000);
        c.setInstanceFollowRedirects(false);
        c.setUseCaches(false);
        c.setRequestProperty("Origin", origin);
        c.setRequestProperty("Accept", "application/json");
        return c;
    }

    private int post(String path, byte[] body, String type) throws IOException {
        HttpURLConnection c = open(path);
        try {
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", type);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream os = c.getOutputStream()) { os.write(body); }
            int code = c.getResponseCode();
            drain(code >= 400 ? c.getErrorStream() : c.getInputStream());
            return code;
        } finally { c.disconnect(); }
    }

    private JSONObject getJson(String path) throws IOException {
        HttpURLConnection c = open(path);
        try {
            int code = c.getResponseCode();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String s = is == null ? "" : new String(MizelStore.readAll(is), StandardCharsets.UTF_8);
            JSONObject o;
            try { o = s.isEmpty() ? new JSONObject() : new JSONObject(s); } catch (Exception e) { o = new JSONObject(); }
            try { o.put("__code", code); } catch (Exception ignored) { }
            return o;
        } finally { c.disconnect(); }
    }

    private static void drain(InputStream is) {
        if (is == null) return;
        try { MizelStore.readAll(is); } catch (IOException ignored) { }
    }

    private static byte[] readFile(File f) throws IOException { return MizelStore.readAll(new FileInputStream(f)); }
}
