package ai.wizards.os.notify;

import org.junit.Test;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;

import static org.junit.Assert.*;

public class AppNotifyPolicyTest {
    @Test public void sseParsesTheRoutersEventsPingsAndIds() {
        AppNotifyPolicy.Sse sse = new AppNotifyPolicy.Sse();
        assertNull(sse.line("retry: 5000"));
        assertNull(sse.line(""));                                     // a retry-only block is not an event
        assertNull(sse.line("event: hello"));
        assertNull(sse.line("data: {\"type\":\"hello\",\"sid\":\"s1\",\"latest\":4}"));
        AppNotifyPolicy.Sse.Event hello = sse.line("");
        assertEquals("hello", hello.type);
        assertNull(hello.id);
        assertTrue(hello.data.contains("\"sid\":\"s1\""));
        assertNull(sse.line(": ping"));
        assertNull(sse.line(""));                                     // a ping is never an event
        sse.line("id: 5"); sse.line("event: notify"); sse.line("data: {\"a\":1}");
        AppNotifyPolicy.Sse.Event n = sse.line("");
        assertEquals("5", n.id);
        assertEquals("notify", n.type);
        assertEquals("{\"a\":1}", n.data);
        sse.line("data: line one"); sse.line("data:line two");
        AppNotifyPolicy.Sse.Event m = sse.line("");
        assertEquals("message", m.type);
        assertEquals("line one\nline two", m.data);
        assertEquals("5", m.id);                                      // SSE keeps the last id
    }

    @Test public void reconnectBackoffIsQuickThenCapped() {
        assertEquals(1_000, AppNotifyPolicy.backoff(0));
        assertTrue(AppNotifyPolicy.backoff(3) > AppNotifyPolicy.backoff(2));
        assertEquals(300_000, AppNotifyPolicy.backoff(7));
        assertEquals(300_000, AppNotifyPolicy.backoff(500));
        assertEquals(1_000, AppNotifyPolicy.backoff(-1));
    }

    @Test public void streamUrlCarriesTheCursorOnlyWhenThereIsOne() {
        String o = "https://wizard.example.ts.net:8444";
        assertEquals(o + "/notifications/api/phone/stream", AppNotifyPolicy.streamUrl(o, -1, ""));
        assertEquals(o + "/notifications/api/phone/stream", AppNotifyPolicy.streamUrl(o, 12, ""));
        assertEquals(o + "/notifications/api/phone/stream?since=12&sid=ab%26c", AppNotifyPolicy.streamUrl(o, 12, "ab&c"));
        assertEquals(o + "/notifications/api/phone/events?since=0&sid=s", AppNotifyPolicy.eventsUrl(o, 0, "s"));
    }

    @Test public void repliesOnlyGoToTheSameWizard() {
        assertEquals("/messenger/", AppNotifyPolicy.appPath("/messenger/", "messenger"));
        assertEquals("/wizard-mail/", AppNotifyPolicy.appPath("/wizard-mail", "wizard-mail"));
        for (String bad : new String[]{"https://evil.example/messenger/", "//evil.example/", "/../admin/", "/a b/", "", null, "javascript:x"})
            assertEquals(bad, "/messenger/", AppNotifyPolicy.appPath(bad, "messenger"));
        assertEquals("https://w.ts.net/messenger/api/inbox/act", AppNotifyPolicy.actUrl("https://w.ts.net", "/messenger/"));
    }

    @Test public void idsTagsAndChannels() {
        assertTrue(AppNotifyPolicy.validApp("messenger"));
        assertTrue(AppNotifyPolicy.validApp("wizard-mail"));
        assertFalse(AppNotifyPolicy.validApp("Messenger"));
        assertFalse(AppNotifyPolicy.validApp("../x"));
        assertFalse(AppNotifyPolicy.validApp(null));
        assertTrue(AppNotifyPolicy.validAction("reply"));
        assertFalse(AppNotifyPolicy.validAction("reply now"));
        assertFalse(AppNotifyPolicy.validKey(""));
        assertFalse(AppNotifyPolicy.validKey(new String(new char[201]).replace('\0', 'k')));
        assertEquals("wizapp:messenger:chat:abc", AppNotifyPolicy.tag("messenger", "chat:abc"));
        assertEquals("messenger", AppNotifyPolicy.appOfTag("wizapp:messenger:chat:abc"));
        assertNull(AppNotifyPolicy.appOfTag("reply:thread"));
        assertEquals("wizapp:messenger", AppNotifyPolicy.channel("messenger"));
        assertEquals("Wizard mail", AppNotifyPolicy.fallbackName("wizard-mail"));
    }

    @Test public void alertsOncePerNewActivityAndNeverOverWizardItself() {
        assertTrue(AppNotifyPolicy.alert(true, 1010, 1000, false));
        assertFalse("same activity again (reconnect, reset)", AppNotifyPolicy.alert(true, 1000, 1000, false));
        assertFalse("re-worded preview", AppNotifyPolicy.alert(false, 1020, 1000, false));
        assertFalse("Wizard OS is on screen", AppNotifyPolicy.alert(true, 1010, 1000, true));
    }

    @Test public void resetDropsOnlyOurNotificationsThatNoLongerWait() {
        List<String> shown = Arrays.asList("wizapp:messenger:chat:a", "wizapp:messenger:chat:b", "other-thing");
        assertEquals(Arrays.asList("wizapp:messenger:chat:b"),
                AppNotifyPolicy.stale(shown, new HashSet<>(Arrays.asList("wizapp:messenger:chat:a"))));
    }
}
