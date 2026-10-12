package ai.wizards.os.audio;

import android.net.Uri;
import android.webkit.CookieManager;
import androidx.media3.common.C;
import androidx.media3.datasource.BaseDataSource;
import androidx.media3.datasource.DataSpec;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** No redirects: credentials and bytes are confined to the bound app and origin. */
final class AudioHttp extends BaseDataSource {
    private final String origin;
    private HttpURLConnection connection;
    private InputStream input;
    private DataSpec spec;
    private long remaining;
    private boolean opened;
    AudioHttp(String origin) { super(true); this.origin = origin; }
    static HttpURLConnection connect(String url, String origin, String kind) throws IOException {
        if (!AudioPolicy.trusted(url, origin, kind)) throw new IOException("Untrusted audio URL");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false); c.setConnectTimeout(20000); c.setReadTimeout(60000);
        c.setRequestProperty("User-Agent", "WizardBackgroundAudio/1");
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null && !cookies.isEmpty()) c.setRequestProperty("Cookie", cookies);
        return c;
    }
    static JSONObject json(String url, String origin, String kind, JSONObject body) throws Exception {
        HttpURLConnection c = connect(url, origin, kind);
        try {
            c.setRequestProperty("Accept", "application/json");
            if (body != null) {
                c.setRequestMethod("POST"); c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json");
                byte[] data = body.toString().getBytes(StandardCharsets.UTF_8); c.setFixedLengthStreamingMode(data.length);
                try (OutputStream out = c.getOutputStream()) { out.write(data); }
            }
            if (c.getResponseCode() != 200) throw new IOException("Music endpoint " + c.getResponseCode());
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] b = new byte[8192]; int n;
                while ((n = in.read(b)) != -1) { out.write(b, 0, n); if (out.size() > 1000000) throw new IOException("Audio response too large"); }
                return new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            }
        } finally { c.disconnect(); }
    }
    @Override public long open(DataSpec d) throws IOException {
        spec = d; transferInitializing(d);
        String url = d.uri.toString(); String kind = url.contains("/art/") ? "art" : "stream";
        connection = connect(url, origin, kind);
        if (d.position > 0 || d.length != C.LENGTH_UNSET) {
            String range = "bytes=" + d.position + "-" + (d.length == C.LENGTH_UNSET ? "" : Long.toString(d.position + d.length - 1));
            connection.setRequestProperty("Range", range);
        }
        int code = connection.getResponseCode();
        if (code != 200 && code != 206) { connection.disconnect(); connection = null; throw new IOException("Audio HTTP " + code); }
        input = connection.getInputStream();
        if (code == 200 && d.position > 0) {
            long left = d.position; byte[] skip = new byte[8192];
            while (left > 0) { int n = input.read(skip, 0, (int)Math.min(left, skip.length)); if (n < 0) throw new EOFException(); left -= n; }
        }
        long length = connection.getContentLengthLong();
        remaining = d.length != C.LENGTH_UNSET ? d.length : length < 0 ? C.LENGTH_UNSET : length - (code == 200 ? d.position : 0);
        opened = true; transferStarted(d); return remaining;
    }
    @Override public int read(byte[] b, int offset, int len) throws IOException {
        if (len == 0) return 0;
        if (remaining == 0) return C.RESULT_END_OF_INPUT;
        int n = input.read(b, offset, remaining < 0 ? len : (int)Math.min(len, remaining));
        if (n < 0) return C.RESULT_END_OF_INPUT;
        if (remaining >= 0) remaining -= n;
        bytesTransferred(n); return n;
    }
    @Override public Uri getUri() { return spec == null ? null : spec.uri; }
    @Override public Map<String,List<String>> getResponseHeaders() { return connection == null ? Collections.emptyMap() : connection.getHeaderFields(); }
    @Override public void close() throws IOException {
        try { if (input != null) input.close(); }
        finally { input = null; if (connection != null) connection.disconnect(); connection = null; spec = null;
            if (opened) { opened = false; transferEnded(); } }
    }
}
