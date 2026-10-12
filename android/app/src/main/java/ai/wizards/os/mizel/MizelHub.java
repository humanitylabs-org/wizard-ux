package ai.wizards.os.mizel;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * In-process meeting-recorder switchboard. The web bridge (MizelBridge) and the notification both talk to the
 * recorder through here; the recorder answers each command once (done) and pushes level/state to every listener.
 * Everything runs on the main thread.
 */
public final class MizelHub {
    static final String TAG = "WizardMizel";
    private static final long REPLY_TIMEOUT_MS = 10_000;

    public interface Listener { void onPush(String json); }

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final List<Listener> listeners = new ArrayList<>();
    private static final Map<Integer, Consumer<String>> waiting = new HashMap<>();
    private static int nextReq = 1;
    private static final java.util.Set<Object> pcmOwners = new java.util.HashSet<>();
    private static volatile boolean pcmWanted;
    private static final java.util.ArrayDeque<String> pcmQueue = new java.util.ArrayDeque<>();
    private static boolean pcmScheduled;
    public static boolean wantsPcm() { return pcmWanted; }
    public static void wantPcm(Object owner, boolean want) {
        onMain(() -> { if (want) pcmOwners.add(owner); else pcmOwners.remove(owner); pcmWanted = !pcmOwners.isEmpty();
            if (!pcmWanted) synchronized (pcmQueue) { pcmQueue.clear(); } });
    }
    static void pushPcm(String json) {
        if (!pcmWanted) return;
        synchronized (pcmQueue) {
            if (pcmQueue.size() >= 4) pcmQueue.removeFirst(); // at most one second of transient frames
            pcmQueue.addLast(json);
            if (pcmScheduled) return;
            pcmScheduled = true;
        }
        main.post(() -> {
            while (true) {
                String packet;
                synchronized (pcmQueue) { packet = pcmQueue.pollFirst(); if (packet == null) { pcmScheduled = false; return; } }
                if (pcmWanted) for (Listener l : new ArrayList<>(listeners)) l.onPush(packet);
            }
        });
    }
    private static MizelStore store;

    private MizelHub() {}

    public static synchronized MizelStore store(Context c) {
        if (store == null) {
            store = new MizelStore(new java.io.File(c.getApplicationContext().getFilesDir(), "mizel"));
            store.setLog(m -> Log.i(TAG, m));
        }
        return store;
    }

    public static void addListener(Listener l) { onMain(() -> { if (!listeners.contains(l)) listeners.add(l); }); }

    public static void removeListener(Listener l) { onMain(() -> listeners.remove(l)); }

    static void push(String json) {
        onMain(() -> { for (Listener l : new ArrayList<>(listeners)) l.onPush(json); });
    }

    static void pushState(Context c) {
        Context app = c.getApplicationContext();
        onMain(() -> push(MizelProtocol.statePush(state(app))));
    }

    /** The current state: the live session if there is one, else the last meeting this phone recorded. */
    public static JSONObject state(Context c) {
        MeetingRecorderService.Live live = MeetingRecorderService.live();
        long timeout = MizelConfig.pauseTimeoutMs(c);
        if (live != null) {
            MizelJournal j = store(c).snapshot(live.meetingId);
            int pend = j == null ? 0 : j.pending.size();
            long pausedMs = live.paused ? Math.max(0, System.currentTimeMillis() - live.pausedAtWall) : 0;
            return MizelProtocol.state(true, live.paused, live.meetingId, live.mediaMs(), pend, pausedMs,
                    live.paused ? "paused" : "recording", timeout);
        }
        MizelJournal last = null;
        for (MizelJournal j : store(c).all()) if (last == null || j.createdAt >= last.createdAt) last = j;
        if (last == null) return MizelProtocol.state(false, false, null, 0, 0, 0, "idle", timeout);
        boolean finishing = !last.pending.isEmpty() || last.stopPending();
        return MizelProtocol.state(false, false, last.meetingId, last.mediaMs(), last.pending.size(), 0,
                finishing ? "finishing" : "done", timeout);
    }

    /** Runs one page command; {@code reply} gets the reply JSON exactly once (main thread). */
    public static void command(Context ctx, MizelProtocol.Cmd c, Consumer<String> reply) {
        Context app = ctx.getApplicationContext();
        onMain(() -> {
            if (c.error != null) { reply.accept(MizelProtocol.reply(c.id, false, c.error, null)); return; }
            MeetingRecorderService.Live live = MeetingRecorderService.live();
            switch (c.cmd) {
                case MizelProtocol.STATUS:
                    reply.accept(MizelProtocol.reply(c.id, true, null, state(app)));
                    return;
                case MizelProtocol.START: {
                    if (live != null) {
                        if (live.meetingId.equals(c.meetingId)) reply.accept(MizelProtocol.reply(c.id, true, null, state(app)));
                        else reply.accept(MizelProtocol.reply(c.id, false, MizelProtocol.E_BUSY_OTHER, state(app)));
                        return;
                    }
                    String refuse = MeetingRecorderService.canStart(app);
                    if (refuse != null) { reply.accept(MizelProtocol.reply(c.id, false, refuse, state(app))); return; }
                    int req = waitFor(app, c, reply);
                    MeetingRecorderService.send(app, MeetingRecorderService.ACTION_START, c.meetingId, null, req, true);
                    return;
                }
                default: {
                    if (live == null) { reply.accept(MizelProtocol.reply(c.id, false, MizelProtocol.E_NOT_RECORDING, state(app))); return; }
                    if (c.meetingId != null && !c.meetingId.equals(live.meetingId)) {
                        reply.accept(MizelProtocol.reply(c.id, false, MizelProtocol.E_WRONG_MEETING, state(app)));
                        return;
                    }
                    String action = MizelProtocol.PAUSE.equals(c.cmd) ? MeetingRecorderService.ACTION_PAUSE
                            : MizelProtocol.RESUME.equals(c.cmd) ? MeetingRecorderService.ACTION_RESUME : MeetingRecorderService.ACTION_STOP;
                    int req = waitFor(app, c, reply);
                    MeetingRecorderService.send(app, action, live.meetingId, MizelPolicy.REASON_USER, req, false);
                }
            }
        });
    }

    private static int waitFor(Context app, MizelProtocol.Cmd c, Consumer<String> reply) {
        int req = nextReq++;
        waiting.put(req, error -> reply.accept(MizelProtocol.reply(c.id, error == null, error, state(app))));
        main.postDelayed(() -> done(req, MizelProtocol.E_START_FAILED), REPLY_TIMEOUT_MS);
        return req;
    }

    /** The recorder finished a command: error null = ok. Unknown/late tokens are ignored. */
    static void done(int req, String error) {
        onMain(() -> {
            Consumer<String> r = waiting.remove(req);
            if (r != null) r.accept(error);
        });
    }

    static void onMain(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) r.run();
        else main.post(r);
    }
}
