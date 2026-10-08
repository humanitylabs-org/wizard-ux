package ai.wizards.os.assist;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What you told the Wizard from the lock screen, kept in app-private storage on the phone.
 * Read back only after the real Android keyguard has been dismissed.
 * Test build: these are saved for Archimedes; delivery to Wizard is the next slice.
 */
final class CaptureStore {
    private static final String PREFS = "captures";
    private static final String KEY = "items";
    private static final int MAX = 50;
    private final SharedPreferences prefs;

    CaptureStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized void add(String text, long at) {
        JSONArray next = new JSONArray();
        try {
            JSONObject o = new JSONObject();
            o.put("text", text);
            o.put("at", at);
            next.put(o);
            JSONArray old = load();
            for (int i = 0; i < old.length() && next.length() < MAX; i++) next.put(old.get(i));
        } catch (JSONException ignored) {
            // A malformed old list is dropped rather than blocking a new capture.
        }
        prefs.edit().putString(KEY, next.toString()).apply();
    }

    synchronized String json() {
        return load().toString();
    }

    private JSONArray load() {
        try {
            return new JSONArray(prefs.getString(KEY, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
