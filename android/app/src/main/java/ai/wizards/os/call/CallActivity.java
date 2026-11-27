package ai.wizards.os.call;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

/**
 * A call window (wizard-messenger issue 445, Messenger switch `calls`, off by default). Messenger starts a call on
 * the owner's own Wizard (its LiveKit and Element Call) and asks WizardOS to open the call page here, through
 * WizardOSNative.openCall. App frames in the shell may use the microphone only, so the call gets this window of its
 * own: camera and microphone for this Wizard's own call page (never another site), the screen kept on, and the call's
 * sound routed by {@link CallAudio} to the earpiece, the speaker or a headset as Element Call picks. Back or Element
 * Call's own hang-up ends it. Nothing here runs unless Messenger asks for a call.
 */
public final class CallActivity extends Activity {
    public static final String EXTRA_URL = "ai.wizards.os.call.URL";
    private static final int REQ_MEDIA = 4450;
    /** Element Call's host hooks (controls.ts): its pick of output comes back to {@link Js#select}. */
    private static final String SHIM = "(function(){var c=window.controls;if(!c||c.__wizardCall)return;c.__wizardCall=true;"
            + "var s=function(id){try{WizardCallAudio.select(String(id))}catch(e){}};c.onAudioDeviceSelect=s;c.onOutputDeviceSelect=s;})();";

    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private CallAudio audio;
    private PermissionRequest pending;
    private String origin;
    private boolean picked;
    private int pushes;

    /** Only a page of this Wizard (its own origin, http or https) may become a call window. */
    public static boolean allowed(String primaryOrigin, String url) {
        if (url == null || primaryOrigin == null || primaryOrigin.isEmpty()) return false;
        try {
            String s = new URI(url).getScheme();
            if (!"https".equals(s) && !"http".equals(s)) return false;
        } catch (Exception e) { return false; }
        return ai.wizards.os.ServerOrigin.matches(primaryOrigin, url);
    }

    /** Opens the call page in a call window. False when the address is not this Wizard's own. */
    public static boolean open(Context c, String url) {
        if (!allowed(ai.wizards.os.device.AppState.primaryOrigin(c), url)) return false;
        Intent i = new Intent(c, CallActivity.class).putExtra(EXTRA_URL, url);
        if (!(c instanceof Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
        return true;
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        String url = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_URL);
        String primary = ai.wizards.os.device.AppState.primaryOrigin(this);
        if (!allowed(primary, url)) { finish(); return; }
        Uri u = Uri.parse(url);
        origin = u.getScheme() + "://" + u.getEncodedAuthority();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_VOICE_CALL);
        audio = new CallAudio(this, () -> main.post(this::pushDevices));
        audio.start();

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(5, 3, 12));
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " WizardOS-Call");
        web.addJavascriptInterface(new Js(), "WizardCallAudio");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String to = req.getUrl().toString();
                if (allowed(primary, to)) return false; // the call's own pages stay here
                if (req.isForMainFrame()) outside(req.getUrl());
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String loaded) {
                pushes = 0;
                pushDevices();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) { runOnUiThread(() -> media(request)); }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) { if (pending == request) pending = null; }
        });
        web.loadUrl(url);
    }

    /** Another call while this window is open: this window takes the new call. */
    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        String url = i == null ? null : i.getStringExtra(EXTRA_URL);
        if (web == null || !allowed(ai.wizards.os.device.AppState.primaryOrigin(this), url)) return;
        setIntent(i);
        picked = false;
        web.loadUrl(url);
    }

    /** A link out of the call (Element Call's help pages): the phone's browser, never this window. */
    private void outside(Uri u) {
        if (!"https".equals(u.getScheme()) && !"http".equals(u.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException ignored) { }
    }

    static boolean sameOrigin(String origin, Uri asked) {
        if (origin == null || asked == null) return false;
        return ai.wizards.os.ServerOrigin.matches(origin, asked.toString());
    }

    /** The call page asks for the microphone and/or camera: only this Wizard's call page, after Android's own prompt. */
    private void media(PermissionRequest r) {
        if (isFinishing() || !sameOrigin(origin, r.getOrigin())) { r.deny(); return; }
        List<String> need = new ArrayList<>();
        for (String res : r.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && !held(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && !held(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
        }
        if (need.isEmpty()) { grant(r); return; }
        if (pending != null) pending.deny();
        pending = r;
        requestPermissions(need.toArray(new String[0]), REQ_MEDIA);
    }

    private boolean held(String p) { return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }

    /** Grants what Android allows (a call without the camera still has sound); nothing allowed denies. */
    private void grant(PermissionRequest r) {
        List<String> ok = new ArrayList<>();
        for (String res : r.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && held(Manifest.permission.RECORD_AUDIO)) ok.add(res);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && held(Manifest.permission.CAMERA)) ok.add(res);
        }
        if (ok.isEmpty()) r.deny(); else r.grant(ok.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_MEDIA) return;
        PermissionRequest r = pending;
        pending = null;
        if (r != null) grant(r);
    }

    /** Hands Element Call the current outputs. Its list listener starts with the call, so the first list is repeated
     *  until it has picked one (at most a minute); after that only a change (a headset in or out) sends it again. */
    private void pushDevices() {
        if (web == null || audio == null) return;
        String list = CallAudio.json(CallAudio.usable(audio.outputs()));
        web.evaluateJavascript(SHIM + "try{window.controls&&window.controls.setAvailableAudioDevices(" + list + ")}catch(e){}", null);
        if (!picked && ++pushes < 40) main.postDelayed(this::repush, 1500);
    }

    private void repush() { if (!picked) pushDevices(); }

    private final class Js {
        @JavascriptInterface public void select(String id) {
            main.post(() -> { if (audio != null && audio.select(id)) picked = true; });
        }
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (pending != null) { pending.deny(); pending = null; }
        if (audio != null) audio.stop();
        audio = null;
        if (web != null) { web.stopLoading(); web.loadUrl("about:blank"); web.destroy(); web = null; }
        super.onDestroy();
    }
}
