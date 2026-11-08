package ai.wizards.os.badge;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;

import ai.wizards.os.device.AppState;
import ai.wizards.os.device.Http;

/**
 * Asks the Messenger service for one number. Needs the proposed read-only {@code GET api/unread} on Messenger
 * (see the PR); it returns only a count, never names, ids or text. Until the service has it the answer is 404 and
 * the badge stays as it is.
 */
final class UnreadSource {
    private UnreadSource() {}
    static final String PATH = "/apps/messenger/api/unread";

    /** @return the unread total, or -1 when it could not be read. Network: off the main thread. */
    static int fetch(Context c) {
        String origin = AppState.origin(c);
        if (origin == null || origin.isEmpty()) return -1;
        try {
            JSONObject reply = Http.json("GET", origin + PATH, origin, null, null);
            return UnreadParse.total(reply);
        } catch (Http.Error e) {
            Log.i(UnreadBadges.TAG, "unread unavailable: HTTP " + e.status);
        } catch (IOException e) {
            Log.i(UnreadBadges.TAG, "unread unavailable");
        }
        return -1;
    }
}
