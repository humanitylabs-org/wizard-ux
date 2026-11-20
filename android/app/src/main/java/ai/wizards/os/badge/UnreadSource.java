package ai.wizards.os.badge;

import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;

import ai.wizards.os.device.Http;

/**
 * Asks the Messenger service for one number: read-only {@code GET api/unread} (wizard-messenger#296), which returns
 * only a count, never names, ids or text. It answers 404 while Messenger's {@code unread-count} switch is off, which
 * clears the badge; other failures leave it as it is.
 */
final class UnreadSource {
    private UnreadSource() {}
    static final String PATH = "/apps/messenger/api/unread";

    /** @return the unread total, or -1 when it could not be read. Network: off the main thread. */
    static int fetch(String origin) {
        if (origin == null || origin.isEmpty()) return -1;
        try {
            JSONObject reply = Http.json("GET", origin + PATH, origin, null, null);
            return UnreadParse.total(reply);
        } catch (Http.Error e) {
            Log.i(UnreadBadges.TAG, "unread unavailable: HTTP " + e.status);
            return UnreadParse.forStatus(e.status);
        } catch (IOException e) {
            Log.i(UnreadBadges.TAG, "unread unavailable");
        }
        return -1;
    }
}
