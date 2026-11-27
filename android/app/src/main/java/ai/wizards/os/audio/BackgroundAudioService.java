package ai.wizards.os.audio;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Build;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.*;
import androidx.media3.datasource.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.CommandButton;
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
    private final ExecutorService net = Executors.newFixedThreadPool(2);
    private final ExecutorService artwork = Executors.newFixedThreadPool(2);
    private final List<JSONObject> tracks = new ArrayList<>();
    private final LinkedHashMap<String,JSONObject> reports = new LinkedHashMap<>();
    private JSONObject station;
    private String origin, sessionId = UUID.randomUUID().toString(), error = "", playEvent = "", reportedPlay = "", transitionId = "";
    private int revision, generation, refillAttempts;
    private boolean refilling, reporting, destroyed, advanceAfterRefill;
    private volatile boolean transportActive;
    private PlaybackException failure;
    private boolean userWant;
    // The admitted app that owns the one device player (wizard-ux issue 1661). Music until another admitted app loads.
    private String owner = AudioPolicy.MUSIC;
    private long skipBack, skipForward, lastDurationMs;
    private int lastIndex = -1;
    private static final long PROGRESS_EVERY_MS = 15000;
    // Calls come first (wizard-ux issue 1976): a call stops the player and frees the output; it resumes after.
    private final CallHold calls = new CallHold();
    private AudioManager audio;
    private AudioManager.OnModeChangedListener modeListener;
    private boolean resumedFromCall;
    private void requestPlaying(boolean want) { userWant=want; calls.personActed(); syncIntent(); }
    private void syncIntent() {
        if(destroyed || player==null) return;
        transportActive=userWant && player.getMediaItemCount()>0;
        // Microphone ownership is independent of music. Voice capture must not pause or duck it.
        // Keep Media3's normal system-focus/headset-loss handling and explicit user controls.
        // During a call nothing plays or asks for the audio focus; the call's end decides (issue 1976).
        if(userWant && calls.inCall()) { player.pause(); return; }
        if(userWant && player.getPlaybackState()==Player.STATE_IDLE && player.getPlayerError()==null && player.getMediaItemCount()>0) player.prepare();
        if(userWant) player.play(); else player.pause();
        watchMode();
    }
    private String currentItem() {
        int at=player.getCurrentMediaItemIndex();
        return at>=0 && at<tracks.size() ? tracks.get(at).optString("id") : null;
    }
    private int audioMode() {
        try { return audio==null ? CallHold.MODE_NORMAL : audio.getMode(); } catch(RuntimeException e) { return CallHold.MODE_NORMAL; }
    }
    private boolean focusTaken() { return player.getPlaybackSuppressionReason()==Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS; }
    /** The audio mode or the focus changed: start or end a call hold. */
    private void onMode(int mode, boolean focus) {
        if(destroyed || player==null) return;
        long now=SystemClock.elapsedRealtime();
        int edge=calls.mode(mode, focus || focusTaken(), now);
        if(edge==CallHold.START) startCallHold(now);
        else if(edge==CallHold.END) { Log.i("WizardAudio","call ended mode="+mode); main.removeCallbacks(callOver); main.postDelayed(callOver, CallHold.RESUME_DELAY_MS); }
        watchMode();
    }
    private void startCallHold(long now) {
        main.removeCallbacks(callOver);
        if(!userWant && calls.ringTookIt(now, generation, currentItem())) userWant=true;
        if(userWant && player.getMediaItemCount()>0 && !calls.holding()) calls.hold(generation, currentItem());
        Log.i("WizardAudio","call started mode="+calls.mode()+" held="+calls.holding());
        if(calls.holding()) {
            saveProgress(false);
            // Pause abandons the audio focus; stop releases the audio track and wake lock but keeps queue and place.
            player.pause(); player.stop();
        }
        transportActive=userWant && player.getMediaItemCount()>0;
    }
    private final Runnable callOver = () -> {
        if(destroyed || player==null) return;
        if(calls.inCall()) return; // another call began: its end decides
        int mode=audioMode();
        if(CallHold.telephony(mode) || CallHold.voip(mode)) { main.postDelayed(this.callOver, CallHold.RESUME_DELAY_MS); onMode(mode,false); return; }
        boolean was=calls.holding();
        boolean go=calls.release(userWant, generation, currentItem());
        Log.i("WizardAudio","after call held="+was+" resume="+go);
        if(go) { resumedFromCall=true; syncIntent(); }
        else if(userWant) requestPlaying(false); // paused, stopped or something else loaded during the call: show it paused
    };
    // Android 11 and older have no mode listener: look once a second while something plays or waits for a call's end.
    private final Runnable modePoll = () -> { if(!destroyed && player!=null) onMode(audioMode(), false); };
    private void watchMode() {
        if(modeListener!=null || destroyed || audio==null) return;
        main.removeCallbacks(modePoll);
        if(userWant || calls.holding() || calls.inCall()) main.postDelayed(modePoll, 1000);
    }
    private String refillKey = UUID.randomUUID().toString();
    @Override public void onCreate() {
        super.onCreate(); live = this; origin = AppState.origin(this);
        DataSource.Factory source = () -> new AudioHttp(origin);
        player = new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(source))
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_NETWORK).setMaxSeekToPreviousPositionMs(4000).build();
        audio=(AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if(audio!=null && Build.VERSION.SDK_INT>=31) {
            try { modeListener=m -> onMode(m,false); audio.addOnModeChangedListener(main::post, modeListener); }
            catch(RuntimeException e) { modeListener=null; }
        }
        calls.mode(audioMode(), false, SystemClock.elapsedRealtime());
        player.addListener(new Player.Listener() {
            @Override public void onEvents(Player p, Player.Events events) { transportActive=userWant && p.getMediaItemCount()>0; long d=p.getDuration(); if(d!=C.TIME_UNSET && d>0) lastDurationMs=d; }
            @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                // A spoken-word episode that played to its end and moved on is finished (STATE_ENDED only fires for the last one).
                if(reason==Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) saveFinished(lastIndex);
                lastIndex=player.getCurrentMediaItemIndex(); lastDurationMs=0;
                playEvent = UUID.randomUUID().toString(); error = ""; failure=null;
                Log.i("WizardAudio", "transition " + (item == null ? "none" : item.mediaId) + " session=" + sessionId);
                maybeRefill(); reportPlayed();
            }
            @Override public void onPlayWhenReadyChanged(boolean ready,int reason) {
                if(ready || (reason!=Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY && reason!=Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS)) return;
                long now=SystemClock.elapsedRealtime(); int mode=audioMode();
                if(CallHold.callCaused(reason, mode, now, calls.callEndedAt())) {
                    // A call took the audio (or the earphones switched profile for it): not the person's pause.
                    Log.i("WizardAudio","call pause reason="+reason+" mode="+mode);
                    if(CallHold.telephony(mode) || CallHold.voip(mode)) onMode(mode,true);
                    else if(userWant) {
                        // Just after a call: hold again and come back once Bluetooth has settled.
                        if(!calls.holding()) calls.hold(generation, currentItem());
                        main.removeCallbacks(callOver); main.postDelayed(callOver, CallHold.RESUME_DELAY_MS);
                    }
                    return;
                }
                userWant=false; transportActive=false; calls.realPause(reason, now, generation, currentItem());
            }
            @Override public void onPlaybackSuppressionReasonChanged(int reason) {
                // A ring or call took the focus for a while: in a voice-chat mode that makes it a call.
                if(reason==Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS) onMode(audioMode(),true);
            }
            @Override public void onIsPlayingChanged(boolean playing) {
                if (playing) { failure=null; reportPlayed(); if(resumedFromCall) { resumedFromCall=false; saveProgress(false); } progressTick(); } else saveProgress(false);
            }
            @Override public void onPlaybackStateChanged(int state) { if (state == Player.STATE_ENDED) { saveProgress(true); if(station==null) requestPlaying(false); else { advanceAfterRefill = true; maybeRefill(); } } }
            @Override public void onPlayerError(@NonNull PlaybackException e) {
                error = "This track could not be played. Skipping."; failure=e; final String event = playEvent;
                Log.i("WizardAudio","error index="+player.getCurrentMediaItemIndex()+" wanted="+userWant);
                main.postDelayed(() -> { if (!destroyed && event.equals(playEvent) && userWant && failure==e) {
                    Log.i("WizardAudio","recover error index="+player.getCurrentMediaItemIndex());
                    report("skipped"); int next=player.getCurrentMediaItemIndex()+1;
                    if(next<tracks.size()) {
                        try { seekCanonical(next); syncIntent(); } catch(JSONException bad) { error="Could not advance the music queue."; requestPlaying(false); }
                    } else if(station!=null) { advanceAfterRefill = true; maybeRefill(); }
                    else requestPlaying(false);
                } }, 900);
            }
        });
        ForwardingPlayer controls=new ForwardingPlayer(player) {
            @Override public void play() { requestPlaying(true); }
            @Override public void pause() { requestPlaying(false); }
            @Override public void setPlayWhenReady(boolean want) { requestPlaying(want); }
            // An app that asked for skip buttons (Podcasts: -15/+30) gets them from the lock screen, notification and headset.
            @Override public void seekBack() { if(skipBack>0) seekBy(-skipBack); else super.seekBack(); }
            @Override public void seekForward() { if(skipForward>0) seekBy(skipForward); else super.seekForward(); }
            @Override public long getSeekBackIncrement() { return skipBack>0 ? skipBack : super.getSeekBackIncrement(); }
            @Override public long getSeekForwardIncrement() { return skipForward>0 ? skipForward : super.getSeekForwardIncrement(); }
            @Override public void seekToNext() { if(skipForward>0) seekBy(skipForward); else super.seekToNext(); }
            @Override public void seekToPrevious() { if(skipBack>0) seekBy(-skipBack); else super.seekToPrevious(); }
        };
        session = new MediaSession.Builder(this, controls)
            .setSessionActivity(activity(owner))
            .setBitmapLoader(new DataSourceBitmapLoader(MoreExecutors.listeningDecorator(artwork), source))
            .setCallback(new MediaSession.Callback() {
                @Override public MediaSession.ConnectionResult onConnect(MediaSession s, MediaSession.ControllerInfo c) {
                    if (!getPackageName().equals(c.getPackageName()) && !c.isTrusted()) return MediaSession.ConnectionResult.reject();
                    Player.Commands commands=new Player.Commands.Builder().addAllCommands()
                        .remove(Player.COMMAND_CHANGE_MEDIA_ITEMS).remove(Player.COMMAND_SET_MEDIA_ITEM)
                        .remove(Player.COMMAND_SET_PLAYLIST_METADATA).remove(Player.COMMAND_SET_REPEAT_MODE)
                        .remove(Player.COMMAND_SET_SHUFFLE_MODE).remove(Player.COMMAND_STOP).build();
                    return new MediaSession.ConnectionResult.AcceptedResultBuilder(s).setAvailablePlayerCommands(commands).build();
                }
                @Override public int onPlayerCommandRequest(MediaSession s, MediaSession.ControllerInfo c, int command) {
                    if(command==Player.COMMAND_CHANGE_MEDIA_ITEMS || command==Player.COMMAND_SET_MEDIA_ITEM || command==Player.COMMAND_SET_PLAYLIST_METADATA || command==Player.COMMAND_SET_SHUFFLE_MODE || command==Player.COMMAND_SET_REPEAT_MODE || command==Player.COMMAND_STOP) return androidx.media3.session.SessionError.ERROR_NOT_SUPPORTED;
                    if (command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM || command == Player.COMMAND_SEEK_TO_NEXT) report("skipped");
                    return androidx.media3.session.SessionResult.RESULT_SUCCESS;
                }
            }).build();
        restoreReports();

        Log.i("WizardAudio", "created session=" + sessionId);
    }
    @Nullable @Override public MediaSession onGetSession(@NonNull MediaSession.ControllerInfo c) { return session; }
    @Override public void onTaskRemoved(@Nullable Intent i) { if (!active()) stopSelf(); }
    @Override public void onDestroy() {

        destroyed = true; live = null; main.removeCallbacksAndMessages(null); saveReports();
        if(audio!=null && modeListener!=null && Build.VERSION.SDK_INT>=31) { try { audio.removeOnModeChangedListener(modeListener); } catch(RuntimeException ignored) { } }
        if (session != null) session.release(); if (player != null) player.release(); net.shutdownNow(); artwork.shutdownNow(); super.onDestroy();
    }
    private PendingIntent activity(String app) {
        Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(origin + AudioPolicy.openPath(app)))
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return PendingIntent.getActivity(this, AudioPolicy.MUSIC.equals(app) ? 7410 : 7411, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private void seekBy(long delta) {
        long d=player.getDuration(), t=Math.max(0,player.getCurrentPosition()+delta);
        player.seekTo(d==C.TIME_UNSET ? t : Math.min(t,d));
    }
    private static int skipIcon(long ms, boolean back) {
        int s=(int)(ms/1000);
        if(back) return s==5 ? CommandButton.ICON_SKIP_BACK_5 : s==10 ? CommandButton.ICON_SKIP_BACK_10 : s==15 ? CommandButton.ICON_SKIP_BACK_15 : s==30 ? CommandButton.ICON_SKIP_BACK_30 : CommandButton.ICON_SKIP_BACK;
        return s==5 ? CommandButton.ICON_SKIP_FORWARD_5 : s==10 ? CommandButton.ICON_SKIP_FORWARD_10 : s==15 ? CommandButton.ICON_SKIP_FORWARD_15 : s==30 ? CommandButton.ICON_SKIP_FORWARD_30 : CommandButton.ICON_SKIP_FORWARD;
    }
    /** Owner-specific session look: content type, where a tap opens, and skip buttons in place of previous/next. */
    private void applyOwner() {
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
            .setContentType(AudioPolicy.spoken(owner) ? C.AUDIO_CONTENT_TYPE_SPEECH : C.AUDIO_CONTENT_TYPE_MUSIC).build(), true);
        if(session==null) return;
        session.setSessionActivity(activity(owner));
        List<CommandButton> buttons=new ArrayList<>();
        if(skipBack>0) buttons.add(new CommandButton.Builder(skipIcon(skipBack,true)).setPlayerCommand(Player.COMMAND_SEEK_BACK)
            .setDisplayName("Back "+(skipBack/1000)+" seconds").setSlots(CommandButton.SLOT_BACK).build());
        if(skipForward>0) buttons.add(new CommandButton.Builder(skipIcon(skipForward,false)).setPlayerCommand(Player.COMMAND_SEEK_FORWARD)
            .setDisplayName("Forward "+(skipForward/1000)+" seconds").setSlots(CommandButton.SLOT_FORWARD).build());
        session.setMediaButtonPreferences(buttons);
    }
    /** Another admitted app starts playing: the one device player becomes its own (the old app's queue is dropped). */
    private void adopt(String app) {
        saveProgress(false); requestPlaying(false); generation++; station=null; advanceAfterRefill=false;
        player.stop(); player.clearMediaItems(); tracks.clear(); revision++; error=""; failure=null;
        owner=app; skipBack=skipForward=0; lastIndex=-1; lastDurationMs=0; applyOwner();
        Log.i("WizardAudio","owner "+app+" session="+sessionId);
    }
    /** Spoken-word apps get their place saved by the player itself, so it keeps saving while the phone is locked. */
    private void saveProgress(boolean completed) {
        if(destroyed || player==null || !AudioPolicy.spoken(owner)) return;
        int at=player.getCurrentMediaItemIndex(); if(at<0 || at>=tracks.size()) return;
        final String url=tracks.get(at).optString("progress"); if(url.isEmpty()) return;
        final String app=owner;
        try {
            long d=player.getDuration();
            JSONObject body=new JSONObject().put("position",Math.max(0,player.getCurrentPosition())/1000.0);
            if(d!=C.TIME_UNSET && d>0) body.put("duration",d/1000.0);
            if(completed) body.put("completed",true);
            net.execute(() -> { try { AudioHttp.json(url,origin,"progress",body,app); } catch(Exception ignored) { } });
        } catch(JSONException|RuntimeException ignored) { }
    }
    /** The episode at `index` (no longer the current item) played to its end. */
    private void saveFinished(int index) {
        if(destroyed || !AudioPolicy.spoken(owner) || index<0 || index>=tracks.size()) return;
        final String url=tracks.get(index).optString("progress"); if(url.isEmpty()) return;
        final String app=owner;
        try {
            JSONObject body=new JSONObject().put("position",lastDurationMs/1000.0).put("completed",true);
            if(lastDurationMs>0) body.put("duration",lastDurationMs/1000.0);
            net.execute(() -> { try { AudioHttp.json(url,origin,"progress",body,app); } catch(Exception ignored) { } });
        } catch(JSONException|RuntimeException ignored) { }
    }
    private final Runnable progressSave = () -> { if(!destroyed && player.isPlaying()) { saveProgress(false); progressTick(); } };
    private void progressTick() {
        main.removeCallbacks(progressSave);
        if(destroyed || player==null || !AudioPolicy.spoken(owner) || !player.isPlaying()) return;
        main.postDelayed(progressSave, PROGRESS_EVERY_MS);
    }
    JSONObject snapshot(String app, int known) throws JSONException {
        if(!owner.equals(app)) {
            // Another admitted app owns the player: this app sees an idle player it may load into, never the other queue.
            return new JSONObject().put("v",1).put("sessionId",sessionId).put("appId",app).put("index",-1).put("playing",false)
                .put("wantPlaying",false).put("buffering",false).put("positionMs",0).put("durationMs",0).put("volume",player.getVolume())
                .put("error","").put("station",JSONObject.NULL).put("queueRevision",-1).put("generation",generation)
                .put("reporter","native").put("queue",new JSONArray());
        }
        JSONObject o = new JSONObject().put("v",1).put("sessionId",sessionId).put("appId",owner)
            .put("index",tracks.isEmpty() ? -1 : player.getCurrentMediaItemIndex()).put("playing",player.isPlaying())
            .put("wantPlaying",userWant).put("buffering",player.getPlaybackState() == Player.STATE_BUFFERING)
            .put("positionMs",Math.max(0,player.getCurrentPosition())).put("durationMs",player.getDuration() == C.TIME_UNSET ? 0 : player.getDuration())
            .put("volume",player.getVolume()).put("error",error).put("station",station == null ? JSONObject.NULL : station)
            .put("queueRevision",revision).put("generation",generation).put("reporter","native");
        if (known != revision) o.put("queue",new JSONArray(tracks));
        return o;
    }
    private String absolute(String raw) { return raw.startsWith("/") && !raw.startsWith("//") ? origin+raw : raw; }
    private MediaItem item(JSONObject t) throws JSONException { return item(t, owner); }
    private MediaItem item(JSONObject t, String app) throws JSONException {
        t.put("stream",absolute(t.optString("stream")));
        if(!t.optString("art").isEmpty()) t.put("art",absolute(t.optString("art")));
        if (!AudioPolicy.trackId(app,t.optString("id")) || !AudioPolicy.trusted(t.optString("stream"),origin,"stream",app)) throw new SecurityException("Untrusted track");
        if(!t.optString("progress").isEmpty()) { t.put("progress",absolute(t.optString("progress"))); if(!AudioPolicy.trusted(t.optString("progress"),origin,"progress",app)) t.remove("progress"); }
        MediaMetadata.Builder m = new MediaMetadata.Builder().setTitle(t.optString("title")).setArtist(t.optString("artist")).setAlbumTitle(t.optString("album"));
        if (AudioPolicy.spoken(app)) m.setMediaType(MediaMetadata.MEDIA_TYPE_PODCAST_EPISODE);
        if (AudioPolicy.trusted(t.optString("art"),origin,"art",app)) m.setArtworkUri(Uri.parse(t.optString("art")));
        return new MediaItem.Builder().setMediaId(t.getString("id")).setUri(t.getString("stream")).setMediaMetadata(m.build()).build();
    }
    private void seekCanonical(int at) throws JSONException {
        // ExoPlayer's failed timeline can report no next item although the canonical queue has one.
        if(failure!=null || player.getPlayerError()!=null) {
            failure=null;
            List<MediaItem> restored=new ArrayList<>(); for(JSONObject t:tracks) restored.add(item(t));
            player.setMediaItems(restored,at,0); player.prepare();
        } else player.seekTo(at,0);
    }
    void command(String app, String method, JSONObject p) throws JSONException {
        if (!AudioPolicy.admitted(app)) throw new SecurityException("Unknown audio app");
        if (!"load".equals(method) && !"state".equals(method) && !"attach".equals(method) && !sessionId.equals(p.optString("sessionId"))) throw new SecurityException("Stale audio session");
        // Only the app that owns the player controls it; any admitted app may load (and so take it over).
        if (!owner.equals(app) && !"load".equals(method) && !"state".equals(method) && !"attach".equals(method) && !"detach".equals(method)) throw new SecurityException("Another app owns the player");
        switch (method) {
            case "load": {
                if (!sessionId.equals(p.optString("sessionId"))) throw new SecurityException("Attach before load");
                JSONArray q = p.getJSONArray("queue"); if (q.length() == 0 || q.length() > 100) throw new IllegalArgumentException("Queue length");
                JSONObject st = p.optJSONObject("station");
                if (st != null && !AudioPolicy.trusted(st.optString("more"),origin,"more",app)) throw new SecurityException("Untrusted continuation");
                List<JSONObject> add = new ArrayList<>(); List<MediaItem> items = new ArrayList<>();
                for (int i=0;i<q.length();i++) { JSONObject t = q.getJSONObject(i); items.add(item(t,app)); add.add(t); }
                if (!owner.equals(app)) adopt(app);
                JSONObject skip = p.optJSONObject("skip");
                long back = skip == null ? 0 : AudioPolicy.skipMs(skip.optDouble("back",0)), fwd = skip == null ? 0 : AudioPolicy.skipMs(skip.optDouble("forward",0));
                if (back != skipBack || fwd != skipForward) { skipBack = back; skipForward = fwd; applyOwner(); }
                int at = player.getMediaItemCount() == 0 ? -1 : player.getCurrentMediaItemIndex();
                List<JSONObject> history = at < 0 ? new ArrayList<>() : new ArrayList<>(tracks.subList(Math.max(0,at+1-50),at+1));
                for (int i=history.size()-1;i>=0;i--) items.add(0,item(history.get(i)));
                int index = Math.max(0,Math.min(q.length()-1,p.optInt("index",0))) + history.size();
                tracks.clear(); tracks.addAll(history); tracks.addAll(add); station = st; generation++; revision++; refillAttempts=0; advanceAfterRefill=false;
                refillKey=UUID.randomUUID().toString(); player.setMediaItems(items,index,Math.max(0,p.optLong("positionMs",0))); player.prepare(); requestPlaying(true); break;
            }
            case "play": failure=null; if(player.getPlaybackState()==Player.STATE_ENDED) player.seekTo(0); if (player.getPlaybackState()==Player.STATE_IDLE) player.prepare(); requestPlaying(true); maybeRefill(); break;
            case "pause": advanceAfterRefill=false; requestPlaying(false); break;
            case "seek": player.seekTo(Math.max(0,p.optLong("positionMs"))); break;
            case "next": report("skipped"); if (player.getCurrentMediaItemIndex()+1<tracks.size()) { seekCanonical(player.getCurrentMediaItemIndex()+1); requestPlaying(true); } else { advanceAfterRefill=true; requestPlaying(true); maybeRefill(); } break;
            case "previous": if(player.getPlayerError()!=null) seekCanonical(Math.max(0,player.getCurrentMediaItemIndex()-1)); else player.seekToPrevious(); requestPlaying(true); break;
            case "jump": { int i=p.optInt("index",-1); if (i>=0 && i<tracks.size()) { seekCanonical(i); requestPlaying(true); } break; }
            case "enqueueNext": {
                JSONObject t=p.getJSONObject("track"); MediaItem mi=item(t); int at=player.getCurrentMediaItemIndex();
                for(int i=tracks.size()-1;i>at;i--) if(tracks.get(i).optString("id").equals(t.optString("id"))) { tracks.remove(i); player.removeMediaItem(i); }
                tracks.add(at+1,t); player.addMediaItem(at+1,mi); revision++; break;
            }
            case "removeCurrent": {
                int at=player.getCurrentMediaItemIndex(); if(at>=0 && at<tracks.size()) {
                    report("skipped"); player.pause(); tracks.remove(at); player.removeMediaItem(at); revision++;
                    if(!tracks.isEmpty() && at<tracks.size()) { player.prepare(); requestPlaying(true); }
                    else { advanceAfterRefill=true; requestPlaying(true); maybeRefill(); }
                } break;
            }
            case "removeUpcoming": {
                generation++; refillKey=UUID.randomUUID().toString(); refillAttempts=0;
                JSONArray ids=p.optJSONArray("ids"); Set<String> drop=new HashSet<>(); if(ids!=null) for(int i=0;i<ids.length();i++) drop.add(ids.optString(i));
                for(int i=tracks.size()-1;i>player.getCurrentMediaItemIndex();i--) if(drop.contains(tracks.get(i).optString("id"))) { tracks.remove(i); player.removeMediaItem(i); revision++; }
                maybeRefill(); break;
            }
            case "volume": player.setVolume((float)Math.max(0,Math.min(1,p.optDouble("value",1)))); break;
            case "stop": requestPlaying(false); generation++; station=null; player.stop(); player.clearMediaItems(); tracks.clear(); revision++; break;
            case "attach": case "state": case "detach": break;
            default: throw new IllegalArgumentException("Unknown audio method");
        }
    }
    private void reportPlayed() { if(player.isPlaying() && !playEvent.equals(reportedPlay)) { report("played"); reportedPlay=playEvent; } }
    private void report(String action) {
        if(!AudioPolicy.MUSIC.equals(owner)) return; // Music's taste feedback only.
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
    private void retryRefill(int g,boolean fresh) {
        if(fresh) refillKey=UUID.randomUUID().toString();
        final long delay=Math.min(60000,2000L << Math.min(5,refillAttempts++));
        main.postDelayed(() -> { if(!destroyed && g==generation && userWant) maybeRefill(); },delay);
    }
    private void maybeRefill() {
        if(destroyed || station==null || refilling || tracks.size()-player.getCurrentMediaItemIndex()-1>5) return;
        refilling=true; final int g=generation; final String more=station.optString("more"); final String key=refillKey;
        net.execute(() -> {
            JSONArray q=null;
            try { q=AudioHttp.json(more+(more.contains("?")?"&":"?")+"n=10&requestId="+key,origin,"more",null).optJSONArray("tracks"); }
            catch(Exception ignored) { }
            final JSONArray result=q;
            main.post(() -> {
                refilling=false; if(destroyed) return;
                if(g!=generation) { maybeRefill(); return; }
                if(result==null) { error="Could not reach your music right now. Retrying."; retryRefill(g,false); return; }
                Set<String> known=new HashSet<>(); for(JSONObject t:tracks) known.add(t.optString("id"));
                List<MediaItem> items=new ArrayList<>(); List<JSONObject> accepted=new ArrayList<>(); int old=tracks.size();
                for(int i=0;i<result.length() && i<20;i++) {
                    JSONObject t=result.optJSONObject(i);
                    if(t==null || !known.add(t.optString("id"))) continue;
                    try { items.add(item(t)); accepted.add(t); } catch(JSONException|RuntimeException ignored) { }
                }
                if(items.isEmpty()) { error="No playable next tracks yet. Retrying."; retryRefill(g,true); return; }
                refillAttempts=0; refillKey=UUID.randomUUID().toString(); tracks.addAll(accepted); revision++;
                player.addMediaItems(items); error=""; Log.i("WizardAudio","refill added="+items.size()+" generation="+g);
                if(advanceAfterRefill && userWant) { advanceAfterRefill=false; player.seekTo(old,0); player.prepare(); syncIntent(); }
                int trim=player.getCurrentMediaItemIndex()-50;
                if(trim>0) { tracks.subList(0,trim).clear(); player.removeMediaItems(0,trim); revision++; }
            });
        });
    }

}
