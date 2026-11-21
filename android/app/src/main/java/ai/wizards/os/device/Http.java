package ai.wizards.os.device;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Minimal JSON-over-HTTP for the native features (same shape as the Everywhere outbox's client). */
public final class Http {
    private Http() {}

    public static final class Error extends IOException {
        public final int status;
        /** First 4 KB of the error response body ("" when none): lets a caller tell the service's own JSON error from a proxy's. */
        public final String body;
        public Error(int status, String m) { this(status, m, ""); }
        public Error(int status, String m, String body) { super(m); this.status = status; this.body = body == null ? "" : body; }
    }

    public static JSONObject json(String method, String url, String origin, byte[] body, String type, String... headers) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(8000);
            c.setReadTimeout(body != null && body.length > 200_000 ? 120_000 : 30_000);
            c.setRequestMethod(method);
            c.setRequestProperty("Origin", origin);
            ShellToken.apply(c);
            c.setRequestProperty("Accept", "application/json");
            for (int i = 0; i + 1 < headers.length; i += 2) c.setRequestProperty(headers[i], headers[i + 1]);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", type);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream os = c.getOutputStream()) { os.write(body); }
            }
            int code = c.getResponseCode();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String resp = is == null ? "" : new String(readAll(is), StandardCharsets.UTF_8);
            if (code < 200 || code >= 300) throw new Error(code, "HTTP " + code, resp.length() > 4096 ? resp.substring(0, 4096) : resp);
            try { return resp.isEmpty() ? new JSONObject() : new JSONObject(resp); }
            catch (JSONException e) { throw new Error(code, "not JSON"); }
        } catch (Error e) {
            throw e;
        } catch (IOException e) {
            throw new Error(0, "Couldn’t reach Wizard");
        } finally {
            c.disconnect();
        }
    }

    public static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        return out.toByteArray();
    }
}
