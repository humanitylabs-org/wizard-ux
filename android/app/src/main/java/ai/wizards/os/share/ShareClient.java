package ai.wizards.os.share;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;

/**
 * The client half of the Agent Service v1 shares contract (briefs/share-files.md), free of Android so it runs in
 * JVM tests against a fake Wizard:
 *
 *   POST /wizard/v1/shares {client_share_id, agent?, thread?, note?, files:[{filename, mime, bytes, sha256}]}
 *        → {share_id, agent, thread_id, status, uploads:[{upload_id, offset, bytes, chunk_bytes}]}   (idempotent)
 *   PATCH /wizard/v1/uploads/&lt;id&gt;  Upload-Offset: n  (raw bytes)  → 204 Upload-Offset: new | 409 {offset}
 *   GET   /wizard/v1/uploads/&lt;id&gt;  → {offset, status}     (reconcile after a lost request)
 *   POST  /wizard/v1/uploads/&lt;id&gt;/complete → {file}       (idempotent)
 *   GET   /wizard/v1/shares/&lt;id&gt;   → {status: uploading|delivering|delivered|failed}
 *
 * {@link #run} carries one share as far as it can and says why it stopped. Every server answer that moves the
 * share forward is saved first, so a process death resumes from the last acknowledged byte, and replaying the
 * same client_share_id never makes the Wizard post twice.
 */
public final class ShareClient {
    public enum Outcome { DELIVERED, RETRY, FAILED, HANDOFF, STOPPED }

    public static final long MAX_CHUNK = 64L * 1024 * 1024, DEFAULT_CHUNK = 8L * 1024 * 1024, MIN_CHUNK = 64 * 1024;
    public static final String NO_SPACE_WIZARD = "Not enough space on your Wizard";
    public static final String TOO_LARGE = "File too large for this Wizard";
    public static final String EXPIRED = "The upload expired on your Wizard · share it again";
    /** The Agent Service takes this many files per share (uploads.mjs SHARE_FILE_LIMIT). */
    public static final int MAX_FILES = 8;

    /** HTTP answer. code 0 never appears: a lost connection is an IOException. */
    public static final class Resp {
        public final int code; public final JSONObject body; public final String uploadOffset;
        public Resp(int code, JSONObject body, String uploadOffset) { this.code = code; this.body = body == null ? new JSONObject() : body; this.uploadOffset = uploadOffset; }
    }

    public interface Transport {
        Resp json(String method, String path, JSONObject body) throws IOException;
        /** PATCH {@code len} bytes of {@code f} starting at {@code offset}, as Upload-Offset {@code offset}. */
        Resp patch(String path, File f, long offset, long len, Progress p) throws IOException;
    }

    public interface Progress { void bytes(long sentInThisRequest); }

    public interface Listener {
        void saved(JSONObject item);             // persist (the uploader writes item.json)
        void progress(JSONObject item, long sent, long total);
    }

    public interface Stop { boolean stop(); }

    private final Transport http;
    private final Listener out;
    private final Stop stop;
    public String reason = "";

    public ShareClient(Transport http, Listener out, Stop stop) { this.http = http; this.out = out; this.stop = stop; }

    public Outcome run(JSONObject it, FileOf files) {
        reason = "";
        try {
            if (it.optString("share_id").isEmpty()) {
                Outcome o = create(it);
                if (o != null) return o;
            }
            JSONArray ups = it.getJSONArray("uploads");
            long total = ShareQueue.totalBytes(it);
            for (int i = 0; i < ups.length(); i++) {
                JSONObject u = ups.getJSONObject(i);
                if (u.optBoolean("done")) continue;
                Outcome o = upload(it, u, files.of(i), total);
                if (o != null) return o;
            }
            return finish(it);
        } catch (Gone e) {
            reason = EXPIRED;
            return Outcome.FAILED;
        } catch (IOException e) {
            reason = "Waiting for your Wizard";
            return Outcome.RETRY;
        } catch (JSONException e) {
            reason = "Wizard sent an answer this app doesn’t understand";
            return Outcome.RETRY;
        }
    }

    public interface FileOf { File of(int n); }

