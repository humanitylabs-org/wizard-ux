package ai.wizards.os.everywhere;

import ai.wizards.os.audio.CaptureJournal;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import ai.wizards.os.assist.Transcriber;

/**
 * The Everywhere button's outbox. Same contract as the app's web outbox (web/outbox.js):
 *  - the recording is written to app storage BEFORE anything goes over the network;
 *  - each message gets its session id and Idempotency-Key at creation, and the run body is frozen on
 *    first build, so a retry after a lost reply is replayed by Wizard instead of creating a second run;
 *  - transient failures retry on the same schedule (2 s … 2 min); then it is "Not sent" with a reason,
 *    a notification, and a Retry in Settings / the Inbox. Nothing is deleted until Wizard accepts it.
 */
public final class EverywhereOutbox {
    static final String TAG = "WizardEverywhere";

    /** Dictation goes to STT bare, like Archimedes Anywhere: a context prompt can leak into typed text. */
    static final String DICTATION_PROMPT = "";
    /** Where a recording came from: the floating orb, the side button (lock screen / corner), or keyboard dictation. */
    public static final String SRC_EVERYWHERE = "everywhere", SRC_SIDE = "side", SRC_DICTATION = "dictation";

    static String instructions(Item it) {
        int shots = it.shots == null ? 0 : it.shots.length();
        String where = SRC_SIDE.equals(it.source)
                ? (it.locked
                    ? "Spoken into the Wizard OS side-button assistant while the Android phone was LOCKED, so the speaker was not verified by an unlock. "
                    : "The user spoke this by holding their Android phone's side button (Wizard OS assistant, phone unlocked). ")
                : "The user spoke this to the Wizard Everywhere floating orb on their Android phone, outside the Wizard OS app (they may be in another app). ";
        return where + "The original recording is attached as a voice note."
                + (shots > 0 ? " They attached " + shots + " screenshot" + (shots == 1 ? "" : "s") + " of what was on their screen while talking." : "");
    }

    /** Debug (QA) builds only: files/qa_origin.txt points the outbox at a fake Wizard on the emulator host. */
    static String qaOrigin(Context c) {
        String configured = ai.wizards.os.device.AppState.origin(c);
        if (!ai.wizards.os.BuildConfig.DEBUG) return configured;
        File f = new File(c.getFilesDir(), "qa_origin.txt");
        if (!f.isFile()) return configured;
        try {
            String o = new String(readAll(new FileInputStream(f)), StandardCharsets.UTF_8).trim();
            return o.matches("http://10\\.0\\.2\\.2:\\d+") ? o : configured;
        } catch (IOException e) { return configured; }
    }

    public interface Listener {
        default void onOutboxChanged() { }
        default void onFailed(Item it) { }
        default void onSent(Item it) { }
        default void onReply(Item it, String text) { }
        /** The recording has been turned into words (before it is sent on to Wizard). */
        default void onWords(Item it, String text) { }
        /** Keyboard dictation: the words are ready to type. */
        default void onDictated(Item it, String text) { }
    }

    public static final class Item {
        public String id, state = "waiting", text = "", error = "", sessionId, audioPath = "", body = "", runId = "";
        public String source = SRC_EVERYWHERE;
        /** The Mizel meeting interruption this take borrowed the mic from ("" when none): its transcript marker. */
        public String meetingEvent = "";
        public long createdAt, nextAt, sentAt;
        /** Side button only: the phone was locked when this was spoken. */
        public boolean locked;
        public int attempts;
        boolean sessionReady;
        JSONObject audioFile;
        /** Screenshot paths (kept until Wizard accepts the message) and their Wizard Files records, in order. */
        JSONArray shots = new JSONArray(), shotFiles = new JSONArray();

        public boolean dictation() { return SRC_DICTATION.equals(source); }

