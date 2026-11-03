package ai.wizards.os.device;

import ai.wizards.os.audio.CaptureJournal;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.List;

import ai.wizards.os.notify.ReplyWatcher;
import ai.wizards.os.recording.RecorderService;
import ai.wizards.os.recording.CancelledTakes;
import ai.wizards.os.recording.RecordingStore;
import ai.wizards.os.share.ShareStore;
import ai.wizards.os.update.Updater;

/**
 * The native-parity features the shell reaches as window.WizardOSDevice (background recorder, share target, reply
 * notifications, in-app update). Not a JavaScript interface: the page facade (web/core/native-shell-port.js) calls
 * {@link #call} through the main-frame-checked window.wizardShellPort, by the exact names in ShellPortPolicy.
 * Native → web events go to window.WosDevice.event(type, json) (web/device.js), over the same port when bound.
 */
public final class DeviceBridge implements RecorderService.Listener {
    static final String TAG = "WizardDevice";
    public static final String ACTION_SHARE = "ai.wizards.os.action.SHARE";
    public static final String ACTION_RECOVER = "ai.wizards.os.action.RECOVER";
    public static final String EXTRA_SHARE = "ai.wizards.os.extra.SHARE";
    private static final int REQ_NOTIFY = 61;
    private static final int CHUNK = 384 * 1024; // raw bytes per read (≈512 KB base64)

    private final Activity activity;
    private final WebView web;
    private final ai.wizards.os.identity.WizardId wizardId;
    private long identityDocument;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String pending; // JSON for WosDevice.handle once the page is ready
    private int tries;