    private Outcome create(JSONObject it) throws IOException, JSONException {
        JSONObject b = new JSONObject().put("client_share_id", it.getString("id"));
        if (!it.optString("agent").isEmpty()) b.put("agent", it.optString("agent"));
        if (!it.optString("thread").isEmpty()) b.put("thread", it.optString("thread"));
        if (!it.optString("note").trim().isEmpty()) b.put("note", it.optString("note").trim());
        JSONArray fs = new JSONArray(), src = it.getJSONArray("files");
        for (int i = 0; i < src.length(); i++) {
            JSONObject f = src.getJSONObject(i);
            JSONObject o = new JSONObject().put("filename", f.optString("name")).put("mime", f.optString("mime", "application/octet-stream")).put("bytes", f.getLong("bytes"));
            if (!f.optString("sha256").isEmpty()) o.put("sha256", f.optString("sha256"));
            fs.put(o);
        }
        b.put("files", fs);
        Resp r = http.json("POST", "/wizard/v1/shares", b);
        if (r.code == 200 || r.code == 201) {
            JSONArray ups = r.body.optJSONArray("uploads");
            if (r.body.optString("share_id").isEmpty() || ups == null || ups.length() != src.length()) { reason = "Wizard sent an unexpected answer"; return Outcome.RETRY; }
            JSONArray mine = new JSONArray();
            long chunk = DEFAULT_CHUNK;
            for (int i = 0; i < ups.length(); i++) {
                JSONObject u = ups.getJSONObject(i);
                mine.put(new JSONObject().put("upload_id", u.getString("upload_id")).put("offset", u.optLong("offset", 0)).put("bytes", u.optLong("bytes", src.getJSONObject(i).getLong("bytes"))).put("done", false));
                if (u.optLong("chunk_bytes", 0) > 0) chunk = u.optLong("chunk_bytes");
            }
            if (!r.body.optString("agent_label").trim().isEmpty()) it.put("agentLabel", r.body.optString("agent_label").trim());
            it.put("share_id", r.body.getString("share_id")).put("thread_id", r.body.optString("thread_id")).put("server_agent", r.body.optString("agent"))
              .put("uploads", mine).put("chunk", clampChunk(chunk)).put("state", ShareQueue.UPLOADING);
            out.saved(it);
            return null;
        }
        return answer(r, "create");
    }

    private Outcome upload(JSONObject it, JSONObject u, File f, long total) throws IOException, JSONException {
        String path = "/wizard/v1/uploads/" + u.getString("upload_id");
        long bytes = u.getLong("bytes");
        int conflicts = 0, lost = 0;
        if (f == null || !f.isFile() || f.length() != bytes) { reason = "The phone’s copy of a file is missing · share it again"; return Outcome.FAILED; }
        while (true) {
            if (stop.stop()) return Outcome.STOPPED;
            long off = u.getLong("offset");
            if (off < bytes) {
                long len = Math.min(it.optLong("chunk", DEFAULT_CHUNK), bytes - off);
                final long base = ShareQueue.sentBytes(it);
                Resp r;
                try { r = http.patch(path, f, off, len, n -> out.progress(it, base + n, total)); }
                catch (IOException e) {
                    // The request was lost somewhere: ask the Wizard what it actually has, then carry on from there.
                    reconcile(path, u);
                    out.saved(it);
                    if (++lost >= 4) { reason = "Waiting for your Wizard"; return Outcome.RETRY; } // back off, then resume
                    continue;
                }
                if (r.code == 204 || r.code == 200) {
                    lost = 0;
                    long next = parse(r.uploadOffset, off + len);
                    u.put("offset", Math.max(off, Math.min(bytes, next)));
                    out.saved(it); out.progress(it, ShareQueue.sentBytes(it), total);
                    continue;
                }
                if (r.code == 409 && r.body.has("offset")) {
                    if (++conflicts > 50) { reason = "The upload got out of step with your Wizard · share it again"; return Outcome.FAILED; }
                    u.put("offset", Math.max(0, Math.min(bytes, r.body.getLong("offset"))));
                    out.saved(it);
                    continue;
                }
                if (r.code == 413 && !"file_too_large".equals(r.body.optString("error")) && it.optLong("chunk", DEFAULT_CHUNK) > MIN_CHUNK) { it.put("chunk", Math.max(MIN_CHUNK, it.optLong("chunk", DEFAULT_CHUNK) / 2)); continue; }
                Outcome o = answer(r, "upload");
                if (o == Outcome.RETRY) reconcile(path, u);
                return o;
            }
            Resp r = http.json("POST", path + "/complete", null);
            if (r.code == 200 || r.code == 201) { u.put("done", true); out.saved(it); return null; }
            if (r.code == 409) { reconcile(path, u); if (u.getLong("offset") >= bytes) { reason = "Your Wizard is still checking the file"; return Outcome.RETRY; } continue; }
            if (r.code == 422) { reason = plain("sha256_mismatch"); return Outcome.FAILED; }
            return answer(r, "complete");
        }
    }

    private void reconcile(String path, JSONObject u) throws IOException, JSONException {
        Resp g = http.json("GET", path, null); // an IOException here means no network: the caller waits
        if (g.code == 200 && g.body.has("offset")) {
            u.put("offset", Math.max(0, Math.min(u.getLong("bytes"), g.body.getLong("offset"))));
            if ("complete".equals(g.body.optString("status"))) u.put("done", true);
        } else if (g.code == 404) throw new Gone();
    }