        JSONObject json() throws JSONException {
            return new JSONObject().put("id", id).put("state", state).put("text", text).put("error", error)
                    .put("sessionId", sessionId).put("audioPath", audioPath).put("body", body).put("runId", runId)
                    .put("createdAt", createdAt).put("nextAt", nextAt).put("sentAt", sentAt).put("attempts", attempts)
                    .put("sessionReady", sessionReady).put("audioFile", audioFile == null ? JSONObject.NULL : audioFile)
                    .put("source", source).put("shots", shots).put("shotFiles", shotFiles).put("locked", locked)
                    .put("meetingEvent", meetingEvent);
        }

        static Item from(JSONObject o) {
            Item it = new Item();
            it.id = o.optString("id"); it.state = o.optString("state", "waiting"); it.text = o.optString("text");
            it.error = o.optString("error"); it.sessionId = o.optString("sessionId"); it.audioPath = o.optString("audioPath");
            it.body = o.optString("body"); it.runId = o.optString("runId"); it.createdAt = o.optLong("createdAt");
            it.nextAt = o.optLong("nextAt"); it.sentAt = o.optLong("sentAt"); it.attempts = o.optInt("attempts");
            it.sessionReady = o.optBoolean("sessionReady"); it.audioFile = o.optJSONObject("audioFile");
            it.source = o.optString("source", SRC_EVERYWHERE);
            it.locked = o.optBoolean("locked");
            it.meetingEvent = o.optString("meetingEvent");
            JSONArray a = o.optJSONArray("shots"); if (a != null) it.shots = a;
            JSONArray f = o.optJSONArray("shotFiles"); if (f != null) it.shotFiles = f;
            return it;
        }

        /** What Settings / the Inbox shows (no paths, no bodies). */
        JSONObject publicJson() throws JSONException {
            return new JSONObject().put("id", id).put("state", "sending".equals(state) ? "sending" : state)
                    .put("text", text).put("error", error).put("createdAt", createdAt).put("attempts", attempts)
                    .put("hasAudio", !audioPath.isEmpty()).put("sessionId", sessionId)
                    .put("source", source).put("shots", shots.length());
        }
    }

    static final class HttpError extends IOException {
        final int status;
        HttpError(int status, String msg) { super(msg); this.status = status; }
    }

    private static EverywhereOutbox instance;

    public static synchronized EverywhereOutbox get(Context c) {
        if (instance == null) {
            instance = new EverywhereOutbox(c.getApplicationContext(), qaOrigin(c));
            instance.app = c.getApplicationContext();
            ai.wizards.os.device.WizardIdentity.refresh(instance.app);
        }
        if (instance.unsent().isEmpty()) instance.origin = qaOrigin(c);
        return instance;
    }

    private final File dir, audioDir, file;
    private final CaptureJournal custody;
    private volatile String origin;
    private final Map<String, Item> items = new LinkedHashMap<>();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Listener> listeners = new ArrayList<>();
    private final Runnable pumpTask = this::pumpNow;
    private boolean pumping;
    /** Set for the app-wide instance: "Not sent" and reply notifications don't depend on the floating orb running. */
    private Context app;

    /** Visible for tests: a private store directory and a fake Wizard origin. */
    EverywhereOutbox(Context app, String origin) { this(new File(app.getFilesDir(), "everywhere"), origin); }

    EverywhereOutbox(File dir, String origin) {
        this.dir = dir; this.origin = origin;
        this.custody = CaptureJournal.at(dir.getParentFile());
        this.audioDir = new File(dir, "audio");
        this.file = new File(dir, "outbox.json");
        //noinspection ResultOfMethodCallIgnored
        audioDir.mkdirs();
        load();
    }

    public void addListener(Listener l) { synchronized (listeners) { listeners.add(l); } }
    public void removeListener(Listener l) { synchronized (listeners) { listeners.remove(l); } }

    /* ------------------------------------------------------------------ store */

    private synchronized void load() {
        items.clear();
        if (!file.isFile()) return;
        try {
            JSONArray a = new JSONArray(new String(readAll(new FileInputStream(file)), StandardCharsets.UTF_8));
            for (int i = 0; i < a.length(); i++) {
                Item it = Item.from(a.getJSONObject(i));
                if ("sending".equals(it.state)) it.state = "waiting"; // the app died mid-send: try again (same key)
                items.put(it.id, it);
            }
        } catch (Exception e) {
            Log.w(TAG, "outbox unreadable, keeping a copy", e);
            //noinspection ResultOfMethodCallIgnored
            file.renameTo(new File(dir, "outbox.broken-" + System.currentTimeMillis() + ".json"));
        }
    }

