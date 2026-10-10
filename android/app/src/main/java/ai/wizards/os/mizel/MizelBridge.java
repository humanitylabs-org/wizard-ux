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
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * window.wizardMizelPort for pages (and iframes) on https://private.wizard001.com only. AndroidX
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

    private MizelBridge(Context app) { this.app = app; }

    /** Installs the port on {@code web}; returns the bridge (remove it with {@link #detach}) or null if unsupported. */
    public static MizelBridge install(WebView web, String origin) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.w(MizelHub.TAG, "WebView lacks WEB_MESSAGE_LISTENER: no meeting bridge");
            return null;
        }
        MizelBridge b = new MizelBridge(web.getContext().getApplicationContext());
        try {
            java.util.Set<String> allow = new java.util.HashSet<>(Collections.singleton(origin));
            if (MizelConfig.DEFAULT_ORIGIN.equals(origin)) allow.add(ai.wizards.os.device.AppState.LEGACY_ORIGIN);
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
        frames.clear();
    }

    private void onMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply) {
        // Belt and braces: the allow-list already guarantees this.
        String src = sourceOrigin == null ? null : sourceOrigin.getScheme() + "://" + sourceOrigin.getAuthority();
        if (src == null || !(MizelConfig.DEFAULT_ORIGIN.equals(src) || ai.wizards.os.device.AppState.LEGACY_ORIGIN.equals(src))) return;
        frames.remove(reply);
        frames.add(reply);
        while (frames.size() > MAX_FRAMES) frames.remove(frames.iterator().next());
        String data = message == null ? null : message.getData();
        MizelProtocol.Cmd c = MizelProtocol.parse(data);
        Log.i(MizelHub.TAG, "page " + (isMainFrame ? "main" : "frame") + " → " + c.cmd + (c.meetingId != null ? " " + c.meetingId : "") + (c.error != null ? " (" + c.error + ")" : ""));
        MizelHub.command(app, c, r -> post(reply, r));
    }

    @Override
    public void onPush(String json) {
        List<JavaScriptReplyProxy> to = new ArrayList<>(frames);
        for (JavaScriptReplyProxy p : to) post(p, json);
    }

    private void post(JavaScriptReplyProxy p, String json) {
        try { p.postMessage(json); }
        catch (RuntimeException e) { frames.remove(p); }
    }

    /** For a status line in logs/QA. */
    public Set<JavaScriptReplyProxy> frames() { return frames; }
}
