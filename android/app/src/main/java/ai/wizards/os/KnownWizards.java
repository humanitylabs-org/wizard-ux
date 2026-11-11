package ai.wizards.os;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Wizards this app has been connected to through Connect / Change Wizard, with each one's name once its own shell
 * told us (wizard-ux issue 1237). The shell's switcher adds them to the owner's saved Wizards, so the owner never has to
 * know or type another Wizard's address. Stored as a JSON array of {url, name}; pure and unit-tested.
 */
public final class KnownWizards {
    static final int MAX = 20, NAME = 60;
    private KnownWizards() {}

    private static JSONArray read(String json) {
        try { return json == null ? new JSONArray() : new JSONArray(json); } catch (JSONException e) { return new JSONArray(); }
    }
    private static String clean(String name) {
        if (name == null) return "";
        String n = name.replaceAll("[\\u0000-\\u001f\\u007f]", " ").trim();
        return n.length() > NAME ? n.substring(0, NAME).trim() : n;
    }

    /** Remembers an origin (most recent last), keeping a name it already has. Null or empty origins are ignored. */
    public static String add(String json, String origin) {
        JSONArray in = read(json), out = new JSONArray();
        if (origin == null || origin.isEmpty()) return in.toString();
        String name = "";
        for (int i = 0; i < in.length(); i++) {
            JSONObject o = in.optJSONObject(i);
            if (o == null || o.optString("url").isEmpty()) continue;
            if (o.optString("url").equals(origin)) { name = o.optString("name"); continue; }
            out.put(o);
        }
        try { out.put(new JSONObject().put("url", origin).put("name", name)); } catch (JSONException ignored) {}
        while (out.length() > MAX) out.remove(0);
        return out.toString();
    }

    /** Sets the name of a remembered origin (adding it when new). */
    public static String name(String json, String origin, String name) {
        String n = clean(name);
        JSONArray list = read(add(json, origin));
        if (n.isEmpty()) return list.toString();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && o.optString("url").equals(origin)) try { o.put("name", n); } catch (JSONException ignored) {}
        }
        return list.toString();
    }

    /** Installs from before this list remember only the previous Wizard: keep it too, as the oldest entry. */
    public static String withPrevious(String json, String previous) {
        JSONArray in = read(json);
        if (previous == null || previous.isEmpty()) return in.toString();
        for (int i = 0; i < in.length(); i++) { JSONObject o = in.optJSONObject(i); if (o != null && o.optString("url").equals(previous)) return in.toString(); }
        JSONArray out = new JSONArray();
        try { out.put(new JSONObject().put("url", previous).put("name", "")); } catch (JSONException ignored) {}
        for (int i = 0; i < in.length() && out.length() < MAX; i++) out.put(in.opt(i));
        return out.toString();
    }

    /** Every remembered Wizard except the current one, as [{url, name}] for the shell. */
    public static String others(String json, String current) {
        JSONArray in = read(json), out = new JSONArray();
        for (int i = 0; i < in.length(); i++) {
            JSONObject o = in.optJSONObject(i);
            if (o == null || o.optString("url").isEmpty() || o.optString("url").equals(current)) continue;
            try { out.put(new JSONObject().put("url", o.optString("url")).put("name", o.optString("name"))); } catch (JSONException ignored) {}
        }
        return out.toString();
    }
}
