package ai.wizards.os.audio;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.*;
import androidx.media3.datasource.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import com.google.common.util.concurrent.MoreExecutors;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import ai.wizards.os.MainActivity;
import ai.wizards.os.device.AppState;

/** Reusable transport pilot; queue policy/catalog/taste remain server-owned. Main-thread canonical state. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class BackgroundAudioService extends MediaSessionService {
    private static volatile BackgroundAudioService live;
    static BackgroundAudioService current() { return live; }
    public static boolean active() { BackgroundAudioService s=live; return s != null && s.transportActive; }
    private ExoPlayer player;
    private MediaSession session;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private final List<JSONObject> tracks = new ArrayList<>();
    private final LinkedHashMap<String,JSONObject> reports = new LinkedHashMap<>();
    private JSONObject station;
    private String origin, sessionId = UUID.randomUUID().toString(), error = "", playEvent = "", reportedPlay = "", transitionId = "";
    private int revision, generation, refillAttempts;
    private boolean refilling, reporting, destroyed, advanceAfterRefill;
    private volatile boolean transportActive;
    private boolean micResume;
    private final Runnable micMonitor = new Runnable() {
        @Override public void run() {
            if(destroyed || player==null) return;
            boolean held=ai.wizards.os.MicOwner.holder()!=null;
            if(held && player.getPlayWhenReady()) { micResume=true; player.pause(); }
            else if(!held && micResume) { micResume=false; player.play(); }
            main.postDelayed(this,player.getPlayWhenReady() || micResume ? 200 : 1000);
        }
    };
    private String refillKey = UUID.randomUUID().toString();
    @Override public void onCreate() {
        super.onCreate(); live = this; origin = AppState.origin(this);
        DataSource.Factory source = () -> new AudioHttp(origin);
        player = new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(source))
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_NETWORK).setMaxSeekToPreviousPositionMs(4000).build();
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player p, Player.Events events) { transportActive=(p.getPlayWhenReady() || micResume) && p.getMediaItemCount()>0; }
            @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                playEvent = UUID.randomUUID().toString(); error = "";
                Log.i("WizardAudio", "transition " + (item == null ? "none" : item.mediaId) + " session=" + sessionId);
                maybeRefill(); reportPlayed();
            }
            @Override public void onIsPlayingChanged(boolean playing) { if (playing) reportPlayed(); }
            @Override public void onPlaybackStateChanged(int state) { if (state == Player.STATE_ENDED) { advanceAfterRefill = true; maybeRefill(); } }
            @Override public void onPlayerError(@NonNull PlaybackException e) {
                error = "This track could not be played. Skipping."; final int g = generation; final String event = playEvent;
                main.postDelayed(() -> { if (!destroyed && g == generation && event.equals(playEvent) && player.getPlayWhenReady()) {
                    report("skipped"); if (player.hasNextMediaItem()) { player.seekToNextMediaItem(); player.prepare(); } else { advanceAfterRefill = true; maybeRefill(); }
                } }, 900);
            }
        });
        Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(origin + "/wizard-os-home/?open=wizard-music"))
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        session = new MediaSession.Builder(this, player)
            .setSessionActivity(PendingIntent.getActivity(this, 7410, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .setBitmapLoader(new DataSourceBitmapLoader(MoreExecutors.listeningDecorator(net), source))
            .setCallback(new MediaSession.Callback() {
                @Override public MediaSession.ConnectionResult onConnect(MediaSession s, MediaSession.ControllerInfo c) {
                    if (!getPackageName().equals(c.getPackageName()) && !c.isTrusted()) return MediaSession.ConnectionResult.reject();
                    return new MediaSession.ConnectionResult.AcceptedResultBuilder(s).build();
                }
                @Override public int onPlayerCommandRequest(MediaSession s, MediaSession.ControllerInfo c, int command) {
                    if (command == Player.COMMAND_PLAY_PAUSE && micResume) micResume=false;
                    if (command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM || command == Player.COMMAND_SEEK_TO_NEXT) report("skipped");
                    return androidx.media3.session.SessionResult.RESULT_SUCCESS;
                }
            }).build();
        restoreReports();
        main.post(micMonitor);
        Log.i("WizardAudio", "created session=" + sessionId);
    }
    @Nullable @Override public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo c) { return session; }
    @Override public void onTaskRemoved(@Nullable Intent i) { if (!active()) stopSelf(); }
    @Override public void onDestroy() {
        destroyed = true; live = null; main.removeCallbacksAndMessages(null); saveReports();
        if (session != null) session.release(); if (player != null) player.release(); net.shutdownNow(); super.onDestroy();
    }
    JSONObject snapshot(int known) throws JSONException {
        JSONObject o = new JSONObject().put("v",1).put("sessionId",sessionId).put("appId","wizard-music")
            .put("index",tracks.isEmpty() ? -1 : player.getCurrentMediaItemIndex()).put("playing",player.isPlaying())
            .put("wantPlaying",player.getPlayWhenReady() || micResume).put("buffering",player.getPlaybackState() == Player.STATE_BUFFERING)
            .put("positionMs",Math.max(0,player.getCurrentPosition())).put("durationMs",player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration())
            .put("volume",player.getVolume()).put("error",error).put("station",station == null ? JSONObject.NULL : station)
            .put("queueRevision",revision).put("generation",generation).put("reporter","native");
        if (known != revision) o.put("queue",new JSONArray(tracks));
        return o;
    }
    private MediaItem item(JSONObject t) throws JSONException {
        if (!t.optString("id").matches("(?:yt|lib):[A-Za-z0-9_-]{1,40}") || !AudioPolicy.trusted(t.optString("stream"),origin,"stream")) throw new SecurityException("Untrusted track");
        MediaMetadata.Builder m = new MediaMetadata.Builder().setTitle(t.optString("title")).setArtist(t.optString("artist")).setAlbumTitle(t.optString("album"));
        if (AudioPolicy.trusted(t.optString("art"),origin,"art")) m.setArtworkUri(Uri.parse(t.optString("art")));
        return new MediaItem.Builder().setMediaId(t.getString("id")).setUri(t.getString("stream")).setMediaMetadata(m.build()).build();
    }
    void command(String method, JSONObject p) throws JSONException {
        if (!"load".equals(method) && !"state".equals(method) && !"attach".equals(method) && !sessionId.equals(p.optString("sessionId"))) throw new SecurityException("Stale audio session");
        switch (method) {
            case "load": {
                if (!sessionId.equals(p.optString("sessionId"))) throw new SecurityException("Attach before load");
                JSONArray q = p.getJSONArray("queue"); if (q.length() == 0 || q.length() > 100) throw new IllegalArgumentException("Queue length");
                JSONObject st = p.optJSONObject("station");
                if (st != null && !AudioPolicy.trusted(st.optString("more"),origin,"more")) throw new SecurityException("Untrusted continuation");
                List<JSONObject> add = new ArrayList<>(); List<MediaItem> items = new ArrayList<>();
                for (int i=0;i<q.length();i++) { JSONObject t = q.getJSONObject(i); items.add(item(t)); add.add(t); }
                int at = player.getMediaItemCount() == 0 ? -1 : player.getCurrentMediaItemIndex();
                List<JSONObject> history = at < 0 ? new ArrayList<>() : new ArrayList<>(tracks.subList(Math.max(0,at+1-50),at+1));
                for (int i=history.size()-1;i>=0;i--) items.add(0,item(history.get(i)));
                int index = Math.max(0,Math.min(q.length()-1,p.optInt("index",0))) + history.size();
                tracks.clear(); tracks.addAll(history); tracks.addAll(add); station = st; generation++; revision++; refillAttempts=0; advanceAfterRefill=false;
                refillKey=UUID.randomUUID().toString(); player.setMediaItems(items,index,0); player.prepare(); player.play(); break;
            }
            case "play": if (player.getPlaybackState()==Player.STATE_IDLE) player.prepare(); player.play(); if(ai.wizards.os.MicOwner.holder()!=null) { micResume=true; player.pause(); } break;
            case "pause": micResume=false; advanceAfterRefill=false; player.pause(); break;
            case "seek": player.seekTo(Math.max(0,p.optLong("positionMs"))); break;
            case "next": report("skipped"); if (player.hasNextMediaItem()) { player.seekToNextMediaItem(); player.play(); } else { advanceAfterRefill=true; player.play(); maybeRefill(); } break;
            case "previous": player.seekToPrevious(); player.play(); break;
            case "jump": { int i=p.optInt("index",-1); if (i>=0 && i<tracks.size()) { player.seekTo(i,0); player.play(); } break; }
            case "enqueueNext": {
                JSONObject t=p.getJSONObject("track"); MediaItem mi=item(t); int at=player.getCurrentMediaItemIndex();
                for(int i=tracks.size()-1;i>at;i--) if(tracks.get(i).optString("id").equals(t.optString("id"))) { tracks.remove(i); player.removeMediaItem(i); }
                tracks.add(at+1,t); player.addMediaItem(at+1,mi); revision++; break;
            }
            case "removeCurrent": {
                int at=player.getCurrentMediaItemIndex(); if(at>=0 && at<tracks.size()) {
                    report("skipped"); player.pause(); tracks.remove(at); player.removeMediaItem(at); revision++;
                    if(!tracks.isEmpty() && at<tracks.size()) { player.prepare(); player.play(); }
                    else { advanceAfterRefill=true; player.play(); maybeRefill(); }
                } break;
            }
            case "removeUpcoming": {
                JSONArray ids=p.optJSONArray("ids"); Set<String> drop=new HashSet<>(); if(ids!=null) for(int i=0;i<ids.length();i++) drop.add(ids.optString(i));
                for(int i=tracks.size()-1;i>player.getCurrentMediaItemIndex();i--) if(drop.contains(tracks.get(i).optString("id"))) { tracks.remove(i); player.removeMediaItem(i); revision++; }
                maybeRefill(); break;
            }
            case "volume": player.setVolume((float)Math.max(0,Math.min(1,p.optDouble("value",1)))); break;
            case "stop": micResume=false; generation++; station=null; player.stop(); player.clearMediaItems(); tracks.clear(); revision++; break;
            case "attach": case "state": case "detach": break;
            default: throw new IllegalArgumentException("Unknown audio method");
        }
    }
    private void reportPlayed() { if(player.isPlaying() && !playEvent.equals(reportedPlay)) { report("played"); reportedPlay=playEvent; } }
    private void report(String action) {
        int at=player.getCurrentMediaItemIndex(); if(at<0 || at>=tracks.size()) return;
        try {
            String key=sessionId+":"+playEvent+":"+action;
            JSONObject body=new JSONObject().put("eventId",key).put("id",tracks.get(at).optString("id")).put("action",action);
            reports.put(key,body); while(reports.size()>200) reports.remove(reports.keySet().iterator().next()); saveReports(); drainReports();
        } catch(JSONException ignored) { }
    }
    private void restoreReports() {
        try { JSONArray q=new JSONArray(getSharedPreferences("background-audio",0).getString("reports","[]")); for(int i=0;i<q.length();i++) { JSONObject r=q.getJSONObject(i); reports.put(r.getString("eventId"),r); } } catch(JSONException ignored) { }
        drainReports();
    }
    private void saveReports() { getSharedPreferences("background-audio",0).edit().putString("reports",new JSONArray(reports.values()).toString()).apply(); }
    private void drainReports() {
        if(reporting || destroyed || reports.isEmpty()) return; reporting=true;
        String key=reports.keySet().iterator().next(); JSONObject body=reports.get(key);
        net.execute(() -> { boolean ok=false; try { AudioHttp.json(origin+"/wizard-music/api/feedback",origin,"feedback",body); ok=true; } catch(Exception ignored) { }
            final boolean done=ok; main.post(() -> { reporting=false; if(destroyed) return; if(done) { reports.remove(key); saveReports(); drainReports(); } else main.postDelayed(this::drainReports,10000); });
        });
    }
    private void maybeRefill() {
        if(destroyed || station==null || refilling || tracks.size()-player.getCurrentMediaItemIndex()-1>5) return;
        refilling=true; final int g=generation; final String more=station.optString("more"); final String key=refillKey;
        net.execute(() -> {
            JSONArray q=null; try { String u=more+(more.contains("?")?"&":"?")+"n=10&requestId="+key; q=AudioHttp.json(u,origin,"more",null).optJSONArray("tracks"); } catch(Exception ignored) { }
            final JSONArray result=q;
            main.post(() -> {
                refilling=false; if(destroyed) return;
                if(g!=generation) { maybeRefill(); return; }
                if(result==null || result.length()==0) { error="Could not reach your music right now."; if(refillAttempts++<4) main.postDelayed(this::maybeRefill,Math.min(30000,2000L<<refillAttempts)); return; }
                refillAttempts=0; refillKey=UUID.randomUUID().toString(); Set<String> known=new HashSet<>(); for(JSONObject t:tracks) known.add(t.optString("id"));
                List<MediaItem> items=new ArrayList<>(); int old=tracks.size();
                for(int i=0;i<result.length() && i<20;i++) { JSONObject t=result.optJSONObject(i); if(t==null || !known.add(t.optString("id"))) continue;
                    try { items.add(item(t)); tracks.add(t); } catch(JSONException|RuntimeException ignored) { } }
                if(!items.isEmpty()) { revision++; player.addMediaItems(items); error=""; Log.i("WizardAudio","refill added="+items.size()+" generation="+g);
                    if(advanceAfterRefill && player.getPlayWhenReady()) { advanceAfterRefill=false; player.seekTo(old,0); player.prepare(); }
                }
                int trim=player.getCurrentMediaItemIndex()-50;
                if(trim>0) { tracks.subList(0,trim).clear(); player.removeMediaItems(0,trim); revision++; }
            });
        });
    }
}
