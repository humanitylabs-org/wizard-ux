package ai.wizards.os.audio;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Which microphone Wizard OS records from, per phone (James, 18 Oct 2026).
 *
 * Default is the phone's own mic, so a Bluetooth speaker never hijacks a voice note. The person can choose otherwise
 * in Settings → Microphone without a native update: the page reads and writes this policy through
 * {@code WizardOSDevice.micPolicy()} / {@code setMicPolicy(json)}, and every recorder honours it at start.
 *
 * Policy JSON (versioned so the Settings page can grow without a native rebuild):
 * <pre>
 *   {"v":1, "mode":"phone"}                                   phone's mic only (default)
 *   {"v":1, "mode":"any"}                                     whatever Android routes to, Bluetooth included
 *   {"v":1, "mode":"prefer", "prefer":[{"type":"bluetooth_sco","name":"Jabra Elite","address":"AA:BB…"}, …]}
 *                                                             listed mics first, in order, when connected;
 *                                                             otherwise the phone's mic, never another device
 * </pre>
 * An entry matches a connected input on type plus address (when both have one) or product name. Unknown modes and
 * unreadable JSON fall back to "phone": the safe default is never lost to a bad write.
 */
public final class MicPolicy {
    public static final String PHONE = "phone", ANY = "any", PREFER = "prefer";
    static final String PREFS = "wizard_mic", KEY = "policy";
    public static final int VERSION = 1, MAX_PREFER = 8;

    public final String mode;
    public final List<Input> prefer;

    private MicPolicy(String mode, List<Input> prefer) { this.mode = mode; this.prefer = prefer; }

    public static final MicPolicy DEFAULT = new MicPolicy(PHONE, new ArrayList<>());

    /** A microphone as policy and pages see it. {@code type} uses {@link MicRoute#typeName} names. */
    public static final class Input {
        public final String type, name, address;
        public Input(String type, String name, String address) {
            this.type = type == null ? "" : type;
            this.name = name == null ? "" : name.trim();
            this.address = address == null ? "" : address.trim();
        }
        boolean matches(Input other) {
            if (other == null || !type.equals(other.type)) return false;
            if (!address.isEmpty() && !other.address.isEmpty()) return address.equalsIgnoreCase(other.address);
            return !name.isEmpty() && name.equalsIgnoreCase(other.name);
        }
        public boolean builtIn() { return "builtin_mic".equals(type); }
        JSONObject json() {
            JSONObject o = new JSONObject();
            try { o.put("type", type).put("name", name).put("address", address); } catch (Exception ignored) { }
            return o;
        }
    }

    /** Reads a policy; anything unreadable is the default. */
    public static MicPolicy parse(String json) {
        if (json == null || json.trim().isEmpty()) return DEFAULT;
        try {
            JSONObject o = new JSONObject(json);
            String mode = o.optString("mode", PHONE);
            if (ANY.equals(mode)) return new MicPolicy(ANY, new ArrayList<>());
            if (!PREFER.equals(mode)) return DEFAULT;
            List<Input> list = new ArrayList<>();
            JSONArray a = o.optJSONArray("prefer");
            for (int i = 0; a != null && i < a.length() && list.size() < MAX_PREFER; i++) {
                JSONObject p = a.optJSONObject(i);
                if (p == null) continue;
                Input in = new Input(p.optString("type"), p.optString("name"), p.optString("address"));
                if (!in.type.isEmpty() && (!in.name.isEmpty() || !in.address.isEmpty())) list.add(in);
            }
            return list.isEmpty() ? DEFAULT : new MicPolicy(PREFER, list);
        } catch (Exception e) {
            return DEFAULT;
        }
    }

    public String json() {
        JSONObject o = new JSONObject();
        try {
            o.put("v", VERSION).put("mode", mode);
            if (PREFER.equals(mode)) { JSONArray a = new JSONArray(); for (Input p : prefer) a.put(p.json()); o.put("prefer", a); }
        } catch (Exception ignored) { }
        return o.toString();
    }

    /**
     * The connected input to pin, as an index into {@code inputs}, or -1 for "leave Android's route" (mode any, or
     * no built-in mic reported). Phone mode and an unmatched prefer list pick the built-in mic.
     */
    public int target(List<Input> inputs) {
        if (ANY.equals(mode) || inputs == null) return -1;
        if (PREFER.equals(mode))
            for (Input want : prefer)
                for (int i = 0; i < inputs.size(); i++) if (want.matches(inputs.get(i))) return i;
        for (int i = 0; i < inputs.size(); i++) if (inputs.get(i).builtIn()) return i;
        return -1;
    }

    /**
     * Whether a started recording may continue. {@code routed} is what Android reports (null: not said yet);
     * {@code target} is what {@link #target} chose (null: none). Results: "allowed" (mode any), "builtin",
     * "chosen" (a preferred mic), "system" (no target to hold to), "unknown", or "external" (refuse).
     */
    public String verdict(Input routed, Input target) {
        if (ANY.equals(mode)) return "allowed";
        if (target == null) return MicRoute.SYSTEM;
        if (routed == null || routed.type.isEmpty() || "unknown".equals(routed.type)) return MicRoute.UNKNOWN;
        if (routed.builtIn()) return MicRoute.BUILTIN;
        if (!target.builtIn() && (target.matches(routed) || routed.type.equals(target.type) && routed.address.isEmpty() && routed.name.isEmpty()))
            return "chosen";
        return MicRoute.EXTERNAL;
    }

    /* ---- storage ---- */

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public static MicPolicy load(Context c) {
        try { return parse(prefs(c).getString(KEY, null)); } catch (RuntimeException e) { return DEFAULT; }
    }

    /** Stores a policy from the page. Returns the normalised policy actually saved (the default for bad input). */
    public static MicPolicy save(Context c, String json) {
        MicPolicy p = parse(json);
        prefs(c).edit().putString(KEY, p.json()).apply();
        return p;
    }
}
