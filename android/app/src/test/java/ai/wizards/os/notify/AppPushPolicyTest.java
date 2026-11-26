package ai.wizards.os.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.After;
import org.junit.Test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Box-to-phone push (wizard-ux issue 1618): the phone's reader of the Notifications app's wake-up line. The stream
 * reader is the exact code the phone runs ({@link AppPushPolicy#listen}), here against a real HTTP server.
 */
public class AppPushPolicyTest {
    /** A one-route HTTP server on a real socket (Android unit tests have no com.sun HttpServer). */
    interface Answer { void answer(String requestHead, OutputStream out) throws IOException; }
    private ServerSocket server;

    private String serve(Answer a) throws IOException {
        server = new ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(() -> {
            while (!server.isClosed()) {
                try (Socket s = server.accept()) {
                    BufferedReader r = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.ISO_8859_1));
                    StringBuilder head = new StringBuilder();
                    for (String l; (l = r.readLine()) != null && !l.isEmpty(); ) head.append(l).append('\n');
                    a.answer(head.toString(), s.getOutputStream());
                } catch (IOException ignored) { }
            }
        });
        t.setDaemon(true);
        t.start();
        return "http://127.0.0.1:" + server.getLocalPort();
    }

    // The desktop JVM drops an Origin header unless allowed (Android's HttpURLConnection sends it, as Http.json does).
    static { System.setProperty("sun.net.http.allowRestrictedHeaders", "true"); }

    @After public void stop() throws IOException { if (server != null) server.close(); }

    @Test
    public void helloAndNewItemsAskForOneReadEachPingsAndOtherEventsNothing() {
        AppPushPolicy.Parser p = new AppPushPolicy.Parser();
        assertNull(p.line("retry: 5000"));
        assertNull(p.line(""));
        assertNull(p.line("event: hello"));
        assertNull(p.line("data: {\"type\":\"hello\",\"v\":1}"));
        assertEquals("hello", p.line(""));
        assertNull(p.line(": ping"));
        assertNull(p.line(""));
        assertNull(p.line("event: inbox"));
        assertNull(p.line("data: {\"type\":\"inbox\",\"id\":\"x\",\"time\":1}"));
        assertEquals("inbox", p.line(""));
        assertNull(p.line("event: something-newer"));
        assertNull(p.line("data: {}"));
        none(p.line(""), "an event a newer box adds is ignored, never a read storm");
        assertNull(p.line("event: inbox"));
        none(p.line(""), "no data: not an event");
    }

    private static void none(String s, String why) { org.junit.Assert.assertNull(why, s); }

    @Test
    public void urlAndBackoff() {
        assertEquals("https://box.example/notifications/api/phone/inbox", AppPushPolicy.url("https://box.example/"));
        assertEquals(1000L, AppPushPolicy.backoffMs(0));
        assertEquals(2000L, AppPushPolicy.backoffMs(1));
        assertEquals(60_000L, AppPushPolicy.backoffMs(6));
        assertEquals(60_000L, AppPushPolicy.backoffMs(50));
        assertTrue("an old Notifications without the line is asked rarely", AppPushPolicy.MISSING_RETRY_MS >= 10 * 60_000L);
        assertTrue("three missed 50 s pings", AppPushPolicy.READ_TIMEOUT_MS >= 150_000);
    }

    @Test
    public void listensOnARealLineAndReadsTheMomentAnItemIsTold() throws Exception {
        CountDownLatch tell = new CountDownLatch(1);
        List<String> origins = new CopyOnWriteArrayList<>();
        String origin = serve((head, o) -> {
            for (String l : head.split("\n")) if (l.toLowerCase().startsWith("origin:")) origins.add(l.substring(7).trim());
            assertTrue(head, head.startsWith("GET " + AppPushPolicy.PATH + " "));
            o.write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nConnection: close\r\n\r\n"
                    + "retry: 5000\n\nevent: hello\ndata: {\"type\":\"hello\",\"v\":1}\n\n: ping\n\n").getBytes(StandardCharsets.UTF_8));
            o.flush();
            try { tell.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            o.write("event: inbox\ndata: {\"type\":\"inbox\",\"id\":\"a\",\"time\":1}\n\n".getBytes(StandardCharsets.UTF_8));
            o.flush();
        });
        List<String> reads = new CopyOnWriteArrayList<>();
        long[] at = new long[2];
        try {
            AppPushPolicy.listen(AppPushPolicy.url(origin), () -> true, why -> {
                reads.add(why);
                if ("hello".equals(why)) { at[0] = System.nanoTime(); tell.countDown(); }
                else at[1] = System.nanoTime();
            }, "Origin", origin);
            fail("a line the box closes ends with Ended, so the phone reconnects");
        } catch (AppPushPolicy.Ended e) {
            assertEquals(0, e.status);
        }
        assertEquals(List.of("hello", "inbox"), reads);
        assertTrue("told at once, not polled", (at[1] - at[0]) / 1_000_000L < 1000);
        assertEquals(origin, origins.get(0));
    }

    @Test
    public void anOlderNotificationsWithoutTheLineSays404AndStoppingEndsQuietly() throws Exception {
        String origin = serve((head, o) -> o.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.UTF_8)));
        try {
            AppPushPolicy.listen(AppPushPolicy.url(origin), () -> true, why -> fail("no read"), "Origin", origin);
            fail("404 ends the line");
        } catch (AppPushPolicy.Ended e) {
            assertEquals(404, e.status);
        }
        AtomicBoolean on = new AtomicBoolean(false);
        AppPushPolicy.listen(AppPushPolicy.url(origin), on::get, why -> fail("no read"), "Origin", origin); // switched off: no throw
    }
}
