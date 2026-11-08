package ai.wizards.os.apps;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * In-memory install status, kept per Wizard origin. The phone process outlives a Connect / Change Wizard, so a
 * single shared map would show Wizard A's pending install to Wizard B (#371). Each install is recorded under the
 * origin it was started for, and a Wizard only ever reads its own entries. Plain Java (org.json only) so it is
 * unit-tested on the JVM.
 */
final class InstallStates {
    static final long KEEP_FINISHED_MS = 30 * 60_000L;
    static final long BUSY_MS = 10 * 60_000L;

    private final Map<String, JSONObject> byOwner = new HashMap<>();

    private static String key(String owner) { return owner == null ? "" : owner; }

    /** Records {@code pkg → state} for {@code owner}; returns a copy of the new entry. Old finished entries go. */
    synchronized JSONObject put(String owner, String pkg, String state, long now, Object... kv) throws JSONException {
        JSONObject o = new JSONObject().put("package", pkg).put("state", state).put("at", now);
        for (int i = 0; i + 1 < kv.length; i += 2) o.put(String.valueOf(kv[i]), kv[i + 1]);
        JSONObject mine = byOwner.get(key(owner));
        if (mine == null) { mine = new JSONObject(); byOwner.put(key(owner), mine); }
        mine.put(pkg, o);
        prune(now);
        return new JSONObject(o.toString());
    }

    /** A copy of {@code owner}'s entries only (never another Wizard's). */
    synchronized JSONObject snapshot(String owner) {
        JSONObject mine = byOwner.get(key(owner));
        try { return mine == null ? new JSONObject() : new JSONObject(mine.toString()); }
        catch (JSONException e) { return new JSONObject(); }
    }

    synchronized JSONObject get(String owner, String pkg) {
        JSONObject mine = byOwner.get(key(owner));
        JSONObject o = mine == null ? null : mine.optJSONObject(pkg);
        try { return o == null ? null : new JSONObject(o.toString()); } catch (JSONException e) { return null; }
    }

    /** {@code owner} already has this package on its way (so a second tap doesn't start a second download). */
    synchronized boolean busy(String owner, String pkg, long now) {
        JSONObject o = get(owner, pkg);
        if (o == null) return false;
        String s = o.optString("state");
        return ("downloading".equals(s) || "installing".equals(s) || "confirm".equals(s)) && now - o.optLong("at") < BUSY_MS;
    }

    private void prune(long now) {
        long cut = now - KEEP_FINISHED_MS;
        for (Iterator<Map.Entry<String, JSONObject>> owners = byOwner.entrySet().iterator(); owners.hasNext(); ) {
            JSONObject m = owners.next().getValue();
            for (Iterator<String> it = m.keys(); it.hasNext(); ) {
                JSONObject x = m.optJSONObject(it.next());
                if (x != null && x.optLong("at") < cut && !"downloading".equals(x.optString("state")) && !"installing".equals(x.optString("state"))) it.remove();
            }
            if (m.length() == 0) owners.remove();
        }
    }
}
