package ai.wizards.shell.recorder;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

import java.io.IOException;
import java.util.function.Supplier;

import ai.wizards.shell.device.DevicePort;

/**
 * device.recording v1: background voice recording for the selected Wizard (see android/shell/README.md).
 *
 *   status            → {id, ref, state: idle|recording|paused|busy, ms, level, last:{id, state}}
 *   level             → {level: 0..100}
 *   start {id?, kind, ref} → {id}; id may be proposed by the page ("take-<ms>-<8 hex>"); asks for the microphone (and, once, notifications) first
 *   pause {id, on}    → status
 *   stop {id}         → the take {id, ref, kind, state, ms, bytes, mime}; its audio stays in custody
 *   cancel {id}       → {released}; a long take (20 s or more) is kept and stays pending
 *   pending           → [take…] waiting for the Wizard, including takes cut short by an app kill
 *   read {id, offset} → {b64, next, size}
 *   ack {id}          → {released}; the Wizard has its own durable copy
 *
 * Every take belongs to the Wizard that started it: another Wizard can't list, read or acknowledge it.
 */
public final class RecordingCapability implements DevicePort.Adapter {
    public interface Permissions { boolean ensure(String... permissions); }

    private final Context context;
    private final Supplier<String> origin;
    private final Permissions permissions;

    public RecordingCapability(Context context, Supplier<String> origin, Permissions permissions) {
        this.context = context.getApplicationContext();
        this.origin = origin;
        this.permissions = permissions;
    }

    @Override public String name() { return "device.recording"; }
    @Override public int version() { return 1; }
    @Override public String[] methods() { return RecordingMethods.ALL; }

    @Override public void call(String method, JSONObject params, DevicePort.Reply reply) {
        String owner = origin.get();
        if (owner == null) { reply.error("no Wizard"); return; }
        TakeStore store = RecorderService.store(context);
        String id = params.optString("id", "");
        try {
            switch (method) {
                case "status": reply.ok(RecorderService.status(owner)); return;
                case "level": reply.ok(new JSONObject().put("level", RecorderService.status(owner).optInt("level"))); return;
                case "start": {
                    if (!permissions.ensure(Manifest.permission.RECORD_AUDIO)
                            || context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        reply.error("microphone not allowed"); return;
                    }
                    if (Build.VERSION.SDK_INT >= 33) permissions.ensure(Manifest.permission.POST_NOTIFICATIONS); // optional: the notification shows either way on older phones
                    if (RecorderService.active() != null) { reply.error("busy"); return; }
                    String take = RecorderService.start(context, params.optString("id", ""), params.optString("kind"), params.optString("ref"), owner);
                    reply.ok(new JSONObject().put("id", take));
                    return;
                }
                case "pause":
                    if (!RecorderService.owns(id, owner)) { reply.error("not recording"); return; }
                    RecorderService.pause(params.optBoolean("on", true));
                    reply.ok(RecorderService.status(owner));
                    return;
                case "stop":
                case "cancel": {
                    if (!RecorderService.owns(id, owner)) {
                        // Already ended (notification Stop, mic lost): describe what custody holds.
                        JSONObject kept = store.owned(id, owner);
                        if (kept == null) { reply.error("unknown take"); return; }
                        if ("cancel".equals(method)) { reply.ok(new JSONObject().put("released", false)); return; }
                        for (JSONObject t : store.pending(RecorderService.active(), owner, System.currentTimeMillis()))
                            if (id.equals(t.optString("id"))) { reply.ok(t); return; }
                        reply.error("unknown take");
                        return;
                    }
                    JSONObject t = RecorderService.end(context, id, "stop".equals(method) ? "stopped" : "cancelled");
                    if (t == null) { reply.error("unknown take"); return; }
                    reply.ok("cancel".equals(method) ? new JSONObject().put("released", t.optBoolean("released")) : t);
                    return;
                }
                case "pending":
                    reply.ok(TakeStore.json(store.pending(RecorderService.active(), owner, System.currentTimeMillis())));
                    return;
                case "read": {
                    JSONObject c = store.chunk(id, owner, params.optLong("offset", -1));
                    if (c == null) reply.error("unknown take"); else reply.ok(c);
                    return;
                }
                case "ack":
                    reply.ok(new JSONObject().put("released", store.ack(id, owner, RecorderService.active())));
                    return;
                default:
                    reply.error("unknown method");
            }
        } catch (IOException e) {
            reply.error(String.valueOf(e.getMessage()));
        } catch (Exception e) {
            reply.error("Something went wrong");
        }
    }
}