    /** Atomic write: temp file, fsync, rename. */
    private synchronized void save() {
        try {
            JSONArray a = new JSONArray();
            for (Item it : items.values()) a.put(it.json());
            File tmp = new File(dir, "outbox.json.tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(a.toString().getBytes(StandardCharsets.UTF_8));
                o.getFD().sync();
            }
            if (!tmp.renameTo(file)) throw new IOException("rename failed");
        } catch (Exception e) {
            Log.e(TAG, "outbox save failed", e);
        }
    }

    /** Takes ownership of a finished recording: moves it into the outbox and queues it. Returns the item. */
    public Item enqueueRecording(File recording) throws IOException { return enqueueRecording(recording, SRC_EVERYWHERE, null); }

    /**
     * Same, with where it came from and any screenshots. Everything (audio + PNGs) is on disk and fsynced before
     * this returns, so nothing depends on the network or this process surviving.
     */
    public Item enqueueRecording(File recording, String source, List<byte[]> screenshots) throws IOException {
        return enqueueRecording(recording, source, screenshots, false);
    }

    public Item enqueueRecording(File recording, String source, List<byte[]> screenshots, boolean locked) throws IOException {
        return enqueueRecording(recording, source, screenshots, locked, null, null);
    }

    /** New take id for {@code source}; a borrower names its take before recording so the meeting loan can bind it. */
    public static String newId(String source) {
        return (SRC_DICTATION.equals(source) ? "wos-dict-" : SRC_SIDE.equals(source) ? "wos-side-" : "wos-ev-") + UUID.randomUUID();
    }

    /** Same, keeping a take id chosen at record time and the meeting interruption it belongs to. */
    public Item enqueueRecording(File recording, String source, List<byte[]> screenshots, boolean locked, String id, String meetingEvent) throws IOException {
        Item it = new Item();
        it.locked = locked;
        String registered = custody.idFor(recording);
        it.id = registered != null ? registered : id != null ? id : newId(source);
        if (items.containsKey(it.id)) throw new IOException("Take already queued");
        custody.register(it.id, source, "note", recording, System.currentTimeMillis());
        custody.stopped(it.id);
        it.meetingEvent = meetingEvent == null ? "" : meetingEvent;
        it.source = source == null ? SRC_EVERYWHERE : source;
        if (screenshots != null && !it.dictation()) {
            int n = 0;
            for (byte[] png : screenshots) {
                if (png == null || png.length == 0) continue;
                File f = new File(audioDir, it.id + "-shot" + (++n) + ".png");
                try (FileOutputStream o = new FileOutputStream(f)) { o.write(png); o.getFD().sync(); }
                it.shots.put(f.getAbsolutePath());
            }
        }
        it.createdAt = System.currentTimeMillis();
        it.sessionId = "wizard_" + it.createdAt + "_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        File kept = new File(audioDir, it.id + ai.wizards.os.assist.TakeRecovery.ext(recording.getName()));
        custody.transfer(it.id, kept); // SUPERSEDED_COPY: verified, fsynced duplicate; same take id.
        custody.hand(it.id, "everywhere-outbox");
        it.audioPath = kept.getAbsolutePath();
        synchronized (this) { items.put(it.id, it); save(); }
        changed();
        pump();
        return it;
    }

    public synchronized List<Item> unsent() {
        List<Item> out = new ArrayList<>();
        for (Item it : items.values()) if (!"sent".equals(it.state) && !"empty".equals(it.state)) out.add(it);
        return out;
    }

    public String unsentJson() {
        JSONArray a = new JSONArray();
        try { for (Item it : unsent()) a.put(it.publicJson()); } catch (JSONException ignored) { }
        return a.toString();
    }

    public synchronized Item item(String id) { return items.get(id); }

