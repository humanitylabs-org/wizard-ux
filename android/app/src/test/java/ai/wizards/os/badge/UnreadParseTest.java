package ai.wizards.os.badge;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public class UnreadParseTest {
    @Test public void readsEnvelopeAndBareShapes() throws Exception {
        assertEquals(12, UnreadParse.total(new JSONObject("{\"ok\":true,\"result\":{\"unread_total\":12}}")));
        assertEquals(0, UnreadParse.total(new JSONObject("{\"unread_total\":0}")));
    }
    @Test public void anythingElseIsUnknownNotZero() throws Exception {
        assertEquals(-1, UnreadParse.total(null));
        assertEquals(-1, UnreadParse.total(new JSONObject("{}")));
        assertEquals(-1, UnreadParse.total(new JSONObject("{\"unread_total\":\"3\"}")));
        assertEquals(-1, UnreadParse.total(new JSONObject("{\"unread_total\":-4}")));
        assertEquals(-1, UnreadParse.total(new JSONObject("{\"ok\":false,\"error\":{\"code\":\"locked\"}}")));
    }
    @Test public void hugeCountsAreBounded() throws Exception {
        assertEquals(BadgeText.MAX_STORED, UnreadParse.total(new JSONObject("{\"unread_total\":99999999999}")));
    }
    @Test public void switchOffClearsButOtherFailuresKeepTheBadge() {
        String off = "{\"ok\":false,\"error\":{\"code\":\"not_found\",\"message\":\"No such route\"}}";
        assertEquals("Messenger's own 404: its unread-count switch is off", 0, UnreadParse.forStatus(404, off));
        assertEquals("top-level code shape", 0, UnreadParse.forStatus(404, "{\"ok\":false,\"code\":\"not_found\"}"));
        assertEquals("a proxy's plain-text 404 (wrong path) is unknown, not zero", -1, UnreadParse.forStatus(404, "404 page not found"));
        assertEquals("empty 404 body is unknown", -1, UnreadParse.forStatus(404, ""));
        assertEquals("null body is unknown", -1, UnreadParse.forStatus(404, null));
        for (int status : new int[]{0, 401, 403, 423, 500, 502, 503}) assertEquals(status + " is unknown", -1, UnreadParse.forStatus(status, off));
    }
    @Test public void routeIsMessengersViewPathNotTheRetiredAppsDirectory() throws Exception {
        java.lang.reflect.Field f = Class.forName("ai.wizards.os.badge.UnreadSource").getDeclaredField("PATH"); f.setAccessible(true);
        assertEquals("/messenger/api/unread", f.get(null));
    }
}
