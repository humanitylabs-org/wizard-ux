package ai.wizards.os.usuals;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** James's usuals, on this phone only: name, the app, the taps that build the basket, what it cost last time. */
public final class UsualsStore {
    private static final String PREFS = "usuals", KEY = "list";

    public static final class Usual {
        public String id = "", name = "", pkg = UsualsPolicy.GRAB, lastTotal = "", lastRun = "", lastResult = "";
        public long lastRunAt;
        public List<UsualsPolicy.Step> steps = new ArrayList<>();

        JSONObject toJson() throws JSONException {
            JSONArray st = new JSONArray();
            for (UsualsPolicy.Step s : steps) st.put(new JSONObject().put("type", s.type).put("label", s.label).put("id", s.id)
                    .put("near", s.near).put("x", (double) s.x).put("y", (double) s.y));
            return new JSONObject().put("id", id).put("name", name).put("pkg", pkg).put("lastTotal", lastTotal)
                    .put("lastRun", lastRun).put("lastResult", lastResult).put("lastRunAt", lastRunAt).put("steps", st)
                    .put("script", UsualsPolicy.write(steps));
        }

        static Usual fromJson(JSONObject o) {
            Usual u = new Usual();
            u.id = o.optString("id"); u.name = o.optString("name"); u.pkg = o.optString("pkg", UsualsPolicy.GRAB);
            u.lastTotal = o.optString("lastTotal"); u.lastRun = o.optString("lastRun"); u.lastResult = o.optString("lastResult");
            u.lastRunAt = o.optLong("lastRunAt");
            JSONArray st = o.optJSONArray("steps");
            if (st != null) for (int i = 0; i < st.length(); i++) {
                JSONObject s = st.optJSONObject(i);
                if (s == null) continue;
                u.steps.add(new UsualsPolicy.Step(s.optString("type"), s.optString("label"), s.optString("id"), s.optString("near"),
                        (float) s.optDouble("x", -1), (float) s.optDouble("y", -1)));
            }
            return u;
        }
    }

    private UsualsStore() { }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public static synchronized List<Usual> all(Context c) {
        List<Usual> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs(c).getString(KEY, "[]"));
            for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null) out.add(Usual.fromJson(o)); }
        } catch (JSONException ignored) { }
        return out;
    }

    public static synchronized Usual get(Context c, String id) {
        for (Usual u : all(c)) if (u.id.equals(id)) return u;
        return null;
    }

    public static synchronized void put(Context c, Usual u) {
        if (u.id == null || u.id.isEmpty()) u.id = "u-" + UUID.randomUUID().toString().substring(0, 8);
        List<Usual> list = all(c);
        boolean found = false;
        for (int i = 0; i < list.size(); i++) if (list.get(i).id.equals(u.id)) { list.set(i, u); found = true; }
        if (!found) list.add(u);
        save(c, list);
    }

    public static synchronized void delete(Context c, String id) {
        List<Usual> list = all(c);
        list.removeIf(u -> u.id.equals(id));
        save(c, list);
    }

    private static void save(Context c, List<Usual> list) {
        JSONArray a = new JSONArray();
        try { for (Usual u : list) a.put(u.toJson()); } catch (JSONException ignored) { }
        prefs(c).edit().putString(KEY, a.toString()).apply();
    }

    public static synchronized String json(Context c) {
        JSONArray a = new JSONArray();
        try { for (Usual u : all(c)) a.put(u.toJson()); } catch (JSONException ignored) { }
        return a.toString();
    }

    public static List<String> names(List<Usual> list) {
        List<String> n = new ArrayList<>();
        for (Usual u : list) n.add(u.name);
        return n;
    }
}
