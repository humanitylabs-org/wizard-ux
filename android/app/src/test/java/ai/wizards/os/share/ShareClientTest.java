package ai.wizards.os.share;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

/**
 * The share client against an in-memory Wizard that implements the v1 shares/uploads contract, including the
 * failure modes the phone meets: connections dropping mid-chunk (part of the bytes landed), offset conflicts,
 * the Wizard restarting, a full disk, a Wizard without the API, and replays of the same client_share_id.
 */
public class ShareClientTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /** The fake Wizard. */
    static final class Wizard implements ShareClient.Transport {
        final Map<String, String> byClient = new HashMap<>();
        final Map<String, byte[]> data = new HashMap<>();
        final Map<String, Long> offset = new HashMap<>();
        final Map<String, Boolean> complete = new HashMap<>();
        String shareId; int creates, deliveries, patches; long chunk = 65536;
        boolean noApi, full, down;
        int dropAfter = -1;      // drop the connection on the Nth patch after this many bytes landed
        long dropBytes;
        int conflictOnce = -1;   // answer one 409 on the Nth patch (server is ahead)
        // The real server's other answers (wizard-agent-service server/uploads.mjs + service.mjs @ 4f4d74e).
        int createCode; String createError = "";   // e.g. 409 agent_unavailable, 404 thread_not_found, 413 file_too_large
        int patchCode; String patchError = "";     // e.g. 507 insufficient_storage mid-upload
        int completeIncompleteOnce;                // 409 upload_incomplete once, while the last chunk is still settling
        boolean shaMismatch;                       // 422 sha256_mismatch on complete
        String agentLabel = "", runId = "";        // agent_label / run_id on share responses
        String failShare = "";                     // GET /shares/<id> answers status failed with this error
        int statusGets;

        @Override public ShareClient.Resp json(String method, String path, JSONObject body) throws IOException {
            if (down) throw new IOException("unreachable");
            try {
                if ("POST".equals(method) && path.equals("/wizard/v1/shares")) {
                    if (noApi) return new ShareClient.Resp(404, new JSONObject().put("error", "not_found"), null);
                    if (full) return new ShareClient.Resp(507, new JSONObject().put("error", "insufficient_storage"), null);
                    if (createCode != 0) return new ShareClient.Resp(createCode, new JSONObject().put("error", createError), null);
                    creates++;
                    String key = body.getString("client_share_id");
                    JSONArray fs = body.getJSONArray("files");
                    if (!byClient.containsKey(key)) {
                        shareId = "sh_" + byClient.size();
                        byClient.put(key, shareId);
                        for (int i = 0; i < fs.length(); i++) { String u = "up_" + i; data.put(u, new byte[(int) fs.getJSONObject(i).getLong("bytes")]); offset.put(u, 0L); complete.put(u, false); }
                    }
                    JSONArray ups = new JSONArray();
                    for (int i = 0; i < fs.length(); i++) ups.put(new JSONObject().put("upload_id", "up_" + i).put("offset", offset.get("up_" + i)).put("bytes", data.get("up_" + i).length).put("chunk_bytes", chunk));
                    JSONObject out = new JSONObject().put("share_id", byClient.get(key)).put("thread_id", "wizard_t1").put("agent", "hermes").put("status", "uploading").put("uploads", ups);
                    if (!agentLabel.isEmpty()) out.put("agent_label", agentLabel);
                    return new ShareClient.Resp(201, out, null);
                }
                if ("GET".equals(method) && path.startsWith("/wizard/v1/uploads/")) {
                    String u = path.substring("/wizard/v1/uploads/".length());
                    if (!data.containsKey(u)) return new ShareClient.Resp(404, new JSONObject(), null);
                    return new ShareClient.Resp(200, new JSONObject().put("offset", offset.get(u)).put("status", complete.get(u) ? "complete" : "uploading"), null);
                }
                if ("POST".equals(method) && path.endsWith("/complete")) {
                    String u = path.substring("/wizard/v1/uploads/".length(), path.length() - "/complete".length());
                    if (offset.get(u) != data.get(u).length) return new ShareClient.Resp(409, new JSONObject().put("error", "upload_incomplete").put("offset", offset.get(u)), null);
                    if (completeIncompleteOnce > 0) { completeIncompleteOnce--; return new ShareClient.Resp(409, new JSONObject().put("error", "upload_incomplete").put("offset", offset.get(u)), null); }
                    if (shaMismatch) return new ShareClient.Resp(422, new JSONObject().put("error", "sha256_mismatch"), null);
                    if (!complete.get(u)) { complete.put(u, true); if (complete.values().stream().allMatch(b -> b)) deliveries++; }
                    return new ShareClient.Resp(200, new JSONObject().put("file", new JSONObject().put("id", "wf_" + u)), null);
                }
                if ("GET".equals(method) && path.startsWith("/wizard/v1/shares/")) {
                    statusGets++;
                    boolean all = complete.values().stream().allMatch(b -> b);
                    JSONObject out = new JSONObject().put("status", !failShare.isEmpty() ? "failed" : all ? "delivered" : "uploading").put("thread_id", "wizard_t1");
                    if (!failShare.isEmpty()) out.put("error", failShare);
                    if (!agentLabel.isEmpty()) out.put("agent_label", agentLabel);
                    if (all && !runId.isEmpty()) out.put("run_id", runId);
                    return new ShareClient.Resp(200, out, null);
                }
            } catch (JSONException e) { throw new IOException(e); }
            return new ShareClient.Resp(404, new JSONObject(), null);
        }

        @Override public ShareClient.Resp patch(String path, File f, long off, long len, ShareClient.Progress p) throws IOException {
            if (down) throw new IOException("unreachable");
            String u = path.substring("/wizard/v1/uploads/".length());
            patches++;
            try {
                if (patchCode != 0) return new ShareClient.Resp(patchCode, new JSONObject().put("error", patchError), null);
                if (patches == conflictOnce) {
                    // An earlier chunk landed after all: the Wizard is ahead of the phone.
                    long ahead = Math.min(data.get(u).length, offset.get(u) + len);
                    copy(f, u, offset.get(u), ahead - offset.get(u));
                    offset.put(u, ahead);
                    return new ShareClient.Resp(409, new JSONObject().put("error", "offset_mismatch").put("offset", ahead), null);
                }
                if (off != offset.get(u)) return new ShareClient.Resp(409, new JSONObject().put("error", "offset_mismatch").put("offset", offset.get(u)), null);
                if (patches == dropAfter) { copy(f, u, off, dropBytes); offset.put(u, off + dropBytes); throw new IOException("connection reset"); }
                copy(f, u, off, len);
                offset.put(u, off + len);
                p.bytes(len);
                return new ShareClient.Resp(204, new JSONObject(), Long.toString(off + len));
            } catch (JSONException e) { throw new IOException(e); }
        }

        void copy(File f, String u, long off, long len) throws IOException {
            try (RandomAccessFile r = new RandomAccessFile(f, "r")) { r.seek(off); r.readFully(data.get(u), (int) off, (int) len); }
        }
    }

    Wizard wiz;
    File a, b;
    byte[] A, B;

    @Before public void setUp() throws IOException {
        wiz = new Wizard();
        Random rnd = new Random(7);
        A = new byte[300_000]; rnd.nextBytes(A);
        B = new byte[70_000]; rnd.nextBytes(B);
        a = tmp.newFile("0.bin"); Files.write(a.toPath(), A);
        b = tmp.newFile("1.bin"); Files.write(b.toPath(), B);
    }

    JSONObject item() throws JSONException {
        JSONArray fs = new JSONArray()
                .put(new JSONObject().put("name", "a.bin").put("mime", "application/octet-stream").put("bytes", A.length).put("sha256", "x"))
                .put(new JSONObject().put("name", "b.bin").put("mime", "application/octet-stream").put("bytes", B.length));
        return new JSONObject().put("id", "and-1-abc").put("state", ShareQueue.READY).put("agentLabel", "Wizard").put("note", "hi").put("files", fs).put("uploads", new JSONArray());
    }

    final int[] saves = {0};
    ShareClient client() {
        return new ShareClient(wiz, new ShareClient.Listener() {
            @Override public void saved(JSONObject it) { saves[0]++; }
            @Override public void progress(JSONObject it, long sent, long total) { assertTrue(sent <= total); }
        }, () -> false);
    }

    ShareClient.Outcome run(JSONObject it) { return client().run(it, n -> n == 0 ? a : b); }

    @Test public void uploadsInChunksAndDeliversOnce() throws Exception {
        JSONObject it = item();
        assertEquals(ShareClient.Outcome.DELIVERED, run(it));
        assertArrayEquals(A, wiz.data.get("up_0"));
        assertArrayEquals(B, wiz.data.get("up_1"));
        assertEquals(1, wiz.deliveries);
        assertEquals(5 + 2, wiz.patches); // 64 KiB chunks
        assertEquals("wizard_t1", it.getString("thread_id"));
        assertEquals(ShareQueue.DELIVERED, it.getString("state"));
        assertTrue(saves[0] > 7);
    }

    @Test public void aDroppedChunkResumesFromWhatTheWizardActuallyHas() throws Exception {
        wiz.dropAfter = 3; wiz.dropBytes = 333; // part of chunk 3 landed, then the connection died
        JSONObject it = item();
        assertEquals(ShareClient.Outcome.DELIVERED, run(it));
        assertArrayEquals(A, wiz.data.get("up_0"));
        assertArrayEquals(B, wiz.data.get("up_1"));
        assertEquals(1, wiz.deliveries);
    }

    @Test public void anOffsetConflictJumpsToTheServerOffset() throws Exception {
        wiz.conflictOnce = 2;
        JSONObject it = item();
        assertEquals(ShareClient.Outcome.DELIVERED, run(it));
        assertArrayEquals(A, wiz.data.get("up_0"));
        assertEquals(1, wiz.deliveries);
    }

    @Test public void wizardDownThenBackResumesWithoutRestartingOrDoublePosting() throws Exception {
        JSONObject it = item();
        // First run: two chunks land, then the Wizard goes away (network loss / restart / process death).
        wiz.dropAfter = 3; wiz.dropBytes = 0;
        ShareClient c = new ShareClient(wiz, new ShareClient.Listener() {
            @Override public void saved(JSONObject x) { if (wiz.patches >= 3) wiz.down = true; }
            @Override public void progress(JSONObject x, long s, long t) { }
        }, () -> false);
        assertEquals(ShareClient.Outcome.RETRY, c.run(it, n -> n == 0 ? a : b));
        long sentBefore = ShareQueue.sentBytes(it);
        assertTrue(sentBefore >= 2 * 65536);
        // The phone restarts from item.json: replaying the same client_share_id returns the same share.
        JSONObject again = new JSONObject(it.toString());
        wiz.down = false; wiz.dropAfter = -1;
        int patchesBefore = wiz.patches;
        assertEquals(ShareClient.Outcome.DELIVERED, run(again));
        assertEquals(1, wiz.creates);
        assertEquals(1, wiz.deliveries);
        assertArrayEquals(A, wiz.data.get("up_0"));
        assertEquals(3 + 2, wiz.patches - patchesBefore); // only the rest: 128 KiB were already there
    }

    @Test public void replayingAShareBeforeTheServerIdWasSavedNeverPostsTwice() throws Exception {
        JSONObject it = item();
        assertEquals(ShareClient.Outcome.DELIVERED, run(it));
        JSONObject lost = item(); // the phone died before saving share_id: it creates again with the same key
        assertEquals(ShareClient.Outcome.DELIVERED, run(lost));
        assertEquals(1, wiz.deliveries);
        assertEquals(1, wiz.byClient.size());
    }

    @Test public void aFullWizardFailsWithAClearReason() throws Exception {
        wiz.full = true;
        ShareClient c = client();
        assertEquals(ShareClient.Outcome.FAILED, c.run(item(), n -> n == 0 ? a : b));
        assertEquals(ShareClient.NO_SPACE_WIZARD, c.reason);
    }

    @Test public void aWizardWithoutTheApiHandsOffToTheApp() throws Exception {
        wiz.noApi = true;
        assertEquals(ShareClient.Outcome.HANDOFF, run(item()));
    }

    @Test public void offlineIsARetryNotAFailure() throws Exception {
        wiz.down = true;
        assertEquals(ShareClient.Outcome.RETRY, run(item()));
    }

    @Test public void aMissingCopyFails() throws Exception {
        JSONObject it = item();
        assertTrue(b.delete());
        assertEquals(ShareClient.Outcome.FAILED, run(it));
    }

    /* ---- the real Agent Service's answers (contract check against wizard-agent-service main @ 4f4d74e) ---- */

    @Test public void agentLabelAndRunIdFromTheServerAreKept() throws Exception {
        wiz.agentLabel = "Archimedes"; wiz.runId = "run_42";
        JSONObject it = item();
        assertEquals(ShareClient.Outcome.DELIVERED, run(it));
        assertEquals("Archimedes", it.getString("agentLabel"));
        assertEquals("run_42", it.getString("run_id"));
        assertEquals("wizard_t1", it.getString("thread_id"));
    }

    @Test public void theThreadIdIsKnownFromCreateBeforeAnyByteMoves() throws Exception {
        JSONObject it = item();
        wiz.down = false;
        ShareClient c = new ShareClient(wiz, new ShareClient.Listener() {
            @Override public void saved(JSONObject x) { if (x.has("share_id")) wiz.down = true; }
            @Override public void progress(JSONObject x, long s, long t) { }
        }, () -> false);
        assertEquals(ShareClient.Outcome.RETRY, c.run(it, n -> n == 0 ? a : b));
        assertEquals("wizard_t1", it.getString("thread_id")); // the progress notification opens this thread already
    }

    void failsWith(int code, String error, String reason) throws Exception {
        wiz = new Wizard();
        wiz.createCode = code; wiz.createError = error;
        ShareClient c = client();
        assertEquals(error, ShareClient.Outcome.FAILED, c.run(item(), n -> n == 0 ? a : b));
        assertEquals(error, reason, c.reason);
        assertEquals(0, wiz.deliveries);
    }

    @Test public void createRefusalsSayWhatHappenedInPlainWords() throws Exception {
        failsWith(507, "insufficient_storage", "Not enough space on your Wizard");
        failsWith(413, "file_too_large", "File too large for this Wizard");
        failsWith(409, "agent_unavailable", "That agent isn’t available · share again to Wizard");
        failsWith(404, "thread_not_found", "That chat is no longer there · share again");
        failsWith(409, "client_share_id_conflict", "This share clashed with an earlier one · share it again");
        failsWith(400, "too_many_files", "Wizard takes up to 8 files at a time · share fewer");
    }

    @Test public void aWizardWithItsUploadStoreOffHandsOffToTheApp() throws Exception {
        wiz.createCode = 503; wiz.createError = "service_unavailable";
        assertEquals(ShareClient.Outcome.HANDOFF, run(item()));
    }

    @Test public void aDiskThatFillsMidUploadFailsClearlyAndNothingIsDelivered() throws Exception {
        wiz.patchCode = 507; wiz.patchError = "insufficient_storage";
        ShareClient c = client();
        assertEquals(ShareClient.Outcome.FAILED, c.run(item(), n -> n == 0 ? a : b));
        assertEquals(ShareClient.NO_SPACE_WIZARD, c.reason);
        assertEquals(0, wiz.deliveries);
    }

    @Test public void aChunkTooLargeHalvesTheChunkButFileTooLargeFails() throws Exception {
        wiz.patchCode = 413; wiz.patchError = "file_too_large";
        ShareClient c = client();
        assertEquals(ShareClient.Outcome.FAILED, c.run(item(), n -> n == 0 ? a : b));
        assertEquals(ShareClient.TOO_LARGE, c.reason);
    }

    @Test public void uploadIncompleteOnCompleteReconcilesAndStillDeliversOnce() throws Exception {
        wiz.completeIncompleteOnce = 1;
        JSONObject it = item();
        ShareClient.Outcome o = run(it);
        if (o == ShareClient.Outcome.RETRY) o = run(it); // "still checking": the next pass completes
        assertEquals(ShareClient.Outcome.DELIVERED, o);
        assertEquals(1, wiz.deliveries);
    }

    @Test public void aChangedFileFailsWithAPlainReason() throws Exception {
        wiz.shaMismatch = true;
        ShareClient c = client();
        assertEquals(ShareClient.Outcome.FAILED, c.run(item(), n -> n == 0 ? a : b));
        assertEquals("A file changed while it was uploading · share it again", c.reason);
    }

    @Test public void aServerSideDeliveryFailureIsReportedNotSilent() throws Exception {
        wiz.failShare = "agent_unavailable";
        ShareClient c = client();
        assertEquals(ShareClient.Outcome.FAILED, c.run(item(), n -> n == 0 ? a : b));
        assertEquals("That agent isn’t available · share again to Wizard", c.reason);
    }

    @Test public void plainWordsNeverLeakARawCode() {
        for (String code : new String[]{"insufficient_storage", "file_too_large", "sha256_mismatch", "upload_failed", "agent_unavailable",
                "thread_not_found", "client_upload_id_conflict", "client_share_id_conflict", "too_many_files", "share_delivery_failed", "", "x"}) {
            String p = ShareClient.plain(code);
            assertTrue(code, !p.isEmpty() && !p.contains("_"));
        }
    }

    @Test public void eachShareNotificationOpensItsOwnThread() throws Exception {
        JSONObject one = new JSONObject().put("id", "and-1-aaa").put("thread_id", "wizard_1");
        JSONObject two = new JSONObject().put("id", "and-2-bbb").put("thread_id", "wizard_2");
        JSONObject pending = new JSONObject().put("id", "and-1-aaa");
        assertEquals("share:and-1-aaa:wizard_1", ShareNotifier.identity(one));
        assertTrue(!ShareNotifier.identity(one).equals(ShareNotifier.identity(two)));
        assertTrue(!ShareNotifier.identity(one).equals(ShareNotifier.identity(pending))); // before/after the thread is known
        assertEquals("", ShareNotifier.identity(null));
    }
}