    /** Derived from the durable outbox, so a service restart/keyboard change cannot drop the lock. */
    public synchronized String floatingProcessingMode() {
        long now = System.currentTimeMillis();
        for (Item it : items.values()) {
            String mode = EverywherePolicy.processingMode(it.source, it.state, it.text,
                    "waiting".equals(it.state) && it.nextAt > now);
            if (!mode.isEmpty()) return mode;
        }
        return "";
    }

    public void retry(String id) {
        synchronized (this) {
            for (Item it : items.values()) {
                if (!("*".equals(id) || it.id.equals(id))) continue;
                if (!"failed".equals(it.state) && !"waiting".equals(it.state)) continue;
                it.state = "waiting"; it.nextAt = 0;
                it.attempts = Math.min(it.attempts, EverywherePolicy.AUTO_TRIES - 1);
            }
            save();
        }
        changed();
        pump();
    }

    public void delete(String id) {
        synchronized (this) {
            Item it = items.remove(id);
            if (it == null) return;
            if (!it.audioPath.isEmpty()) //noinspection ResultOfMethodCallIgnored
                custody.release(it.id, CaptureJournal.Reason.USER_DELETE); // the owner tapped Delete on this unsent message
            deleteShots(it);
            save();
        }
        changed();
    }

    private static void deleteShots(Item it) {
        for (int i = 0; i < it.shots.length(); i++) //noinspection ResultOfMethodCallIgnored
            new File(it.shots.optString(i)).delete();
    }

    /* ------------------------------------------------------------------ delivery */

    /** Run every item that is due; schedules itself for the next one. Safe to call any time. */
    public void pump() { main.removeCallbacks(pumpTask); main.post(pumpTask); }

    private void pumpNow() {
        if (pumping) return;
        final Item next;
        long wait = Long.MAX_VALUE, now = System.currentTimeMillis();
        Item due = null;
        synchronized (this) {
            for (Item it : items.values()) {
                if (!"waiting".equals(it.state)) continue;
                if (it.nextAt <= now) { due = it; break; }
                wait = Math.min(wait, it.nextAt - now);
            }
            if (due != null) { due.state = "sending"; save(); }
        }
        next = due;
        if (next == null) {
            if (wait != Long.MAX_VALUE) main.postDelayed(pumpTask, Math.max(250, wait));
            return;
        }
        pumping = true;
        changed();
        io.execute(() -> {
            int status = -1; String msg = "";
            try { deliver(next); }
            catch (HttpError e) { status = e.status; msg = e.getMessage(); }
            catch (IOException e) { status = 0; msg = e.getMessage(); }
            catch (Exception e) { status = 0; msg = String.valueOf(e); Log.e(TAG, "deliver crashed", e); }
            final int st = status; final String m = msg;
            main.post(() -> {
                pumping = false;
                if (st >= 0) failed(next, st, m);
                pump();
            });
        });
    }

    private void failed(Item it, int status, String msg) {
        boolean gaveUp;
        synchronized (this) {
            it.attempts++;
            it.error = EverywherePolicy.reason(status, msg);
            long d = EverywherePolicy.nextDelay(it.attempts, status);
            gaveUp = d < 0;
            it.state = gaveUp ? "failed" : "waiting";
            it.nextAt = gaveUp ? 0 : System.currentTimeMillis() + d;
            save();
        }
        Log.i(TAG, "attempt " + it.attempts + " failed (" + status + "): " + msg + (gaveUp ? " → not sent" : " → retrying"));
        changed();
        if (gaveUp) {
            meetingNote(it, "event", "failed", "error", it.error);
            if (app != null) EverywhereService.notifyFailed(app, this, it);
            for (Listener l : snapshot()) l.onFailed(it);
        }
    }

