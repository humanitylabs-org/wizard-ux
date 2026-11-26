package ai.wizards.os;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The phone-side file cache of a home-screen app window (wizard-ux issue 1830, switch wizard/pin-instant-open). Plain
 * Java (org.json only), so PinCacheTest runs it on the JVM with a fake box. MainActivity.shouldInterceptRequest asks
 * {@link #answer} for every request of a pinned window while the switch is on; null means "pass it through untouched".
 *
 *  - The app's page (an HTML read from inside the window) always goes to the box, as a conditional read when a copy is
 *    kept (usually a 304). What identifies that version of the page (validators, else bytes) becomes the app's
 *    generation for this window.
 *  - The app's other files (scripts, styles, pictures, fonts under /<app>/) are answered from the phone with no request
 *    when they were kept under that same generation. A changed page means a new generation, so they are fetched again.
 *  - The shell's own unstamped files (/wizard-os-home/core/app-client.js and the like, loaded by apps) are kept per shell
 *    release (the pinned page tells the window its release); a release-stamped file marked immutable is kept as is.
 *  - Never kept: APIs, the window's own page, no-store / private / cookie-setting / varying answers, ranges, big files.
 *    A read that fails, or a redirect, passes through (null), so offline and error screens stay as they are.
 */
final class PinCache {
    interface Net { Reply get(String url, Map<String, String> headers) throws IOException; }

    static final class Reply {
        final int status; final String reason; final Map<String, String> headers; final byte[] body;
        Reply(int status, String reason, Map<String, String> headers, byte[] body) {
            this.status = status; this.reason = reason == null || reason.isEmpty() ? "OK" : reason;
            this.headers = headers == null ? new LinkedHashMap<>() : headers; this.body = body == null ? new byte[0] : body;
        }
        String mime() {
            String t = headers.getOrDefault("content-type", "application/octet-stream");
            int semi = t.indexOf(';');
            return (semi < 0 ? t : t.substring(0, semi)).trim();
        }
        String charset() {
            String t = headers.getOrDefault("content-type", "").toLowerCase(Locale.ROOT);
            int at = t.indexOf("charset=");
            if (at < 0) return null;
            String c = t.substring(at + 8).trim();
            int end = c.indexOf(';');
            return (end < 0 ? c : c.substring(0, end)).replace("\"", "").trim();
        }
    }

    private static final class Entry {
        final String url, gen; final Reply reply;
        Entry(String url, String gen, Reply reply) { this.url = url; this.gen = gen; this.reply = reply; }
    }

    private final File dir;
    private final Net net;
    private final String origin;
    private final Map<String, String> pages = new ConcurrentHashMap<>();
    private volatile String release = "";
    private final AtomicInteger stores = new AtomicInteger();
    final AtomicInteger hits = new AtomicInteger(), reads = new AtomicInteger();

    PinCache(File dir, Net net, String origin) { this.dir = dir; this.net = net; this.origin = origin; }

    /** The pinned page's shell release (its wos-release); unstamped shell files are kept per release. */
    void release(String token) { release = token != null && token.matches("[0-9a-f]{12}") ? token : ""; }

    /** null: pass through. Otherwise the answer to hand the WebView (from the phone or just read from the box). */
    Reply answer(String url, String method, boolean mainFrame, Map<String, String> requestHeaders) {
        URI u;
        try { u = new URI(url); } catch (Exception bad) { return null; }
        Map<String, String> req = lower(requestHeaders);
        PinInstantPolicy.Kind kind = PinInstantPolicy.kind(origin, u.getScheme(), u.getRawAuthority(), u.getRawPath(), method,
                mainFrame, req.getOrDefault("accept", ""), req.containsKey("range"));
        String app = PinInstantPolicy.app(u.getRawPath());
        switch (kind) {
            case PAGE: return page(url, app, requestHeaders);
            case FILE: { String g = pages.get(app); return g == null ? null : file(url, g, requestHeaders); }
            case SHELL: { String r = release; return r.isEmpty() ? null : file(url, "shell:" + r, requestHeaders); }
            default: return null;
        }
    }

    private Reply page(String url, String app, Map<String, String> requestHeaders) {
        Entry old = read(url);
        Map<String, String> h = PinInstantPolicy.forward(requestHeaders);
        if (old != null) {
            String etag = old.reply.headers.getOrDefault("etag", ""), modified = old.reply.headers.getOrDefault("last-modified", "");
            if (!etag.isEmpty()) h.put("If-None-Match", etag);
            if (!modified.isEmpty()) h.put("If-Modified-Since", modified);
        }
        Reply r;
        try { r = net.get(url, h); reads.incrementAndGet(); } catch (IOException | RuntimeException failed) { pages.remove(app); return null; }
        if (r.status == 304 && old != null) { pages.put(app, old.gen); touch(url); hits.incrementAndGet(); return old.reply; }
        if (r.status == 200) {
            String gen = PinInstantPolicy.generation(r.headers, sha1(r.body));
            pages.put(app, gen);
            if (PinInstantPolicy.storable(r.status, r.headers, r.body.length)) write(new Entry(url, gen, r)); else forget(url);
            return r;
        }
        pages.remove(app);
        return PinInstantPolicy.replayable(r.status) ? r : null;
    }

    private Reply file(String url, String gen, Map<String, String> requestHeaders) {
        Entry e = read(url);
        if (e != null && (gen.equals(e.gen) || (url.contains("?v=") && PinInstantPolicy.immutable(e.reply.headers)))) {
            touch(url); hits.incrementAndGet(); return e.reply;
        }
        Reply r;
        try { r = net.get(url, PinInstantPolicy.forward(requestHeaders)); reads.incrementAndGet(); } catch (IOException | RuntimeException failed) { return null; }
        if (PinInstantPolicy.storable(r.status, r.headers, r.body.length)) write(new Entry(url, gen, r));
        return PinInstantPolicy.replayable(r.status) ? r : null;
    }

    /* ---- the store: one file per URL (a small JSON head, then the body), newest kept within MAX_TOTAL ---- */

    private File fileOf(String url) { return new File(dir, sha1(url.getBytes(StandardCharsets.UTF_8)) + ".e"); }

    private Entry read(String url) {
        File f = fileOf(url);
        if (!f.isFile()) return null;
        try (DataInputStream in = new DataInputStream(new FileInputStream(f))) {
            byte[] head = new byte[in.readInt()];
            in.readFully(head);
            org.json.JSONObject j = new org.json.JSONObject(new String(head, StandardCharsets.UTF_8));
            if (!url.equals(j.optString("url"))) return null;
            Map<String, String> headers = new LinkedHashMap<>();
            org.json.JSONObject hj = j.optJSONObject("headers");
            if (hj != null) for (Iterator<String> it = hj.keys(); it.hasNext(); ) { String k = it.next(); headers.put(k, hj.optString(k)); }
            byte[] body = new byte[j.optInt("size", 0)];
            in.readFully(body);
            return new Entry(url, j.optString("gen"), new Reply(200, "OK", headers, body));
        } catch (Exception broken) { f.delete(); return null; }
    }

    private void write(Entry e) {
        try {
            if (!dir.isDirectory() && !dir.mkdirs()) return;
            org.json.JSONObject j = new org.json.JSONObject();
            j.put("url", e.url); j.put("gen", e.gen); j.put("size", e.reply.body.length);
            j.put("headers", new org.json.JSONObject(PinInstantPolicy.replay(e.reply.headers)));
            byte[] head = j.toString().getBytes(StandardCharsets.UTF_8);
            File tmp = new File(dir, fileOf(e.url).getName() + "." + Thread.currentThread().getId() + "." + System.nanoTime() + ".tmp");
            try (DataOutputStream out = new DataOutputStream(new FileOutputStream(tmp))) {
                out.writeInt(head.length); out.write(head); out.write(e.reply.body);
            }
            if (!tmp.renameTo(fileOf(e.url))) tmp.delete();
            if (stores.incrementAndGet() % 20 == 0) prune();
        } catch (Exception failed) { /* not kept: the next open reads it again */ }
    }

    private void touch(String url) { fileOf(url).setLastModified(System.currentTimeMillis()); }
    private void forget(String url) { fileOf(url).delete(); }

    void prune() {
        File[] all = dir.listFiles();
        if (all == null) return;
        java.util.Arrays.sort(all, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        long total = 0;
        for (File f : all) {
            if (f.getName().endsWith(".tmp") && System.currentTimeMillis() - f.lastModified() > 60_000L) { f.delete(); continue; }
            total += f.length();
            if (total > PinInstantPolicy.MAX_TOTAL) f.delete();
        }
    }

    /** Switch off: nothing of it stays on the phone. */
    static void clear(File dir) {
        File[] all = dir.listFiles();
        if (all != null) for (File f : all) f.delete();
        dir.delete();
    }

    static Map<String, String> lower(Map<String, String> h) {
        Map<String, String> out = new LinkedHashMap<>();
        if (h != null) for (Map.Entry<String, String> e : h.entrySet()) if (e.getKey() != null) out.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue());
        return out;
    }

    static String sha1(byte[] data) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(data);
            StringBuilder s = new StringBuilder();
            for (byte b : d) s.append(String.format(Locale.ROOT, "%02x", b));
            return s.toString();
        } catch (Exception e) { return Integer.toHexString(java.util.Arrays.hashCode(data)); }
    }

    /** Reads a whole answer, at most {@code cap} bytes; null when it is bigger. */
    static byte[] readAll(java.io.InputStream in, int cap) throws IOException {
        if (in == null) return new byte[0];
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > cap) return null;
        }
        return out.toByteArray();
    }
}
