package ai.wizards.os.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.HashSet;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/* Phone notifications per app (wizard-ux issue 1567, on for everyone). */
public class AppNotifyPolicyTest {
    static JSONObject item(String id, double time, String title, int priority, String... tags) throws Exception {
        JSONObject o = new JSONObject().put("id", id).put("time", time).put("title", title).put("message", "Body of " + id).put("priority", priority);
        JSONArray t = new JSONArray();
        for (String s : tags) t.put(s);
        return o.put("tags", t);
    }

    @Test
    public void anItemBelongsToItsTaggedApp() throws Exception {
        assertEquals("messenger", AppNotifyPolicy.appOf(item("a", 1, "x", 3, "cron", "app:messenger")));
        assertEquals("wizard-mail", AppNotifyPolicy.appOf(new JSONObject().put("from", "wizard-mail")));
        assertEquals("notifications", AppNotifyPolicy.appOf(item("a", 1, "x", 3, "app:Not Valid")));
        assertEquals("notifications", AppNotifyPolicy.appOf(new JSONObject().put("from", "../etc")));
    }

    @Test
    public void theFirstReadPostsNothingAndOnlyMovesTheWatermark() throws Exception {
        JSONArray items = new JSONArray().put(item("a", 100, "Old", 4, "app:messenger")).put(item("b", 90, "Older", 4));
        AppNotifyPolicy.Pass p = AppNotifyPolicy.pass(items, null, -1, new HashSet<>());
        assertEquals(0, p.post.size());
        assertEquals(100, p.since, 0);
    }

    @Test
    public void newItemsArePostedNewestFirstUnderTheirOwnApps() throws Exception {
        JSONArray items = new JSONArray()
                .put(item("m1", 110, "Ana: lunch?", 3, "app:messenger"))
                .put(item("c1", 120, "Reply ready", 3, "app:chats"))
                .put(item("old", 100, "Seen before", 3, "app:messenger"));
        AppNotifyPolicy.Pass p = AppNotifyPolicy.pass(items, null, 100, new HashSet<>());
        assertEquals(2, p.post.size());
        assertEquals("c1", p.post.get(0).id);
        assertEquals("chats", p.post.get(0).app);
        assertEquals("messenger", p.post.get(1).app);
        assertEquals(120, p.since, 0);
        assertTrue(!AppNotifyPolicy.channelId("messenger").equals(AppNotifyPolicy.channelId("chats")));
    }

    @Test
    public void quietReadOffAndAlreadyPostedItemsStayOffThePhone() throws Exception {
        JSONArray items = new JSONArray()
                .put(item("quiet", 110, "All clear", 2, "cron", "app:sniper"))
                .put(item("read", 111, "Read", 3, "app:messenger").put("read", true))
                .put(item("archived", 112, "Done", 3).put("archived", true))
                .put(item("muted", 113, "Sale", 3, "app:second-hand"))
                .put(item("dup", 114, "Twice", 3, "app:messenger"))
                .put(item("ok", 115, "Hi", 3, "app:messenger"));
        JSONObject routes = new JSONObject().put("second-hand", "off").put("messenger", "badge");
        Set<String> posted = new HashSet<>();
        posted.add("dup");
        AppNotifyPolicy.Pass p = AppNotifyPolicy.pass(items, routes, 100, posted);
        assertEquals(1, p.post.size());
        assertEquals("ok", p.post.get(0).id);
        assertEquals(115, p.since, 0);
    }

    @Test
    public void theMorningReportLevelAndSystemNotesStayOffThePhone() throws Exception {
        JSONArray items = new JSONArray()
                .put(item("agent", 120, "Hermes release review", 3))
                .put(item("sys", 121, "3 apps updated", 3))
                .put(item("systag", 122, "Something", 3, "wizard-system", "connections"))
                .put(item("app", 123, "Ana: lunch?", 3, "app:messenger"));
        JSONObject routes = new JSONObject().put("notifications", "daily");
        AppNotifyPolicy.Pass p = AppNotifyPolicy.pass(items, routes, 100, new HashSet<>());
        assertEquals(1, p.post.size());
        assertEquals("app", p.post.get(0).id);
        // A System kind the owner moved to Chats does reach the phone.
        p = AppNotifyPolicy.pass(items, new JSONObject().put("system:app-updates", "chats"), 100, new HashSet<>());
        assertEquals(3, p.post.size());
    }

    @Test
    public void anItemThatNeedsTheOwnerFollowsNotificationsLevel() throws Exception {
        JSONObject urgent = item("u", 120, "Payment failed", 4, "app:second-hand");
        assertEquals("notifications", AppNotifyPolicy.routeOf(urgent));
        assertEquals("second-hand", AppNotifyPolicy.appOf(urgent));
        JSONArray items = new JSONArray().put(urgent);
        assertEquals(1, AppNotifyPolicy.pass(items, new JSONObject().put("second-hand", "off"), 100, new HashSet<>()).post.size());
        assertEquals(0, AppNotifyPolicy.pass(items, new JSONObject().put("notifications", "off"), 100, new HashSet<>()).post.size());
    }