    private void deliver(Item it) throws IOException, JSONException {
        File audio = it.audioPath.isEmpty() ? null : new File(it.audioPath);
        // 1. Words.
        if (it.text.isEmpty()) {
            if (audio == null || !audio.isFile()) throw new HttpError(410, "The recording is gone");
            Transcriber.Result t;
            try { t = Transcriber.transcribe(audio, ai.wizards.os.device.AppState.live(origin), it.dictation() ? DICTATION_PROMPT : ai.wizards.os.device.WizardIdentity.voicePrompt(ai.wizards.os.device.WizardIdentity.name(app))); }
            catch (IOException e) { throw asHttp(e); }
            if (t.text.isEmpty()) {
                // Never delete an unheard take: a quiet or misrouted recording stays in Settings → Cancelled recordings.
                boolean kept = ai.wizards.os.recording.CancelledTakes.keepUnheard(dir.getParentFile(), audio, it.source);
                // Compatibility entry point delegates to CaptureJournal.release(null): unheard is not a receipt.
                String why = kept ? "No words heard · recording kept in Settings → Cancelled recordings" : "No speech in that recording";
                synchronized (this) { it.state = "empty"; it.error = why; items.remove(it.id); save(); }
                meetingNote(it, "event", "failed", "error", why);
                Log.i(TAG, "no words in " + it.id + (kept ? " · kept" : " · not kept"));
                // A failed keep leaves the journal and original intact for recovery.
                changed();
                return;
            }
            synchronized (this) { it.text = t.text; save(); }
            meetingNote(it, "text", t.text);
            final String heard = t.text;
            main.post(() -> { for (Listener l : snapshot()) l.onWords(it, heard); });
            changed();
        }
        // "Order my usual kra pao" from an orb or the side button: run that usual on the phone, send nothing.
        if (!it.dictation() && app != null) {
            String usual = ai.wizards.os.usuals.UsualsVoice.match(app, it.text);
            if (usual != null) {
                synchronized (this) {
                    it.state = "sent"; it.sentAt = System.currentTimeMillis(); it.error = "";
                    if (audio != null) //noinspection ResultOfMethodCallIgnored
                        custody.release(it.id, CaptureJournal.Reason.DELIVERED_ON_PHONE); // the local action ran
                    it.audioPath = "";
                    deleteShots(it);
                    items.remove(it.id);
                    save();
                }
                Log.i(TAG, "usual " + usual + " from " + it.source + " " + it.id);
                meetingNote(it, "event", "local", "text", it.text);
                final Context a = app;
                main.post(() -> { changed(); for (Listener l : snapshot()) l.onSent(it); ai.wizards.os.usuals.UsualsVoice.start(a, usual); });
                return;
            }
        }
        // Dictation stops here: the words go into the text field, nothing goes to Wizard.
        if (it.dictation()) {
            final String words = it.text;
            // The meeting marker records what was said even if no field takes it (the listener refines typed/copied).
            meetingNote(it, "event", "local", "kind", "dictation", "text", DictationCleanup.cleanTranscriptForInsertion(words));
            // Keep the item pending through main-thread insertion/clipboard recovery. Removing it on the
            // I/O thread allowed a queued tap to start a second take before the first words were inserted.
            main.post(() -> {
                try {
                    for (Listener l : snapshot()) l.onDictated(it, words);
                } finally {
                    synchronized (EverywhereOutbox.this) {
                        it.state = "sent"; it.sentAt = System.currentTimeMillis(); it.error = "";
                        if (audio != null) //noinspection ResultOfMethodCallIgnored
                            custody.release(it.id, CaptureJournal.Reason.DELIVERED_ON_PHONE); // the words were typed in
                        it.audioPath = "";
                        items.remove(it.id);
                        save();
                    }
                    changed();
                }
                Log.i(TAG, "dictated " + it.id + " chars=" + words.length() + " attempts=" + it.attempts);
            });
            return;
        }
        // 2. The recording rides along as a voice note.
        if (it.audioFile == null && audio != null && audio.isFile()) {
            String name = "wizard-everywhere-" + new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH-mm-ss", java.util.Locale.US).format(new java.util.Date(it.createdAt)) + ai.wizards.os.assist.TakeRecovery.ext(audio.getName());
            JSONObject r = request("POST", "/wizard/files/upload", readAll(new FileInputStream(audio)), "application/octet-stream",
                    new String[]{"X-Wizard-Filename", name, "X-Wizard-Mime", ai.wizards.os.assist.TakeRecovery.mime(audio.getName())});
            JSONObject f = r.optJSONObject("file");
            if (f == null || f.optString("id").isEmpty()) throw new HttpError(502, "Wizard Files returned no id");
            synchronized (this) { it.audioFile = f; save(); }
        }
        // 2b. Screenshots, one upload each; each id is kept as it lands so a retry skips what's already there.
        for (int i = it.shotFiles.length(); i < it.shots.length(); i++) {
            File png = new File(it.shots.optString(i));
            if (!png.isFile()) { synchronized (this) { it.shotFiles.put(JSONObject.NULL); save(); } continue; }
            String name = "wizard-screen-" + new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH-mm-ss", java.util.Locale.US).format(new java.util.Date(it.createdAt)) + "-" + (i + 1) + ".png";
            JSONObject r = request("POST", "/wizard/files/upload", readAll(new FileInputStream(png)), "application/octet-stream",
                    new String[]{"X-Wizard-Filename", name, "X-Wizard-Mime", "image/png"});
            JSONObject f = r.optJSONObject("file");
            if (f == null || f.optString("id").isEmpty()) throw new HttpError(502, "Wizard Files returned no id");
            synchronized (this) { it.shotFiles.put(f); save(); }
        }
        // 3. Its own thread. 409 = an earlier try already created it.
        if (!it.sessionReady) {
            try {
                request("POST", "/wizard/hermes/api/sessions", new JSONObject().put("source", "wizard-mobile").put("id", it.sessionId).toString().getBytes(StandardCharsets.UTF_8), "application/json", null);
            } catch (HttpError e) { if (e.status != 409) throw e; }
            synchronized (this) { it.sessionReady = true; save(); }
        }
        // 4. Admit the run: same key + same bytes on every try → Wizard replays instead of duplicating.
        if (it.body.isEmpty()) {
            JSONObject b = new JSONObject().put("session_id", it.sessionId).put("input", it.text).put("instructions", instructions(it));
            JSONArray ids = new JSONArray();
            if (it.audioFile != null) ids.put(it.audioFile.optString("id"));
            for (int i = 0; i < it.shotFiles.length(); i++) {
                JSONObject f = it.shotFiles.optJSONObject(i);
                if (f != null && !f.optString("id").isEmpty()) ids.put(f.optString("id"));
            }
            if (ids.length() > 0) b.put("wizard_file_ids", ids);
            synchronized (this) { it.body = b.toString(); save(); }
        }
        JSONObject run = request("POST", "/wizard/hermes/v1/runs", it.body.getBytes(StandardCharsets.UTF_8), "application/json",
                new String[]{"Idempotency-Key", it.id});
        synchronized (this) {
            it.state = "sent"; it.sentAt = System.currentTimeMillis(); it.error = "";
            it.runId = run.optString("run_id", run.optString("id", ""));
            if (!it.audioPath.isEmpty() && it.audioFile != null && !it.audioFile.optString("id").isEmpty()) {
                custody.received(it.id, "wizard-file:" + it.audioFile.optString("id"));
                custody.release(it.id, CaptureJournal.Reason.SERVER_RECEIPT);
            }
            it.audioPath = "";
            deleteShots(it);
            pruneSent();
            save();
        }
        Log.i(TAG, "sent " + it.id + " run=" + it.runId + " attempts=" + it.attempts);
        meetingNote(it, "event", "sent", "threadId", it.sessionId, "runId", it.runId, "deliveryKey", it.id,
                "audioFileId", it.audioFile == null ? null : it.audioFile.optString("id", null), "text", it.text);
        main.post(() -> { changed(); for (Listener l : snapshot()) l.onSent(it); });
        if (!it.runId.isEmpty()) watchReply(it);
    }

