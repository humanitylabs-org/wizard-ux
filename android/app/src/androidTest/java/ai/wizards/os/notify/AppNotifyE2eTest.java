package ai.wizards.os.notify;

import android.Manifest;
import android.app.Activity;
import android.app.Instrumentation;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import ai.wizards.os.AppSessionActivity;
import ai.wizards.os.BuildConfig;
import ai.wizards.os.HomeScreenShortcuts;

import static org.junit.Assert.*;

/**
 * Per-app phone notifications against a synthetic Wizard on the emulator's loopback (debug QA origin only; no owner
 * box, no Google services involved): the real service holds the real SSE connection to a fake Notifications router,
 * posts a Messenger notification in Messenger's own channel, a tap opens Messenger's single-app session task, inline
 * Reply posts to Messenger's inbox action route as the owner, a clear from the box removes it, and after the
 * connection drops and returns the service resumes from its last event id and shows what it missed.
 */
@RunWith(AndroidJUnit4.class)
public class AppNotifyE2eTest {
    private final Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    private final Context c = inst.getTargetContext();
    private final NotificationManager nm = c.getSystemService(NotificationManager.class);
    private FakeWizard fake;

    @Before public void setUp() throws Exception {
        assertTrue(BuildConfig.DEBUG);
        if (Build.VERSION.SDK_INT >= 33)
            inst.getUiAutomation().grantRuntimePermission(c.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        c.stopService(new Intent(c, AppNotifyService.class));
        c.getSharedPreferences("app-notify", Context.MODE_PRIVATE).edit().clear().commit();
        nm.cancelAll();
        fake = new FakeWizard();
        Files.write(new File(c.getFilesDir(), "qa_home.txt").toPath(), fake.origin().getBytes(StandardCharsets.UTF_8));
    }

    @After public void tearDown() throws Exception {
        c.stopService(new Intent(c, AppNotifyService.class));
        new File(c.getFilesDir(), "qa_home.txt").delete();
        nm.cancelAll();
        if (fake != null) fake.close();
    }

    private StatusBarNotification shown(String tag, boolean want) throws InterruptedException {
        long end = System.currentTimeMillis() + 15_000;
        while (System.currentTimeMillis() < end) {
            StatusBarNotification hit = null;
            for (StatusBarNotification s : nm.getActiveNotifications()) if (tag.equals(s.getTag())) hit = s;
            if ((hit != null) == want) return hit;
            Thread.sleep(100);
        }
        fail((want ? "never shown: " : "never removed: ") + tag + " (connections=" + fake.streams.size() + ")");
        return null;
    }

    private static JSONObject notify(String key, String title, String text, long time) throws Exception {
        return new JSONObject().put("type", "notify").put("app", "messenger").put("key", key).put("title", title)
                .put("text", text).put("time", time).put("priority", 3).put("alert", true)
                .put("actions", new JSONArray()
                        .put(new JSONObject().put("id", "reply").put("label", "Reply").put("input", true))
                        .put(new JSONObject().put("id", "read").put("label", "Mark as read")));
    }

    @Test public void messengerNotifiesOpensItsSessionRepliesClearsAndCatchesUp() throws Exception {
        AppNotifyService.ensure(c);
        FakeWizard.Stream s1 = fake.nextStream(20);
        assertNotNull("the service never opened the stream", s1);
        assertEquals("first connection has no cursor", null, s1.query.get("since"));

        // 1. A Messenger message routed to Chats on the box.
        long t = System.currentTimeMillis() / 1000;
        s1.send(1, notify("chat:qa", "QA Carlos", "See you at 5", t));
        StatusBarNotification sbn = shown("wizapp:messenger:chat:qa", true);
        Notification n = sbn.getNotification();
        assertEquals("wizapp:messenger", n.getChannelId());
        NotificationChannel ch = nm.getNotificationChannel("wizapp:messenger");
        assertEquals("Messenger", ch.getName().toString());
        assertEquals(NotificationManager.IMPORTANCE_HIGH, ch.getImportance());
        assertEquals("QA Carlos", n.extras.getCharSequence(Notification.EXTRA_TITLE).toString());
        assertEquals("See you at 5", n.extras.getCharSequence(Notification.EXTRA_TEXT).toString());
        assertEquals("Messenger", n.extras.getCharSequence(Notification.EXTRA_SUB_TEXT).toString());
        assertEquals(2, n.actions.length);
        assertEquals("Reply", n.actions[0].title.toString());
        assertNotNull("inline reply", n.actions[0].getRemoteInputs());
        assertEquals("Mark as read", n.actions[1].title.toString());

        // 2. Tap it in the shade (System UI sends it, as for the owner): Messenger's own single-app session, the
        //    task a pinned Messenger icon opens.
        Instrumentation.ActivityMonitor mon = inst.addMonitor(AppSessionActivity.class.getName(), null, false);
        UiDevice device = UiDevice.getInstance(inst);
        device.openNotification();
        UiObject2 row = device.wait(Until.findObject(By.text("QA Carlos")), 15_000);
        assertNotNull("not in the notification shade", row);
        row.click();
        Activity session = inst.waitForMonitorWithTimeout(mon, 15_000);
        assertNotNull("tap did not open the app session", session);
        assertEquals(HomeScreenShortcuts.taskUri(c, "messenger"), session.getIntent().getData());
        session.finish();
        inst.removeMonitor(mon);
        device.pressHome();

        // 3. Inline Reply: posted as the owner to Messenger's inbox action route on the same Wizard.
        Intent fill = new Intent();
        Bundle typed = new Bundle();
        typed.putCharSequence(AppNotifications.REPLY_KEY, "On my way");
        RemoteInput.addResultsToIntent(n.actions[0].getRemoteInputs(), fill, typed);
        n.actions[0].actionIntent.send(c, 0, fill);
        FakeWizard.Act act = fake.acts.poll(15, TimeUnit.SECONDS);
        assertNotNull("reply never reached the app", act);
        assertEquals("/messenger/api/inbox/act", act.path);
        assertEquals(fake.origin(), act.origin);
        JSONObject body = new JSONObject(act.body);
        assertEquals("chat:qa", body.getString("key"));
        assertEquals("reply", body.getString("action"));
        assertEquals("On my way", body.getString("text"));
        shown("wizapp:messenger:chat:qa", false);

        // 4. Read somewhere else: the box clears it.
        s1.send(2, notify("chat:ana", "QA Ana", "hi", t + 1));
        shown("wizapp:messenger:chat:ana", true);
        s1.send(3, new JSONObject().put("type", "clear").put("app", "messenger").put("key", "chat:ana"));
        shown("wizapp:messenger:chat:ana", false);

        // 5. Connection lost (Tailscale off); the box keeps going; the phone resumes from its last id.
        fake.refuse = true;
        s1.close();
        Thread.sleep(2500);                                   // reconnects meet 503 while "offline"
        fake.refuse = false;
        FakeWizard.Stream s2 = fake.nextStream(60);
        assertNotNull("never reconnected", s2);
        assertEquals("3", s2.query.get("since"));
        assertEquals("qa-sid", s2.query.get("sid"));
        s2.send(4, notify("chat:ben", "QA Ben", "missed while offline", t + 2));
        shown("wizapp:messenger:chat:ben", true);
        assertTrue("reconnects were tried while offline", fake.refused.get() >= 1);
    }

    /** Connect switches to another Wizard: the old stream is dropped at once, and nothing from it shows or is answered. */
    @Test public void switchingWizardsDropsTheOldStreamAndItsActions() throws Exception {
        AppNotifyService.ensure(c);
        FakeWizard.Stream s1 = fake.nextStream(20);
        assertNotNull(s1);
        long t = System.currentTimeMillis() / 1000;
        s1.send(1, notify("chat:qa", "QA Carlos", "See you at 5", t));
        Notification n = shown("wizapp:messenger:chat:qa", true).getNotification();
        try (FakeWizard other = new FakeWizard()) {
            Files.write(new File(c.getFilesDir(), "qa_home.txt").toPath(), other.origin().getBytes(StandardCharsets.UTF_8));
            AppNotifyService.ensure(c);                       // what MainActivity.onResume does after Connect
            FakeWizard.Stream s2 = other.nextStream(30);
            assertNotNull("never connected to the new Wizard", s2);
            assertTrue("the old Wizard's stream is still open", s1.closedByPhone(10_000));
            // An action on the old Wizard's notification is not sent anywhere (least of all to the new Wizard).
            Intent fill = new Intent();
            Bundle typed = new Bundle();
            typed.putCharSequence(AppNotifications.REPLY_KEY, "wrong box");
            RemoteInput.addResultsToIntent(n.actions[0].getRemoteInputs(), fill, typed);
            n.actions[0].actionIntent.send(c, 0, fill);
            assertNull(other.acts.poll(4, TimeUnit.SECONDS));
            assertNull(fake.acts.poll(1, TimeUnit.SECONDS));
            shown("wizapp:messenger:chat:qa", false);
            s2.send(1, notify("chat:new", "QA New box", "hello", t + 1));
            shown("wizapp:messenger:chat:new", true);
        }
    }

    /** Synthetic Wizard: probe, registry, the router's SSE stream and Messenger's inbox action route. */
    static final class FakeWizard implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
        final LinkedBlockingQueue<Stream> streamsQ = new LinkedBlockingQueue<>();
        final List<Stream> streams = new CopyOnWriteArrayList<>();
        final LinkedBlockingQueue<Act> acts = new LinkedBlockingQueue<>();
        final java.util.concurrent.atomic.AtomicInteger refused = new java.util.concurrent.atomic.AtomicInteger();
        volatile boolean running = true, refuse = false;

        static final class Act { String path, origin, body; }

        final class Stream {
            final Socket s; final Map<String, String> query = new ConcurrentHashMap<>();
            Stream(Socket s) { this.s = s; }
            synchronized void write(String text) throws IOException {
                OutputStream o = s.getOutputStream(); o.write(text.getBytes(StandardCharsets.UTF_8)); o.flush();
            }
            void send(long id, JSONObject ev) throws IOException { write("id: " + id + "\nevent: " + ev.optString("type") + "\ndata: " + ev + "\n\n"); }
            void close() throws IOException { s.close(); }
            /** The phone hung up (EOF on our side) within the time. */
            boolean closedByPhone(int ms) {
                try { s.setSoTimeout(ms); return s.getInputStream().read() < 0; }
                catch (IOException e) { return e instanceof java.net.SocketTimeoutException ? false : true; }
            }
        }

        FakeWizard() throws IOException {
            new Thread(() -> {
                while (running) try { Socket s = socket.accept(); new Thread(() -> serve(s), "fake-wizard-conn").start(); } catch (IOException ignored) { }
            }, "fake-wizard").start();
        }

        String origin() { return "http://localhost:" + socket.getLocalPort(); }

        Stream nextStream(int seconds) throws InterruptedException { return streamsQ.poll(seconds, TimeUnit.SECONDS); }

        private void respond(Socket s, int code, String type, String body) throws IOException {
            byte[] b = body.getBytes(StandardCharsets.UTF_8);
            OutputStream o = s.getOutputStream();
            o.write(("HTTP/1.1 " + code + " X\r\nContent-Type: " + type + "\r\nContent-Length: " + b.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            o.write(b); o.flush(); s.close();
        }

        private void serve(Socket s) {
            try {
                BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                String request = in.readLine(); if (request == null) { s.close(); return; }
                String[] parts = request.split(" ");
                String target = parts.length > 1 ? parts[1] : "/", origin = null, header; int length = 0;
                while ((header = in.readLine()) != null && !header.isEmpty()) {
                    String h = header.toLowerCase();
                    if (h.startsWith("content-length:")) length = Integer.parseInt(header.substring(15).trim());
                    if (h.startsWith("origin:")) origin = header.substring(7).trim();
                }
                char[] body = new char[length]; int got = 0;
                while (got < length) { int r = in.read(body, got, length - got); if (r < 0) break; got += r; }
                String path = target.split("\\?")[0];
                if (path.equals("/notifications/api/phone")) { respond(s, 200, "application/json", "{\"phone\":1,\"stream\":\"api/phone/stream\"}"); return; }
                if (path.equals("/wizard/v1/apps")) { respond(s, 200, "application/json", "{\"apps\":[{\"id\":\"messenger\",\"name\":\"Messenger\",\"url\":\"/messenger/\"}]}"); return; }
                if (path.equals("/messenger/api/inbox/act")) {
                    Act a = new Act(); a.path = path; a.origin = origin; a.body = new String(body, 0, got); acts.add(a);
                    respond(s, 200, "application/json", "{\"ok\":true}"); return;
                }
                if (path.equals("/notifications/api/phone/stream")) {
                    if (refuse) { refused.incrementAndGet(); respond(s, 503, "application/json", "{\"error\":\"offline\"}"); return; }
                    Stream st = new Stream(s);
                    if (target.contains("?")) for (String kv : target.split("\\?", 2)[1].split("&")) {
                        String[] p = kv.split("=", 2); if (p.length == 2) st.query.put(p[0], java.net.URLDecoder.decode(p[1], "UTF-8"));
                    }
                    st.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: close\r\n\r\nretry: 5000\n\n");
                    st.write("event: hello\ndata: {\"type\":\"hello\",\"v\":1,\"sid\":\"qa-sid\",\"latest\":0}\n\n");
                    if (!st.query.containsKey("since")) st.write("id: 0\nevent: reset\ndata: {\"type\":\"reset\",\"items\":[],\"counts\":{}}\n\n");
                    streams.add(st); streamsQ.add(st);
                    return;   // stays open; the test writes events and closes it
                }
                if (path.startsWith("/wizard-os-home/")) { respond(s, 200, "text/html", "<!doctype html><title>Wizard OS</title><p>Fixture session</p>"); return; }
                respond(s, 404, "application/json", "{\"error\":\"not found\"}");
            } catch (IOException ignored) { }
        }

        @Override public void close() throws IOException {
            running = false;
            for (Stream st : streams) try { st.close(); } catch (IOException ignored) { }
            socket.close();
        }
    }
}
