package ai.wizards.os.mizel;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Posts native loan receipts (floating orb, side button) to the meeting's existing orb-events projection
 * (PUT /mizel-live/orb-events), reads each one back and only then marks that revision acknowledged. The receipt
 * stays in "meeting-handoffs-v1" either way, so an offline phone, a restart or a server hiccup only delays the
 * transcript marker: every kick (receipt write, app open, orb start) and a backed-off retry tries again.
 * Never sends a message or run; the meeting server verifies the meeting exists and keeps identities immutable.
 */
public final class MeetingEventSync {
    static final String TAG = "WizardMizel";
    private static final ExecutorService io = Executors.newSingleThreadExecutor();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final long[] BACKOFF = {5_000, 15_000, 60_000, 180_000, 600_000};
    private static int failures;
    private static Context app;
    private static final Runnable retry = () -> { Context c = app; if (c != null) kick(c); };

    private MeetingEventSync() {}

    public static void kick(Context c) {
        if (c == null) return;
        final Context a = c.getApplicationContext() == null ? c : c.getApplicationContext();
        app = a;
        try { io.execute(() -> pass(a)); } catch (RuntimeException e) { Log.w(TAG, "orb event sync not scheduled", e); }
    }

    private static void pass(Context c) {
        String origin = MizelConfig.origin(c);
        boolean left = false;
        int sent = 0;
        for (JSONObject r : MeetingRecorderService.receipts(c)) {
            if (!MeetingEventProjection.pending(r)) continue;
            JSONObject body = MeetingEventProjection.body(r);
            try {
                put(origin, body);
                if (!confirmed(origin, body)) throw new IOException("not confirmed on read-back");
                MeetingRecorderService.markAcked(c, body.getString("id"), body.getLong("clientRevision"));
                sent++;
                Log.i(TAG, "orb event synced " + body.optString("id") + " rev=" + body.optLong("clientRevision") + " status=" + body.optString("status") + " kind=" + body.optString("kind"));
            } catch (Exception e) {
                left = true;
                Log.w(TAG, "orb event sync pending " + r.optString("id") + ": " + e.getMessage());
            }
        }
        // Something may have been written while we were posting: look again rather than wait for the next kick.
        for (JSONObject r : MeetingRecorderService.receipts(c)) if (MeetingEventProjection.pending(r)) { left = true; break; }
        final boolean again = left;
        final boolean progressed = sent > 0;
        main.post(() -> {
            main.removeCallbacks(retry);
            if (!again) { failures = 0; return; }
            if (!progressed) failures = Math.min(failures + 1, BACKOFF.length - 1);
            main.postDelayed(retry, progressed ? 1_000 : BACKOFF[failures]);
        });
    }

    private static void put(String origin, JSONObject body) throws IOException {
        HttpURLConnection c = open(origin, "/mizel-live/orb-events");
        try {
            byte[] b = body.toString().getBytes(StandardCharsets.UTF_8);
            c.setRequestMethod("PUT");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setFixedLengthStreamingMode(b.length);
            try (OutputStream os = c.getOutputStream()) { os.write(b); }
            int code = c.getResponseCode();
            String resp = read(code >= 400 ? c.getErrorStream() : c.getInputStream());
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code + " " + resp.substring(0, Math.min(200, resp.length())));
        } finally { c.disconnect(); }
    }

    private static boolean confirmed(String origin, JSONObject body) throws Exception {
        HttpURLConnection c = open(origin, "/mizel-live/orb-events?meetingId=" + URLEncoder.encode(body.getString("meetingId"), "UTF-8"));
        try {
            int code = c.getResponseCode();
            if (code != 200) return false;
            JSONArray events = new JSONObject(read(c.getInputStream())).optJSONArray("events");
            if (events == null) return false;
            for (int i = 0; i < events.length(); i++) {
                JSONObject e = events.optJSONObject(i);
                if (e != null && body.optString("id").equals(e.optString("id"))) return MeetingEventProjection.confirms(e, body);
            }
            return false;
        } finally { c.disconnect(); }
    }

    private static HttpURLConnection open(String origin, String path) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(ai.wizards.os.device.AppState.live(origin) + path).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(15000);
        c.setUseCaches(false);
        c.setRequestProperty("Origin", origin);
        c.setRequestProperty("Accept", "application/json");
        return c;
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream s = in) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) { o.write(buf, 0, n); if (o.size() > 2_000_000) break; }
            return new String(o.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