    /** Sent items are kept (without audio) only for the reply watch; at most the newest 20. */
    private void pruneSent() {
        List<String> sent = new ArrayList<>();
        for (Item x : items.values()) if ("sent".equals(x.state)) sent.add(x.id);
        for (int i = 0; i < sent.size() - 20; i++) items.remove(sent.get(i));
    }

    /** Like Archimedes Anywhere: when the answer is ready, say so (only while the app process lives). */
    private void watchReply(Item it) {
        final long until = System.currentTimeMillis() + 45 * 60_000L;
        final ExecutorService w = Executors.newSingleThreadExecutor();
        w.execute(() -> {
            long delay = 4000;
            try {
                while (System.currentTimeMillis() < until) {
                    Thread.sleep(delay);
                    delay = Math.min(15000, delay + 2000);
                    JSONObject r;
                    try { r = request("GET", "/wizard/hermes/v1/runs/" + URLEncoder.encode(it.runId, "UTF-8"), null, null, null); }
                    catch (IOException e) { continue; }
                    String st = r.optString("status");
                    if ("completed".equals(st) || "failed".equals(st) || "cancelled".equals(st) || "stopped".equals(st)) {
                        String out = "completed".equals(st) ? r.optString("output", "") : "That request " + st + ".";
                        main.post(() -> {
                            if (app != null) EverywhereService.notifyReply(app, it, out);
                            for (Listener l : snapshot()) l.onReply(it, out);
                        });
                        return;
                    }
                }
            } catch (InterruptedException ignored) {
            } finally { w.shutdown(); }
        });
    }

