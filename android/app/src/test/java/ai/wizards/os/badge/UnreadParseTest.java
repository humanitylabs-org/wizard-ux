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
}
