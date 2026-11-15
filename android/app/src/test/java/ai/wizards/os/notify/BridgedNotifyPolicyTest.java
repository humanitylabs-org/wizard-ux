package ai.wizards.os.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Clear chat notifications (wizard-ux issue 1276): which chat app notification a Messenger read clears. */
public class BridgedNotifyPolicyTest {
    private static final String LINE = "jp.naver.line.android";

    @Test
    public void lineDirectChatByTitle() {
        BridgedNotifyPolicy.Read r = BridgedNotifyPolicy.parse("{\"network\":\"line\",\"names\":[\"Mike Tanaka\"]}");
        assertNotNull(r);
        assertTrue(BridgedNotifyPolicy.matches(r, LINE, "Mike Tanaka", null, null));
        assertTrue("case and spacing", BridgedNotifyPolicy.matches(r, LINE, "  mike   TANAKA ", null, null));
        assertFalse("another chat stays", BridgedNotifyPolicy.matches(r, LINE, "Yuki", null, null));
        assertFalse("another app's notification stays", BridgedNotifyPolicy.matches(r, "com.whatsapp", "Mike Tanaka", null, null));
        assertFalse("Wizard's own notifications stay", BridgedNotifyPolicy.matches(r, "ai.wizards.os", "Mike Tanaka", null, null));
    }

    @Test
    public void groupChatByConversationTitleOrSubText() {
        BridgedNotifyPolicy.Read r = BridgedNotifyPolicy.parse("{\"network\":\"line\",\"names\":[\"Family\"]}");
        assertTrue(BridgedNotifyPolicy.matches(r, LINE, "Mom", "Family", null));
        assertTrue(BridgedNotifyPolicy.matches(r, LINE, "Mom", null, "Family"));
        assertFalse("a sender in another group stays", BridgedNotifyPolicy.matches(r, LINE, "Mom", "Work", null));
    }

    @Test
    public void bridgeTagsAndInvisibleMarksDoNotBlockAMatch() {
        BridgedNotifyPolicy.Read r = BridgedNotifyPolicy.parse("{\"network\":\"whatsapp\",\"names\":[\"Mike (WA)\"]}");
        assertTrue(BridgedNotifyPolicy.matches(r, "com.whatsapp", "\u200EMike\u200F", null, null));
        assertTrue(BridgedNotifyPolicy.matches(r, "com.whatsapp.w4b", "Mike", null, null));
        assertEquals("mike", BridgedNotifyPolicy.norm("ＭＩＫＥ"));
        assertEquals("a name that is only a tag is kept", "(wa)", BridgedNotifyPolicy.norm("(WA)"));
    }

    @Test
    public void onlyMessageNotificationsAreCleared() {
        assertTrue(BridgedNotifyPolicy.messageLike(null, false));
        assertTrue(BridgedNotifyPolicy.messageLike("msg", false));
        assertTrue(BridgedNotifyPolicy.messageLike("social", false));
        for (String c : new String[]{"call", "missed_call", "progress", "service", "event", "reminder", "promo"}) assertFalse(c, BridgedNotifyPolicy.messageLike(c, false));
        assertFalse("an ongoing notification (a call in progress) stays", BridgedNotifyPolicy.messageLike("msg", true));
    }

    @Test
    public void refusesWhatItCannotUse() {
        assertNull(BridgedNotifyPolicy.parse(null));
        assertNull(BridgedNotifyPolicy.parse("not json"));
        assertNull("Wizard's own chats have no other app", BridgedNotifyPolicy.parse("{\"network\":\"messenger\",\"names\":[\"Mike\"]}"));
        assertNull(BridgedNotifyPolicy.parse("{\"network\":\"LINE!\",\"names\":[\"Mike\"]}"));
        assertNull(BridgedNotifyPolicy.parse("{\"network\":\"line\",\"names\":[]}"));
        assertNull(BridgedNotifyPolicy.parse("{\"network\":\"line\",\"names\":[\"  \", 3, null]}"));
        assertNull(BridgedNotifyPolicy.parse("{\"network\":\"line\"}"));
        assertFalse(BridgedNotifyPolicy.matches(null, LINE, "Mike", null, null));
    }

    @Test
    public void capsNamesAndLength() {
        StringBuilder names = new StringBuilder();
        for (int i = 0; i < 20; i++) names.append(i == 0 ? "" : ",").append("\"n").append(i).append('"');
        BridgedNotifyPolicy.Read r = BridgedNotifyPolicy.parse("{\"network\":\"telegram\",\"names\":[" + names + "]}");
        assertEquals(BridgedNotifyPolicy.MAX_NAMES, r.names.size());
        assertFalse("names past the cap are ignored", BridgedNotifyPolicy.matches(r, "org.telegram.messenger", "n12", null, null));
        String longName = "x".repeat(BridgedNotifyPolicy.MAX_NAME + 1);
        assertNull(BridgedNotifyPolicy.parse("{\"network\":\"line\",\"names\":[\"" + longName + "\"]}"));
    }

    @Test
    public void everyKnownNetworkHasItsApp() {
        for (String n : new String[]{"line", "whatsapp", "telegram", "signal", "instagram", "facebook", "slack", "kakaotalk", "twitter", "linkedin", "gmessages"}) {
            assertFalse(n, BridgedNotifyPolicy.packagesFor(n).isEmpty());
        }
        assertTrue(BridgedNotifyPolicy.packagesFor("dots").isEmpty());
        assertTrue(BridgedNotifyPolicy.packagesFor(null).isEmpty());
    }
}