    @Test
    public void aBacklogIsCappedPerRead() throws Exception {
        JSONArray items = new JSONArray();
        for (int i = 0; i < 12; i++) items.put(item("n" + i, 200 + i, "N" + i, 3, "app:messenger"));
        AppNotifyPolicy.Pass p = AppNotifyPolicy.pass(items, null, 100, new HashSet<>());
        assertEquals(AppNotifyPolicy.MAX_PER_PASS, p.post.size());
        assertEquals("n11", p.post.get(0).id);
        assertEquals(211, p.since, 0);
    }

    @Test
    public void channelsAreNamedAfterTheApp() throws Exception {
        JSONObject names = new JSONObject().put("messenger", "Messenger");
        assertEquals("Messenger", AppNotifyPolicy.channelName("messenger", names));
        assertEquals("Mail", AppNotifyPolicy.channelName("wizard-mail", names));
        assertEquals("Second hand", AppNotifyPolicy.channelName("second-hand", null));
        assertEquals("Notifications", AppNotifyPolicy.channelName("notifications", null));
        assertEquals("app-messenger", AppNotifyPolicy.channelId("messenger"));
    }

    @Test
    public void aTapOpensTheItemOnThisWizardOrElseTheApp() {
        String o = "https://box.example.ts.net";
        assertEquals(o + "/messenger/?chat=42", AppNotifyPolicy.target(o, "/messenger/?chat=42", "messenger"));
        assertEquals(o + "/messenger/#c42", AppNotifyPolicy.target(o + "/", o + "/messenger/#c42", "messenger"));
        assertEquals(o + "/wizard-os-home/?open=messenger", AppNotifyPolicy.target(o, "https://evil.example/x", "messenger"));
        assertEquals(o + "/wizard-os-home/?open=messenger", AppNotifyPolicy.target(o, o + ".evil.example/x", "messenger"));
        assertEquals(o + "/wizard-os-home/?open=messenger", AppNotifyPolicy.target(o, "//evil.example/x", "messenger"));
        assertEquals(o + "/wizard-os-home/?open=messenger", AppNotifyPolicy.target(o, "javascript:alert(1)", "messenger"));
        assertEquals(o + "/wizard-os-home/?open=notifications", AppNotifyPolicy.target(o, "", "notifications"));
    }

    /* Chat replies as Chats notifications (wizard-ux issue 1619, switch wizard/phone-chat-replies). */
    static JSONObject reply(String id, double time, String link, String... tags) throws Exception {
        return item(id, time, "Trip plan", 3, tags).put("link", link).put("from", "chats");
    }

    @Test
    public void aChatReplyTheBoxPostedOpensItsThreadUnderChats() throws Exception {
        String link = "https://box.example.ts.net:8796/wizard-os-home/?session=20261126_010203_ab12";
        JSONArray items = new JSONArray()
                .put(reply("r1", 200, link, "app:chats", "chat-reply"))
                .put(item("m1", 190, "Carlos", 3, "app:messenger"));
        AppNotifyPolicy.Pass p = AppNotifyPolicy.pass(items, new JSONObject(), 100, new HashSet<>());
        assertEquals(2, p.post.size());
        assertEquals("chats", p.post.get(0).app);
        assertEquals("app-chats", AppNotifyPolicy.channelId(p.post.get(0).app));
        assertEquals("Chats", AppNotifyPolicy.channelName("chats", null));
        assertEquals("20261126_010203_ab12", p.post.get(0).thread);
        assertEquals(null, p.post.get(1).thread); // any other app keeps opening its link or the app
    }

    @Test
    public void onlyATaggedChatsReplyWithAValidThreadCarriesOne() throws Exception {
        String o = "https://box.example.ts.net/wizard-os-home/";
        assertEquals("abc", AppNotifyPolicy.threadOf(reply("a", 1, o + "?view=chats&session=abc", "app:chats", "chat-reply")));
        assertEquals(null, AppNotifyPolicy.threadOf(reply("a", 1, o + "?session=a%20b", "app:chats", "chat-reply")));
        assertEquals(null, AppNotifyPolicy.threadOf(reply("a", 1, o + "?session=abc", "app:chats"))); // not a box reply
        assertEquals(null, AppNotifyPolicy.threadOf(reply("a", 1, o + "?session=abc", "app:messenger", "chat-reply")));
        assertEquals(null, AppNotifyPolicy.threadOf(reply("a", 1, o + "?session=..", "app:chats", "chat-reply")));
        assertEquals(null, AppNotifyPolicy.threadOf(reply("a", 1, o, "app:chats", "chat-reply")));
        assertEquals(null, AppNotifyPolicy.threadOf(reply("a", 1, o + "?session=" + "x".repeat(181), "app:chats", "chat-reply")));
    }

    @Test
    public void chatsSetToOffInNotificationsKeepsRepliesOffThePhone() throws Exception {
        JSONArray items = new JSONArray().put(reply("r1", 200, "https://b.example/wizard-os-home/?session=s1", "app:chats", "chat-reply"));
        assertEquals(0, AppNotifyPolicy.pass(items, new JSONObject().put("chats", "off"), 100, new HashSet<>()).post.size());
    }
}
