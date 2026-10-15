package ai.wizards.os.share;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Plain HTTPS to the private Wizard origin with an Origin header, no cookies or tokens (the box is reachable only
 * over the owner's tailnet), like the Everywhere and Mizel outboxes. Chunks stream from the private copy with a
 * fixed length: nothing is held in memory beyond a 64 KB buffer.
 */
public final class ShareHttp implements ShareClient.Transport {
    private final String origin;

    public ShareHttp(String origin) { this.origin = origin; }

    private HttpURLConnection open(String method, String path, int readMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(ai.wizards.os.device.AppState.live(origin) + path).openConnection();
        c.setConnectTimeout(10_000);
        c.setReadTimeout(readMs);
        c.setUseCaches(false);
        c.setRequestMethod(method); // Android's HttpURLConnection (OkHttp) accepts PATCH
        c.setRequestProperty("Origin", origin);
        c.setRequestProperty("Accept", "application/json");
        return c;
    }

    @Override
    public ShareClient.Resp json(String method, String path, JSONObject body) throws IOException {
        HttpURLConnection c = open(method, path, 30_000);
        try {
            if (body != null) {
                byte[] b = body.toString().getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setFixedLengthStreamingMode(b.length);
                try (OutputStream os = c.getOutputStream()) { os.write(b); }
            } else if ("POST".equals(method)) {
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(0);
                c.getOutputStream().close();
            }
            return read(c);
        } finally { c.disconnect(); }
    }

    @Override
    public ShareClient.Resp patch(String path, File f, long offset, long len, ShareClient.Progress p) throws IOException {
        HttpURLConnection c = open("PATCH", path, 90_000);
        try (FileInputStream in = new FileInputStream(f)) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/offset+octet-stream");
            c.setRequestProperty("Upload-Offset", Long.toString(offset));
            c.setFixedLengthStreamingMode(len);
            in.getChannel().position(offset);
            byte[] buf = new byte[65536];
            long sent = 0, lastReport = 0;
            try (OutputStream os = c.getOutputStream()) {
                while (sent < len) {
                    int r = in.read(buf, 0, (int) Math.min(buf.length, len - sent));
                    if (r < 0) throw new IOException("copy shrank");
                    os.write(buf, 0, r);
                    sent += r;
                    if (sent - lastReport >= 512 * 1024 || sent == len) { p.bytes(sent); lastReport = sent; }
                }
            }
            return read(c);
        } finally { c.disconnect(); }
    }

    private static ShareClient.Resp read(HttpURLConnection c) throws IOException {
        int code = c.getResponseCode();
        InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String s = "";
        if (is != null) try (InputStream in = is) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int r, n = 0;
            while ((r = in.read(b)) > 0 && n < 1 << 20) { o.write(b, 0, r); n += r; }
            s = o.toString("UTF-8");
        }
        JSONObject j;
        try { j = s.trim().isEmpty() ? new JSONObject() : new JSONObject(s); } catch (JSONException e) { j = new JSONObject(); }
        return new ShareClient.Resp(code, j, c.getHeaderField("Upload-Offset"));
    }
}