    /* ------------------------------------------------------------------ http */

    private JSONObject request(String method, String path, byte[] body, String type, String[] headers) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(ai.wizards.os.device.AppState.live(origin) + path).openConnection();
        try {
            c.setConnectTimeout(8000);
            c.setReadTimeout(body != null && body.length > 200_000 ? 120_000 : 30_000);
            c.setRequestMethod(method);
            c.setRequestProperty("Origin", origin);
            c.setRequestProperty("Accept", "application/json");
            if (headers != null) for (int i = 0; i + 1 < headers.length; i += 2) c.setRequestProperty(headers[i], headers[i + 1]);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", type);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream os = c.getOutputStream()) { os.write(body); }
            }
            int code = c.getResponseCode();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String resp = is == null ? "" : new String(readAll(is), StandardCharsets.UTF_8);
            if (code < 200 || code >= 300) {
                String m = "";
                try { Object e = new JSONObject(resp).opt("error"); m = e instanceof JSONObject ? ((JSONObject) e).optString("message") : String.valueOf(e == null ? "" : e); } catch (JSONException ignored) { }
                throw new HttpError(code, m);
            }
            try { return resp.isEmpty() ? new JSONObject() : new JSONObject(resp); }
            catch (JSONException e) { return new JSONObject(); }
        } catch (HttpError e) {
            throw e;
        } catch (IOException e) {
            throw new HttpError(0, "Couldn’t reach Wizard");
        } finally {
            c.disconnect();
        }
    }

    private static HttpError asHttp(IOException e) {
        if (e instanceof HttpError) return (HttpError) e;
        String m = String.valueOf(e.getMessage());
        java.util.regex.Matcher x = java.util.regex.Pattern.compile("returned (\\d{3})").matcher(m);
        return new HttpError(x.find() ? Integer.parseInt(x.group(1)) : 0, "Couldn’t reach Wizard voice");
    }

    /** Notes on the Mizel meeting marker for a take that borrowed the meeting's mic (no-op otherwise). */
    void meetingNote(Item it, Object... kv) {
        if (app == null || it == null || it.meetingEvent == null || it.meetingEvent.isEmpty()) return;
        ai.wizards.os.mizel.MeetingLoans.note(app, it.meetingEvent, ai.wizards.os.mizel.MeetingLoans.obj(kv));
    }

    /* ------------------------------------------------------------------ util */

    private List<Listener> snapshot() { synchronized (listeners) { return new ArrayList<>(listeners); } }

    private void changed() {
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post(this::changed); return; }
        for (Listener l : snapshot()) l.onOutboxChanged();
    }

    static byte[] readAll(InputStream in) throws IOException {
        try (InputStream i = in) { ByteArrayOutputStream o = new ByteArrayOutputStream(); copy(i, o); return o.toByteArray(); }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] b = new byte[16384]; int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
    }
}