    /** The upload is unknown to the Wizard (expired or wiped): this share can’t be resumed. */
    static final class Gone extends IOException { Gone() { super("gone"); } }

    private Outcome finish(JSONObject it) throws IOException, JSONException {
        Resp r = http.json("GET", "/wizard/v1/shares/" + it.getString("share_id"), null);
        String st = r.body.optString("status");
        if (r.code == 200 && "failed".equals(st)) { reason = plain(r.body.optString("error")); return Outcome.FAILED; }
        if (r.code == 200 && "uploading".equals(st)) { reason = "Your Wizard is still receiving it"; return Outcome.RETRY; }
        if (r.code >= 500) { reason = "Your Wizard was unavailable (" + r.code + ")"; return Outcome.RETRY; }
        // delivered, delivering (the Wizard owns delivery from here) or an unreadable status after every byte landed.
        if (!r.body.optString("thread_id").isEmpty()) it.put("thread_id", r.body.optString("thread_id"));
        if (!r.body.optString("agent_label").trim().isEmpty()) it.put("agentLabel", r.body.optString("agent_label").trim());
        if (!r.body.optString("run_id").isEmpty()) it.put("run_id", r.body.optString("run_id"));
        it.put("state", ShareQueue.DELIVERED).put("server_status", st);
        out.saved(it);
        return Outcome.DELIVERED;
    }

    /** What a non-success answer means for this share (the Agent Service's codes: server/uploads.mjs, service.mjs). */
    private Outcome answer(Resp r, String phase) {
        String err = r.body.optString("error");
        if (r.code == 507) { reason = NO_SPACE_WIZARD; return Outcome.FAILED; }
        if (r.code == 413) { reason = TOO_LARGE; return Outcome.FAILED; }
        if (r.code == 404 && "thread_not_found".equals(err)) { reason = plain(err); return Outcome.FAILED; }
        // No v1 shares on this Wizard (an old service, or one whose upload store is off): finish in the app instead.
        if ("create".equals(phase) && (r.code == 404 || r.code == 405 || r.code == 501 || (r.code == 503 && "service_unavailable".equals(err)))) {
            reason = "This Wizard takes shares in the app"; return Outcome.HANDOFF;
        }
        if (r.code == 404) { reason = EXPIRED; return Outcome.FAILED; }
        if (r.code == 410) { reason = plain(err.isEmpty() ? "upload_failed" : err); return Outcome.FAILED; }
        if (r.code == 409 || r.code == 422 || (r.code == 400 && "too_many_files".equals(err))) { reason = plain(err); return Outcome.FAILED; }
        if (r.code == 400 && "bytes".equals(r.body.optString("field"))) { reason = "Empty files can’t be sent"; return Outcome.FAILED; }
        if (r.code == 408 || r.code == 425 || r.code == 429 || r.code >= 500 || r.code == 403 || r.code == 401) {
            reason = r.code == 403 || r.code == 401 ? "Wizard sign-in needed" : "Your Wizard was unavailable (" + r.code + ")";
            return Outcome.RETRY;
        }
        reason = "Your Wizard refused it (" + r.code + (err.isEmpty() ? "" : " " + err) + ")";
        return Outcome.FAILED;
    }

    /** Plain words for the Agent Service's error codes; never a raw code in a notification. */
    static String plain(String err) {
        String e = err == null ? "" : err;
        switch (e) {
            case "insufficient_storage": return NO_SPACE_WIZARD;
            case "file_too_large": return TOO_LARGE;
            case "sha256_mismatch": return "A file changed while it was uploading · share it again";
            case "expired": case "upload_failed": case "not_found": return EXPIRED;
            case "agent_unavailable": return "That agent isn’t available · share again to Wizard";
            case "thread_not_found": return "That chat is no longer there · share again";
            case "client_share_id_conflict": case "client_upload_id_conflict": return "This share clashed with an earlier one · share it again";
            case "too_many_files": return "Wizard takes up to " + MAX_FILES + " files at a time · share fewer";
            default:
                if (e.contains("stopped")) return "That agent is stopped · start it and share again";
                if (e.contains("thread")) return "That chat is no longer there · share again";
                if (e.contains("agent")) return "That agent isn’t available · share again to Wizard";
                return "Your Wizard couldn’t deliver it · share it again";
        }
    }

    static long clampChunk(long c) { return Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, c)); }

    static long parse(String s, long dflt) {
        try { return s == null || s.trim().isEmpty() ? dflt : Long.parseLong(s.trim()); } catch (NumberFormatException e) { return dflt; }
    }
}
