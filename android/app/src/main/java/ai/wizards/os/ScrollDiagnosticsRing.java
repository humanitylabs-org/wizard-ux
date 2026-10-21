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
        String prefix="{\"schema\":1,\"session\":"+(session==null?"{}":session.toString())+",\"events\":[";
        int remaining=240*1024-prefix.getBytes(java.nio.charset.StandardCharsets.UTF_8).length-2;
        ArrayDeque<String> selected=new ArrayDeque<>();
        // Walk newest first and serialize each event once (no quadratic UI-thread trimming).
        java.util.Iterator<JSONObject> it=events.descendingIterator();
        while(it.hasNext()) {
            String e=it.next().toString();
            int bytes=e.getBytes(java.nio.charset.StandardCharsets.UTF_8).length+(selected.isEmpty()?0:1);
            if(bytes>remaining)break;
            selected.addFirst(e);remaining-=bytes;
        }
        return prefix+String.join(",",selected)+"]}";
    }
}
