package ai.wizards.os.identity;

import android.app.Activity;
import android.content.Intent;

import org.json.JSONObject;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Hands one request from the bridge to IdentityActivity and its answer back. Same process only (activity not exported). */
public final class IdentityHub {
    public interface Answer { void done(JSONObject result, String error); }

    static final String EXTRA_ID = "ai.wizards.os.identity.ID";
    static final String EXTRA_MODE = "ai.wizards.os.identity.MODE";
    static final String EXTRA_EVENT = "ai.wizards.os.identity.EVENT";
    static final String EXTRA_ASKED = "ai.wizards.os.identity.ASKED";
    public static final String MODE_SETUP = "setup", MODE_SIGN = "sign";
    /** A sign request must be approved within this long of being asked. */
    public static final long SIGN_TTL_MS = 120_000;

    private static final Map<String, Answer> waiting = new ConcurrentHashMap<>();
    private static volatile String signing; // one sign sheet at a time
    private static int seq;

    private IdentityHub() {}

    public static synchronized void open(Activity from, String mode, JSONObject event, Answer a) {
        if (MODE_SIGN.equals(mode) && signing != null) { a.done(null, "busy"); return; }
        String id = "w" + (++seq) + "-" + System.nanoTime();
        waiting.put(id, a);
        if (MODE_SIGN.equals(mode)) signing = id;
        Intent i = new Intent(from, IdentityActivity.class)
                .putExtra(EXTRA_ID, id).putExtra(EXTRA_MODE, mode)
                .putExtra(EXTRA_ASKED, System.currentTimeMillis());
        if (event != null) i.putExtra(EXTRA_EVENT, event.toString());
        from.startActivity(i);
    }

    static void finish(String id, JSONObject result, String error) {
        if (id == null) return;
        if (id.equals(signing)) signing = null;
        Answer a = waiting.remove(id);
        if (a != null) a.done(result, error);
    }

    /** Listeners told when the identity changes (created, imported, backed up, removed). */
    public interface Changed { void changed(); }
    private static final java.util.Set<Changed> changed = java.util.Collections.newSetFromMap(new ConcurrentHashMap<>());
    public static void listen(Changed c) { changed.add(c); }
    public static void unlisten(Changed c) { changed.remove(c); }
    static void notifyChanged() { for (Changed c : changed) c.changed(); }
}
