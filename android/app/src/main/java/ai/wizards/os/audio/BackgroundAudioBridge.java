package ai.wizards.os.audio;

import android.app.Activity;
import android.content.ComponentName;
import android.net.Uri;
import android.webkit.WebView;
import androidx.webkit.*;
import androidx.media3.session.*;
import com.google.common.util.concurrent.ListenableFuture;
import org.json.*;
import java.util.*;
import ai.wizards.os.device.AppState;

/** Main-frame origin-bound port. Hosted apps reach it only through the registered-frame relay. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class BackgroundAudioBridge {
    private final Activity activity;
    private final WebView web;
    private ListenableFuture<MediaController> controller;
    private boolean detached;
    private int pending;
    /** How long a request may wait for the phone player before it is answered with an error. */
    static final long CONNECT_TIMEOUT_MS=5000;
    private final android.os.Handler ui=new android.os.Handler(android.os.Looper.getMainLooper());
    private BackgroundAudioBridge(Activity a,WebView w) { activity=a; web=w; }
    public static BackgroundAudioBridge install(Activity a,WebView w) {
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return null;
        BackgroundAudioBridge b=new BackgroundAudioBridge(a,w);
        Set<String> origins=new HashSet<>(); origins.add(AppState.primaryOrigin(a));
        if(ai.wizards.os.BuildConfig.DEBUG) origins.add(AppState.origin(a));
        WebViewCompat.addWebMessageListener(w,"wizardAudioPort",origins,b::message); return b;
    }
    public void detach() { detached=true; if(controller!=null) MediaController.releaseFuture(controller); controller=null; }
    /** Every request gets an answer, also a refusal, so the app never waits on silence (wizard-music#115). */
    private void message(WebView view,WebMessageCompat raw,Uri source,boolean main,JavaScriptReplyProxy reply) {
        String id="";
        try {
            String value=raw.getData();
            JSONObject r=value==null || value.length()>250000 ? null : new JSONObject(value);
            if(r!=null) id=r.optString("id");
            String origin=AppState.origin(activity);
            if(r==null || detached || !main || source==null || !origin.equals(source.toString()) || !AudioPolicy.shell(web.getUrl(),origin)) { answer(reply,id,null,"Audio request refused"); return; }
            String method=r.optString("method");
            final String app=r.optString("appId"), rid=id;
            if(!AudioPolicy.METHODS.contains(method) || r.optInt("v")!=1 || !AudioPolicy.admitted(app)) { answer(reply,id,null,"Unknown audio capability"); return; }
            if("capabilities".equals(method)) { answer(reply,id,new JSONObject().put("v",1).put("backgroundAudio",true).put("methods",new JSONArray(AudioPolicy.METHODS)).put("apps",new JSONArray(new TreeSet<>(AudioPolicy.APPS))).put("skip",true),null); return; }
            if("detach".equals(method) && BackgroundAudioService.current()==null) { answer(reply,id,new JSONObject(),null); return; }
            if(pending>=16) { answer(reply,id,null,"Audio busy"); return; }
            pending++;
            if(controller==null) controller=new MediaController.Builder(activity,new SessionToken(activity,new ComponentName(activity,BackgroundAudioService.class)))
                .setListener(new MediaController.Listener() {
                    @Override public void onDisconnected(MediaController c) {
                        try {
                            if(controller!=null && controller.isDone() && controller.get()==c) { MediaController.releaseFuture(controller); controller=null; }
                        } catch(Exception ignored) { controller=null; }
                    }
                }).buildAsync();
            final ListenableFuture<MediaController> connected=controller;
            final boolean[] done={false};
            // A connect that hangs answers within a few seconds and is dropped, so the next request connects afresh.
            final Runnable late=() -> {
                if(done[0]) return; done[0]=true; pending--;
                if(controller==connected && !connected.isDone()) { controller=null; MediaController.releaseFuture(connected); }
                answer(reply,rid,null,"Music player did not answer");
            };
            ui.postDelayed(late,CONNECT_TIMEOUT_MS);
            connected.addListener(() -> {
                if(done[0]) return; done[0]=true; ui.removeCallbacks(late); pending--;
                if(detached) { answer(reply,rid,null,"Audio request refused"); return; }
                try {
                    try { connected.get(); } catch(Exception bad) {
                        if(controller==connected) { MediaController.releaseFuture(connected); controller=null; }
                        throw bad;
                    }
                    BackgroundAudioService s=BackgroundAudioService.current();
                    if(s==null) { if(controller==connected) { MediaController.releaseFuture(connected); controller=null; } throw new IllegalStateException(); }
                    s.command(app,method,r); answer(reply,rid,s.snapshot(app,r.optInt("knownQueueRevision",-1)),null);
                } catch(Exception e) { answer(reply,rid,null,"Music command failed"); }
            },activity.getMainExecutor());
        } catch(JSONException|RuntimeException e) { answer(reply,id,null,"Music command failed"); }
    }
    private void answer(JavaScriptReplyProxy p,String id,JSONObject result,String error) {
        try { JSONObject o=new JSONObject().put("id",id).put("ok",error==null); if(error==null) o.put("result",result); else o.put("error",error); p.postMessage(o.toString()); } catch(JSONException|RuntimeException ignored) { }
    }
}
