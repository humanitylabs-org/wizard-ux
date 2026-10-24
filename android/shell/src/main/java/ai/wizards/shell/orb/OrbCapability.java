package ai.wizards.shell.orb;

import android.content.Context;

import org.json.JSONObject;

import ai.wizards.shell.device.DevicePort;

/**
 * device.orb v1: the floating orb over other apps.
 *
 *   status  → {on, permitted, visible}
 *   enable  → status; when Android's "Display over other apps" isn't allowed yet, the app first explains and then
 *             opens that system screen ({@code asking: true}); the orb turns on when the owner comes back allowed
 *   disable → status
 *
 * The orb's voice uses device.recording: its takes are marked {@code send} and the Wizard's page sends them.
 */
public final class OrbCapability implements DevicePort.Adapter {
    public interface Ask { void overlayPermission(); }

    private final Context context;
    private final Ask ask;

    public OrbCapability(Context context, Ask ask) {
        this.context = context.getApplicationContext();
        this.ask = ask;
    }

    @Override public String name() { return "device.orb"; }
    @Override public int version() { return 1; }
    @Override public String[] methods() { return new String[]{"status", "enable", "disable"}; }

    private JSONObject status() throws org.json.JSONException {
        return new JSONObject().put("on", OrbService.wanted(context)).put("permitted", OrbService.permitted(context))
                .put("visible", OrbService.visible());
    }

    @Override public void call(String method, JSONObject params, DevicePort.Reply reply) {
        try {
            switch (method) {
                case "status": reply.ok(status()); return;
                case "enable":
                    if (!OrbService.permitted(context)) { ask.overlayPermission(); reply.ok(status().put("asking", true)); return; }
                    OrbService.setWanted(context, true);
                    reply.ok(status());
                    return;
                case "disable":
                    OrbService.setWanted(context, false);
                    reply.ok(status());
                    return;
                default:
                    reply.error("unknown method");
            }
        } catch (Exception e) {
            reply.error("Something went wrong");
        }
    }
}
