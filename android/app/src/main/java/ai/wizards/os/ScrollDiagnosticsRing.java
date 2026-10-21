package ai.wizards.os;

import java.util.ArrayDeque;
import org.json.JSONArray;
import org.json.JSONObject;

/** Pure-Java bounded recorder. Callers supply only allowlisted, content-free fields. */
final class ScrollDiagnosticsRing {
    static final int CAPACITY = 400;
    private final ArrayDeque<JSONObject> events = new ArrayDeque<>();
    private long sequence;
    synchronized void add(long uptime, String thread, String method, JSONObject data, JSONArray stack) {
        JSONObject e = new JSONObject();
        try {
            e.put("seq", ++sequence).put("uptimeMs", uptime).put("thread", thread)
                .put("method", method).put("data", data);
            if (stack != null) e.put("callers", stack);
        } catch (org.json.JSONException impossible) { throw new IllegalArgumentException(impossible); }
        if (events.size() == CAPACITY) events.removeFirst();
        events.addLast(e);
    }
    synchronized long sequence() { return sequence; }
    synchronized int size() { return events.size(); }
    synchronized String json(JSONObject session) {
        try {
            JSONArray a = new JSONArray();
            for (JSONObject e : events) a.put(e);
            JSONObject out = new JSONObject().put("schema", 1).put("session", session).put("events", a);
            // Bound UTF-8 bytes as well as count, keeping the newest probes.
            while (out.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 240 * 1024 && a.length() > 0)
                a.remove(0);
            return out.toString();
        } catch (org.json.JSONException impossible) { throw new IllegalArgumentException(impossible); }
    }
}
