package ai.wizards.os.mizel;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * window.wizardMizelPort for pages (and iframes) on this Wizard's own origin only (device/WizardAddress). AndroidX
 * addWebMessageListener injects the object solely into frames whose origin matches the allow-list, so a page on any
 * other origin never sees it. The page sends JSON command strings; replies and pushes come back on the same port.
 * Pages never pass URLs or tokens: native holds the base URL. Protocol: android/MIZEL_RECORDER.md.
 */
public final class MizelBridge implements MizelHub.Listener {
    public static final String NAME = "wizardMizelPort";
    private static final int MAX_FRAMES = 8;

    private final Context app;
    /** Frames that have spoken to us since they loaded; the same proxy object stands for one frame. */
    private final LinkedHashSet<JavaScriptReplyProxy> frames = new LinkedHashSet<>();
    private final java.util.Map<JavaScriptReplyProxy, String> pcmFrames = new java.util.HashMap<>();
    private boolean foreground;
    public void setPcmForeground(boolean on) { foreground = on; syncPcm(); }
    private void syncPcm() { MizelHub.wantPcm(this, foreground && !pcmFrames.isEmpty()); }

    private MizelBridge(Context app) { this.app = app; }

    /** Installs the port on {@code web}; returns the bridge (remove it with {@link #detach}) or null if unsupported. */
    public static MizelBridge install(WebView web, String origin) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.w(MizelHub.TAG, "WebView lacks WEB_MESSAGE_LISTENER: no meeting bridge");
            return null;
        }
        MizelBridge b = new MizelBridge(web.getContext().getApplicationContext());
        try {
            java.util.Set<String> allow = ai.wizards.os.device.WizardAddress.listenerOrigins(origin);
            if (allow.isEmpty()) return null; // not connected to a Wizard yet
            WebViewCompat.addWebMessageListener(web, NAME, allow, b::onMessage);
        } catch (RuntimeException e) {
            Log.w(MizelHub.TAG, "addWebMessageListener failed: no meeting bridge", e);
            return null;
        }
        MizelHub.addListener(b);
        Log.i(MizelHub.TAG, "meeting bridge installed for " + origin);
        return b;
    }

    public void detach() {
        MizelHub.removeListener(this);
        frames.clear(); pcmFrames.clear(); syncPcm();
    }

    private void onMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply) {
        // Belt and braces: the allow-list already guarantees this.
        String src = sourceOrigin == null ? null : sourceOrigin.getScheme() + "://" + sourceOrigin.getAuthority();
        if (src == null || !ai.wizards.os.device.WizardAddress.isTrustedOrigin(src)) return;
        frames.remove(reply);
        frames.add(reply);
        while (frames.size() > MAX_FRAMES) { JavaScriptReplyProxy old = frames.iterator().next(); frames.remove(old); pcmFrames.remove(old); }
        syncPcm();
        String data = message == null ? null : message.getData();
        MizelProtocol.Cmd c = MizelProtocol.parse(data);
        Log.i(MizelHub.TAG, "page " + (isMainFrame ? "main" : "frame") + " → " + c.cmd + (c.meetingId != null ? " " + c.meetingId : "") + (c.error != null ? " (" + c.error + ")" : ""));
        if (MizelProtocol.PCM.equals(c.cmd) && c.error == null) {
            MeetingRecorderService.Live live = MeetingRecorderService.live();
            if (c.enabled && (live == null || !c.meetingId.equals(live.meetingId))) {
                post(reply, MizelProtocol.reply(c.id, false, MizelProtocol.E_WRONG_MEETING, MizelHub.state(app))); return;
            }
            if (c.enabled) pcmFrames.put(reply, c.meetingId); else pcmFrames.remove(reply);
            syncPcm(); post(reply, MizelProtocol.reply(c.id, true, null, MizelHub.state(app))); return;
        }
        MizelHub.command(app, c, r -> post(reply, r));
    }

    @Override
    public void onPush(String json) {
        try {
            org.json.JSONObject data = new org.json.JSONObject(json);
            if ("state".equals(data.optString("type")) && !data.optBoolean("recording")) { pcmFrames.clear(); syncPcm(); }
            if ("pcm".equals(data.optString("type"))) {
                if (!foreground) return;
                String mid = data.optString("meetingId");
                for (JavaScriptReplyProxy p : new ArrayList<>(pcmFrames.keySet())) if (mid.equals(pcmFrames.get(p))) post(p, json);
                return;
            }
        } catch (org.json.JSONException ignored) { return; }
        List<JavaScriptReplyProxy> to = new ArrayList<>(frames);
        for (JavaScriptReplyProxy p : to) post(p, json);
    }

    private void post(JavaScriptReplyProxy p, String json) {
        try { p.postMessage(json); }
        catch (RuntimeException e) { frames.remove(p); pcmFrames.remove(p); syncPcm(); }
    }

    /** For a status line in logs/QA. */
    public Set<JavaScriptReplyProxy> frames() { return frames; }
}