    public DeviceBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        wizardId = new ai.wizards.os.identity.WizardId((androidx.fragment.app.FragmentActivity)activity);
        if (!(activity instanceof ai.wizards.os.AppSessionActivity)) {
            RecorderService.setListener(this);
            Updater.attach(activity, this);
        }
        new Thread(() -> ShareStore.get(activity).prune(), "wizard-share-prune").start();
    }

    /** Called by the existing origin-scoped wizardDevicePort dispatcher, never a second JS interface. */
    public boolean dispatchIdentity(String method, JSONObject params, java.util.function.Consumer<JSONObject> reply,
            java.util.function.BooleanSupplier trusted) {
        if (!java.util.Arrays.asList("identity.info", "identity.setup", "identity.sign", "identity.nip44_encrypt", "identity.nip44_decrypt", "view.capture").contains(method)) return false;
        long document = identityDocument;
        java.util.function.Consumer<JSONObject> answer = result -> {
            if (document == identityDocument && trusted.getAsBoolean()) reply.accept(result);
        };
        if (!trusted.getAsBoolean()) return true;
        if ("identity.info".equals(method)) { answer.accept(wizardId.info()); return true; }
        if ("view.capture".equals(method)) { answer.accept(captureView(params)); return true; }
        // Appearance-only values: never used for the sentence, event, signer or key.
        web.evaluateJavascript(ai.wizards.os.WizardLook.READ_JS, encoded -> {
            if (document != identityDocument || !trusted.getAsBoolean()) return;
            ai.wizards.os.WizardLook.save(activity, encoded);
            wizardId.colors(ai.wizards.os.WizardLook.identityColors(activity));
            if ("identity.setup".equals(method)) wizardId.setup(answer);
            else if ("identity.nip44_encrypt".equals(method) || "identity.nip44_decrypt".equals(method)) wizardId.nip44(params, "identity.nip44_encrypt".equals(method), params.optString("requester"), answer);
            else { JSONObject event = params.optJSONObject("event"); if (event == null) answer.accept(denied()); else wizardId.sign(event, params.optString("requester"), answer); }
        });
        return true;
    }
    public void onPageStarted() { identityDocument++; wizardId.cancel(); }
    private static JSONObject denied() {
        try { return new JSONObject().put("denied",true); } catch (Exception e) { return new JSONObject(); }
    }
    @SuppressWarnings("deprecation")
    private JSONObject captureView(JSONObject params) {
        android.graphics.Bitmap bitmap = null;
        try {
            int x=0,y=0,w=web.getWidth(),h=web.getHeight();
            if (params.has("rect")) {
                JSONObject rect = params.getJSONObject("rect"); float scale = web.getScale();
                double left=rect.getDouble("x"),top=rect.getDouble("y"),width=rect.getDouble("width"),height=rect.getDouble("height");
                if (!Double.isFinite(left+top+width+height) || left<0 || top<0 || width<=0 || height<=0 ||
                        (left+width)*scale>w || (top+height)*scale>h) return denied();
                x=(int)Math.floor(left*scale); y=(int)Math.floor(top*scale);
                w=(int)Math.ceil(width*scale); h=(int)Math.ceil(height*scale);
            }
            if (w<=0 || h<=0 || x+w>web.getWidth() || y+h>web.getHeight() || w>2048 || h>2048 || (long)w*h>4_000_000) return denied();
            bitmap = android.graphics.Bitmap.createBitmap(w,h,android.graphics.Bitmap.Config.ARGB_8888);
            android.graphics.Canvas canvas = new android.graphics.Canvas(bitmap); canvas.translate(-x,-y); web.draw(canvas);
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            if (!bitmap.compress(android.graphics.Bitmap.CompressFormat.WEBP,85,bytes)) return denied();
            return new JSONObject().put("webp_b64",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP)).put("width",w).put("height",h);
        } catch (Exception e) { return denied(); }
        finally { if (bitmap != null) bitmap.recycle(); }
    }

    /* ------------------------------------------------------------------ MainActivity hooks */

    /** Share sheet and "recording saved" notification taps. */
    public void onIntent(Intent intent) {
        if (intent == null) return;
        Updater.onIntent(activity, intent); // "Update ready · tap to install" notification
        String a = intent.getAction();
        String json = null;
        if (ACTION_SHARE.equals(a) && intent.getStringExtra(EXTRA_SHARE) != null) {
            json = obj("action", "share", "id", intent.getStringExtra(EXTRA_SHARE));
        } else if (ACTION_RECOVER.equals(a)) {
            RecorderService.clearSavedNotice(activity);
            json = obj("action", "recover");
        }
        if (json == null) return;
        intent.setAction(Intent.ACTION_MAIN); // once, not again on rotation/restore
        pending = json;
        tries = 0;
        main.removeCallbacks(deliver);
        main.post(deliver);
    }

    private final Runnable deliver = new Runnable() {
        @Override public void run() {
            if (pending == null) return;
            final String json = pending;
            web.evaluateJavascript("(window.WosDevice && window.WosDevice.ready ? window.WosDevice.handle(" + json + ") : false)", r -> {
                if ("true".equals(r)) { if (json.equals(pending)) pending = null; return; }
                if (++tries < 60) main.postDelayed(this, 300);
                else pending = null;
            });
        }
    };

    public void onStart() { AppState.setFront(activity,true); ReplyWatcher.appFront(activity); }
    public void onStop() { AppState.setFront(activity,false); if (!AppState.front()) ReplyWatcher.kick(activity); if (!(activity instanceof ai.wizards.os.AppSessionActivity)) Updater.onStop(activity); }
    public void onResume() { if (!(activity instanceof ai.wizards.os.AppSessionActivity)) Updater.onResume(activity); WizardIdentity.refresh(activity); }
    public void onDestroy() {
        onPageStarted();
        // A take still running (app swiped away) carries on; its notification's Stop/Send take over from here.
        AppState.setFront(activity,false);
        if (!(activity instanceof ai.wizards.os.AppSessionActivity)) { RecorderService.setListener(null); Updater.detach(activity); }
    }

    /* ------------------------------------------------------------------ events to the page */

    /** Set by MainActivity: delivers a page hook over the bound shell port (after fresh state); false = not bound. */
    public interface Hook { boolean run(String name, String argJson); }
    private Hook hook;
    public void setHook(Hook h) { hook = h; }

    public void emit(String type, String json) {
        main.post(() -> {
            String arg;
            try { arg = new org.json.JSONArray().put(type).put(new JSONObject(json)).toString(); } catch (JSONException e) { arg = null; }
            if (arg != null && hook != null && hook.run("WosDevice.event", arg)) return;
            web.evaluateJavascript("(window.WosDevice && window.WosDevice.event(" + ai.wizards.os.device.Json.quote(type) + "," + json + "))", null);
        });
    }

    /* ------------------------------------------------------------------ shell port dispatch */

    /** The reviewed WizardOSDevice command set (ShellPortPolicy.deviceMethods), by exact name: no reflection. */
    public Object call(String method, org.json.JSONArray a) {
        switch (method) {
            case "version": return version();
            case "recHandoffVersion": return recHandoffVersion();
            case "recHandoffBegin": return recHandoffBegin(s(a, 0), s(a, 1));
            case "recStartBorrowed": return recStartBorrowed(s(a, 0), s(a, 1));
            case "recHandoffEnd": return recHandoffEnd(s(a, 0));
            case "recHandoffEvents": return recHandoffEvents();
            case "recStart": return recStart(s(a, 0));
            case "recPause": recPause(a.optBoolean(0)); return null;
            case "recLevel": return recLevel();
            case "micRoute": return micRoute();
            case "micPolicy": return micPolicy();
            case "setMicPolicy": return setMicPolicy(s(a, 0));
            case "recActive": return recActive();
            case "recStop": return recStop(s(a, 0));
            case "recCancel": recCancel(s(a, 0)); return null;
            case "recClaim": return recClaim(s(a, 0));
            case "recRead": return recRead(s(a, 0), a.optInt(1));
            case "captureJournal": return captureJournal();
            case "recDone": recDone(s(a, 0)); return null;
            case "recPending": return recPending();
            case "cancelledList": return cancelledList();
            case "cancelledRead": return cancelledRead(s(a, 0), a.optInt(1));
            case "cancelledDelete": cancelledDelete(s(a, 0)); return null;
            case "clip": return clip(s(a, 0));
            case "shareMeta": return shareMeta(s(a, 0));
            case "shareRead": return shareRead(s(a, 0), a.optInt(1), a.optInt(2));
            case "shareDone": shareDone(s(a, 0)); return null;
            case "watchRun": watchRun(s(a, 0), s(a, 1), s(a, 2)); return null;
            case "replyNotes": return replyNotes();
            case "clearThread": return clearThread(s(a, 0));
            case "notifications": return notifications();
            case "updateCheck": updateCheck(); return null;
            case "updateInstall": updateInstall(); return null;
            case "updateState": return updateState();
            default: throw new IllegalArgumentException("unknown method");
        }
    }

    private static String s(org.json.JSONArray a, int i) { Object o = a.opt(i); return o instanceof String ? (String) o : null; }

    /** Cached reads for the facade's synchronous getters. {@code full=false}: the ~100 ms recording tick only. */
    public void state(JSONObject out, boolean full) throws JSONException {
        out.put("recActive", recActive()).put("recLevel", recLevel());
        if (!full) return;
        out.put("version", version()).put("recHandoffVersion", recHandoffVersion())
           .put("micPolicy", micPolicy()).put("captureJournal", captureJournal()).put("recPending", recPending())
           .put("cancelledList", cancelledList()).put("recHandoffEvents", recHandoffEvents()).put("replyNotes", replyNotes())
           .put("notifications", notifications()).put("updateState", updateState());
    }

    public boolean recording() { return RecorderService.active() != null; }

    @Override
    public void onRecorderEvent(String type, String id) {
        emit("rec", obj("type", type, "id", id));
    }

    /* ------------------------------------------------------------------ JS API */

    public int version() { return 1; }

    /** Additive capability: older APKs keep refusing meeting/orb competition. */
    public int recHandoffVersion() { return 1; }

    public String recHandoffBegin(String eventId, String meetingId) {
        return ai.wizards.os.mizel.MeetingRecorderService.beginBorrow(eventId, meetingId);
    }

    public String recStartBorrowed(String kind, String eventId) {
        return RecorderService.start(activity, kind, eventId);
    }

    public String recHandoffEnd(String eventId) {
        return ai.wizards.os.mizel.MeetingRecorderService.endBorrow(eventId, "cancelled");
    }

    public String recHandoffEvents() {
        return new JSONObject(activity.getSharedPreferences("meeting-handoffs-v1", Context.MODE_PRIVATE).getAll()).toString();
    }

    /* --- recorder --- */

    public String recStart(String kind) {
        askNotifications();
        String id = RecorderService.start(activity, kind);
        Log.i(TAG, "recStart " + kind + " -> " + id);
        return id;
    }

    public void recPause(boolean on) { RecorderService.pause(activity, on); }

    public int recLevel() { return RecorderService.level(); }

    /**
     * The route of the page's own browser recording: "builtin", "external", "system" or "unknown". The page calls it
     * right after getUserMedia and stops a take Android has put on a Bluetooth or external mic.
     */
    public String micRoute() { return ai.wizards.os.audio.MicRoute.browserVerdict(activity); }

    /**
     * Settings → Microphone: {"v":1,"policy":{…},"inputs":[{type,name,address}…]}. The policy shape is documented on
     * {@link ai.wizards.os.audio.MicPolicy}; the page can offer new choices (per-device order) without a native update.
     */
    public String micPolicy() { return ai.wizards.os.audio.MicRoute.settingsJson(activity); }

    /** Saves a microphone policy from Settings. Returns the policy actually stored (the default for bad input). */
    public String setMicPolicy(String json) { return ai.wizards.os.audio.MicPolicy.save(activity, json).json(); }

    public String recActive() {
        String id = RecorderService.active();
        if (id == null) return "null";
        try {
            JSONObject metadata = RecordingStore.get(activity).read(id); // Read only: never claim/delete to discover ownership.
            return new JSONObject().put("id", id).put("kind", metadata == null ? JSONObject.NULL : metadata.opt("kind"))
                    .put("ms", RecorderService.elapsedMs()).put("paused", RecorderService.isPaused())
                    .put("source", RecorderService.source()).toString();
        } catch (JSONException e) { return "null"; }
    }

    /** Stops the take (blocking this bridge thread until the file is closed) and claims it for the page. */
    public String recStop(String id) {
        RecorderService.stopNow(id, "app");
        return claim(id);
    }

    public void recCancel(String id) { RecorderService.cancel(activity, id); }

    /** Claims a stopped/recovered take for this page and describes it. */
    public String recClaim(String id) { return claim(id); }

    private String claim(String id) {
        RecordingStore st = RecordingStore.get(activity);
        JSONObject o = st.read(id);
        if (o == null) return "null";
        st.claim(id);
        File a = st.audio(id);
        try { return o.put("bytes", a.length()).put("mime", RecordingStore.MIME).toString(); }
        catch (JSONException e) { return "null"; }
    }

    public String recRead(String id, int offset) { return readChunk(RecordingStore.get(activity).audio(id), offset); }

    /** Read-only native custody status; excludes paths and private receipt payloads. */
    public String captureJournal() { return CaptureJournal.get(activity).status(); }

    /** The page has the take safe in its durable outbox: release native custody (WEB_OUTBOX_CUSTODY), end the hold. */
    public void recDone(String id) {
        RecordingStore.get(activity).delete(id);
        RecorderService.done(id);
        Log.i(TAG, "recDone " + id);
    }

    /** Takes waiting for a home: stopped from the notification, or cut short by an app kill. */
    public String recPending() {
        List<JSONObject> l = RecordingStore.get(activity).pending(RecorderService.active());
        return RecordingStore.json(l);
    }

    /* --- cancelled recordings (Settings → Cancelled recordings) --- */

    /** Long takes that were cancelled, newest first: [{id, at, ms, source, mime, bytes}]. */
    public String cancelledList() { return CancelledTakes.listJson(activity); }

    public String cancelledRead(String id, int offset) { return readChunk(CancelledTakes.audio(activity, String.valueOf(id)), offset); }

    public void cancelledDelete(String id) { CancelledTakes.delete(activity, String.valueOf(id)); }

    /** Put text on the clipboard natively (the page's async clipboard needs a fresh tap, and transcribing takes seconds). */
    public boolean clip(String text) {
        final String t = String.valueOf(text);
        activity.runOnUiThread(() -> {
            try {
                android.content.ClipboardManager cm = activity.getSystemService(android.content.ClipboardManager.class);
                cm.setPrimaryClip(android.content.ClipData.newPlainText("Wizard", t));
            } catch (RuntimeException e) { Log.w(TAG, "clip: " + e); }
        });
        return true;
    }

    /* --- share --- */

    public String shareMeta(String id) {
        String m = ShareStore.get(activity).meta(id);
        return m == null ? "null" : m;
    }

    public String shareRead(String id, int n, int offset) { return readChunk(ShareStore.get(activity).item(id, n), offset); }

    public void shareDone(String id) { ShareStore.get(activity).delete(id); }

    /* --- reply notifications --- */

    /** A message James sent from Wizard OS was accepted: tell him when the reply is ready if he has left the app. */
    public void watchRun(String sessionId, String runId, String title) {
        askNotifications();
        ReplyWatcher.watch(activity, sessionId, runId, title);
    }

    /** Reply notifications on the shade, so the page can clear the ones for threads James has since read. */
    public String replyNotes() { return ReplyWatcher.active(activity); }

    /** James read this thread in Wizard: remove its notifications even though he didn't open it from them. */
    public int clearThread(String sessionId) { return ReplyWatcher.clearThread(activity, sessionId); }

    public String notifications() {
        boolean ok = Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        return obj("allowed", String.valueOf(ok), "watching", String.valueOf(ReplyWatcher.count(activity)));
    }

    /* --- update --- */

    public void updateCheck() { Updater.check(activity); }

    public void updateInstall() { Updater.install(activity); }

    public String updateState() { return Updater.state(); }

    /* ------------------------------------------------------------------ helpers */

    private void askNotifications() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        android.content.SharedPreferences p = activity.getSharedPreferences("device", Activity.MODE_PRIVATE);
        if (p.getBoolean("askedNotify", false)) return;
        p.edit().putBoolean("askedNotify", true).apply();
        main.post(() -> activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY));
    }

    /** {"b64": chunk, "next": offset or -1, "size": total}. */
    private static String readChunk(File f, int offset) {
        if (!f.isFile() || offset < 0) return "null";
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            long size = r.length();
            if (offset > size) return "null";
            int n = (int) Math.min(CHUNK, size - offset);
            byte[] b = new byte[n];
            r.seek(offset);
            r.readFully(b);
            long next = offset + n >= size ? -1 : offset + n;
            return new JSONObject().put("b64", Base64.encodeToString(b, Base64.NO_WRAP)).put("next", next).put("size", size).toString();
        } catch (IOException | JSONException e) {
            Log.w(TAG, "read: " + e);
            return "null";
        }
    }

    static String obj(String... kv) {
        StringBuilder b = new StringBuilder("{");
        for (int i = 0; i + 1 < kv.length; i += 2) {
            if (i > 0) b.append(',');
            b.append(Json.quote(kv[i])).append(':');
            String v = kv[i + 1];
            b.append("true".equals(v) || "false".equals(v) || (v != null && v.matches("-?\\d{1,15}")) ? v : Json.quote(v == null ? "" : v));
        }
        return b.append('}').toString();
    }
}
