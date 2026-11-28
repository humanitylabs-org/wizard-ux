package ai.wizards.os;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

/**
 * Instant home-screen apps (wizard-ux issue 1830): the pinned window's phone-side cache against a fake box. Each
 * "open" is a new window (a new PinCache on the same folder), as a home-screen icon tap makes one.
 */
public class PinCacheTest {
    private static final String BOX = "https://box.example.ts.net";
    private static final String HTML = "text/html,application/xhtml+xml,*/*;q=0.8";

    /** A box: path -> (etag, body, extra headers); it answers conditionals with 304 like nginx. */
    static final class Box implements PinCache.Net {
        final Map<String, String[]> files = new HashMap<>();
        final List<String> log = java.util.Collections.synchronizedList(new ArrayList<>());
        volatile boolean down = false;
        /** How long the box takes to answer (a slow box, or a cold load right after a deploy). */
        volatile long delayMs = 0;
        void put(String path, String etag, String type, String body, String... extra) {
            String[] row = new String[3 + extra.length];
            row[0] = etag; row[1] = type; row[2] = body;
            System.arraycopy(extra, 0, row, 3, extra.length);
            files.put(path, row);
        }
        @Override public PinCache.Reply get(String url, Map<String, String> headers) throws IOException {
            String path = url.substring(BOX.length());
            log.add(path + (headers.containsKey("If-None-Match") ? " (conditional)" : ""));
            if (delayMs > 0) try { Thread.sleep(delayMs); } catch (InterruptedException e) { throw new IOException(e); }
            if (down) throw new IOException("connect timed out");
            String[] f = files.get(path);
            Map<String, String> h = new LinkedHashMap<>();
            if (f == null) { h.put("content-type", "text/plain"); return new PinCache.Reply(404, "Not Found", h, "no".getBytes(StandardCharsets.UTF_8)); }
            h.put("content-type", f[1]);
            if (!f[0].isEmpty()) h.put("etag", f[0]);
            for (int i = 3; i + 1 < f.length; i += 2) h.put(f[i], f[i + 1]);
            if (!f[0].isEmpty() && f[0].equals(headers.get("If-None-Match"))) return new PinCache.Reply(304, "Not Modified", h, new byte[0]);
            int status = h.containsKey("location") ? 302 : 200;
            return new PinCache.Reply(status, "OK", h, f[2].getBytes(StandardCharsets.UTF_8));
        }
    }

    private static Map<String, String> accept(String a) { Map<String, String> h = new HashMap<>(); h.put("Accept", a); return h; }

    /** One pinned open of the app: its page, then the files the page loads. Returns the bodies shown. */
    private static List<String> open(File dir, Box box, String release) {
        PinCache c = new PinCache(dir, box, BOX);
        c.release(release);
        List<String> shown = new ArrayList<>();
        PinCache.Reply page = c.answer(BOX + "/wizard-search/", "GET", false, accept(HTML));
        shown.add(page == null ? null : new String(page.body, StandardCharsets.UTF_8));
        for (String f : new String[]{"/wizard-search/app.js", "/wizard-search/app.css", "/wizard-os-home/core/app-client.js"}) {
            PinCache.Reply r = c.answer(BOX + f, "GET", false, accept("*/*"));
            shown.add(r == null ? null : new String(r.body, StandardCharsets.UTF_8));
        }
        return shown;
    }

    private static Box search() {
        Box box = new Box();
        box.put("/wizard-search/", "\"p1\"", "text/html", "<h1>Search 1</h1>", "content-security-policy", "frame-ancestors 'self'");
        box.put("/wizard-search/app.js", "\"j1\"", "text/javascript", "search v1");
        box.put("/wizard-search/app.css", "\"c1\"", "text/css", "h1{}");
        box.put("/wizard-os-home/core/app-client.js", "\"s1\"", "text/javascript", "client r1");
        return box;
    }

    @Test
    public void aSecondOpenAsksTheBoxOnlyWhetherThePageChanged() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        assertEquals(List.of("<h1>Search 1</h1>", "search v1", "h1{}", "client r1"), open(dir, box, "aaaaaaaaaaaa"));
        assertEquals(4, box.log.size());
        box.log.clear();
        assertEquals(List.of("<h1>Search 1</h1>", "search v1", "h1{}", "client r1"), open(dir, box, "aaaaaaaaaaaa"));
        // One small conditional read for the page (a 304); no shell or app file is asked for.
        assertEquals(List.of("/wizard-search/ (conditional)"), box.log);
    }

    @Test
    public void aKeptPageKeepsItsHeaders() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        open(dir, box, "aaaaaaaaaaaa");
        PinCache.Reply again = new PinCache(dir, box, BOX).answer(BOX + "/wizard-search/", "GET", false, accept(HTML));
        assertNotNull(again);
        assertEquals(200, again.status);
        assertEquals("text/html", again.mime());
        assertEquals("frame-ancestors 'self'", again.headers.get("content-security-policy"));
    }

    @Test
    public void anAppUpdatedOnTheBoxShowsItsNewVersionByTheNextOpen() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        open(dir, box, "aaaaaaaaaaaa");
        // The app is updated: new page and new script (the stylesheet's bytes did not change).
        box.put("/wizard-search/", "\"p2\"", "text/html", "<h1>Search 2</h1>");
        box.put("/wizard-search/app.js", "\"j2\"", "text/javascript", "search v2");
        box.log.clear();
        assertEquals(List.of("<h1>Search 2</h1>", "search v2", "h1{}", "client r1"), open(dir, box, "aaaaaaaaaaaa"));
        assertEquals(List.of("/wizard-search/ (conditional)", "/wizard-search/app.js", "/wizard-search/app.css"), box.log);
        box.log.clear();
        assertEquals(List.of("<h1>Search 2</h1>", "search v2", "h1{}", "client r1"), open(dir, box, "aaaaaaaaaaaa"));
        assertEquals(List.of("/wizard-search/ (conditional)"), box.log);
    }

    @Test
    public void shellFilesAreKeptPerShellRelease() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        open(dir, box, "aaaaaaaaaaaa");
        box.put("/wizard-os-home/core/app-client.js", "\"s2\"", "text/javascript", "client r2");
        box.log.clear();
        assertEquals("client r2", open(dir, box, "bbbbbbbbbbbb").get(3));
        assertTrue(box.log.contains("/wizard-os-home/core/app-client.js"));
        // No release from the page (an older shell): shell files pass through untouched.
        box.log.clear();
        assertNull(open(dir, box, "").get(3));
        assertFalse(box.log.contains("/wizard-os-home/core/app-client.js"));
    }

    @Test
    public void aBoxThatDoesNotAnswerPassesEverythingThrough() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        open(dir, box, "aaaaaaaaaaaa");
        box.down = true;
        List<String> shown = open(dir, box, "aaaaaaaaaaaa");
        // The page read failed: the WebView makes its own attempt (today's error and offline screens), and the app's
        // files are not answered for a page that did not load.
        assertNull(shown.get(0));
        assertNull(shown.get(1));
        assertNull(shown.get(2));
    }

    @Test
    public void privateNoStoreRedirectAndErrorAnswersAreNeverKept() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        box.put("/wizard-search/app.js", "", "text/javascript", "secret", "cache-control", "no-store");
        box.put("/wizard-search/app.css", "", "text/css", "x", "location", "/elsewhere");
        open(dir, box, "aaaaaaaaaaaa");
        box.log.clear();
        List<String> shown = open(dir, box, "aaaaaaaaaaaa");
        assertEquals("secret", shown.get(1));      // answered, but read again: never kept
        assertNull(shown.get(2));                   // a redirect: the WebView follows it itself
        assertTrue(box.log.contains("/wizard-search/app.js"));
        assertTrue(box.log.contains("/wizard-search/app.css"));
        // A missing file is answered as missing and not kept.
        PinCache c = new PinCache(dir, box, BOX);
        c.answer(BOX + "/wizard-search/", "GET", false, accept(HTML));
        PinCache.Reply missing = c.answer(BOX + "/wizard-search/gone.js", "GET", false, accept("*/*"));
        assertEquals(404, missing.status);
    }

    @Test
    public void apisAndOtherBoxesPassThroughUntouched() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        PinCache c = new PinCache(dir, box, BOX);
        c.answer(BOX + "/wizard-search/", "GET", false, accept(HTML));
        box.log.clear();
        assertNull(c.answer(BOX + "/wizard-search/api/search?q=x", "GET", false, accept("*/*")));
        assertNull(c.answer(BOX + "/wizard/v1/apps", "GET", false, accept("*/*")));
        assertNull(c.answer("https://other.example/wizard-search/app.js", "GET", false, accept("*/*")));
        assertNull(c.answer(BOX + "/wizard-search/app.js", "POST", false, accept("*/*")));
        assertTrue(box.log.isEmpty());
    }

    @Test
    public void clearLeavesNothingOnThePhone() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        open(dir, search(), "aaaaaaaaaaaa");
        assertTrue(dir.listFiles().length > 0);
        PinCache.clear(dir);
        assertFalse(dir.exists());
    }

    @Test
    public void readAllStopsAtTheCap() throws Exception {
        byte[] small = "hello".getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(small, PinCache.readAll(new java.io.ByteArrayInputStream(small), 10));
        assertNull(PinCache.readAll(new java.io.ByteArrayInputStream(new byte[11]), 10));
    }

    @Test
    public void aSlowBoxGetsTheKeptPageAtOnceAndItsAnswerIsKeptForTheNextOpen() throws Exception {
        // Field report 2 (26 Nov): the app's page itself comes from the phone, the box's answer no longer holds it up.
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        open(dir, box, "aaaaaaaaaaaa");
        box.put("/wizard-search/", "\"p2\"", "text/html", "<h1>Search 2</h1>");
        box.delayMs = 1500;
        PinCache c = new PinCache(dir, box, BOX);
        c.release("aaaaaaaaaaaa");
        long t0 = System.nanoTime();
        PinCache.Reply page = c.answer(BOX + "/wizard-search/", "GET", false, accept(HTML));
        long ms = (System.nanoTime() - t0) / 1_000_000;
        assertEquals("<h1>Search 1</h1>", new String(page.body, StandardCharsets.UTF_8));
        assertTrue("the kept page came in " + ms + " ms", ms < PinInstantPolicy.PAGE_WAIT_MS + 200);
        assertEquals(1, c.keptPages.get());
        // This window's files match the page it shows: from the phone, no read.
        box.log.clear();
        assertEquals("search v1", new String(c.answer(BOX + "/wizard-search/app.js", "GET", false, accept("*/*")).body, StandardCharsets.UTF_8));
        assertTrue(box.log.isEmpty());
        // The box's late answer (a new page) is kept: the next open shows the update.
        Thread.sleep(2000);
        box.delayMs = 0;
        assertEquals("<h1>Search 2</h1>", open(dir, box, "aaaaaaaaaaaa").get(0));
    }

    @Test
    public void aQuickBoxStillDecidesThePage() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        open(dir, box, "aaaaaaaaaaaa");
        box.put("/wizard-search/", "\"p2\"", "text/html", "<h1>Search 2</h1>");
        box.delayMs = 20;
        assertEquals("<h1>Search 2</h1>", open(dir, box, "aaaaaaaaaaaa").get(0));
    }

    @Test
    public void aFileAskedForTwiceAtOnceIsReadFromTheBoxOnce() throws Exception {
        // Field report 2: core/app-client.js reached the box three times in one open.
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = search();
        PinCache c = new PinCache(dir, box, BOX);
        c.release("aaaaaaaaaaaa");
        c.answer(BOX + "/wizard-search/", "GET", false, accept(HTML));
        box.log.clear();
        box.delayMs = 300;
        List<Thread> asks = new ArrayList<>();
        List<String> got = java.util.Collections.synchronizedList(new ArrayList<>());
        for (int i = 0; i < 3; i++) asks.add(new Thread(() -> {
            PinCache.Reply r = c.answer(BOX + "/wizard-os-home/core/app-client.js", "GET", false, accept("*/*"));
            got.add(r == null ? null : new String(r.body, StandardCharsets.UTF_8));
        }));
        for (Thread t : asks) t.start();
        for (Thread t : asks) t.join();
        assertEquals(List.of("client r1", "client r1", "client r1"), got);
        assertEquals(List.of("/wizard-os-home/core/app-client.js"), box.log);
    }
    /** wizard-ux issue 1959: Recorder's address is a redirect (/mizel/ -> live/). The phone can't hand the WebView a
     *  redirect, so it reads it once, remembers it, and later opens pass it straight through with no box read first. */
    @Test
    public void aRedirectingAppPageIsReadByThePhoneOnceThenPassesStraightThrough() throws Exception {
        File dir = Files.createTempDirectory("pin-cache").toFile();
        Box box = new Box();
        box.put("/mizel/", "", "text/html", "", "location", "live/");
        box.put("/mizel/live/", "", "text/html", "<h1>Recorder</h1>");
        PinCache first = new PinCache(dir, box, BOX);
        assertNull("a redirect passes through (the WebView follows it)", first.answer(BOX + "/mizel/", "GET", false, accept(HTML)));
        assertNotNull(first.answer(BOX + "/mizel/live/", "GET", false, accept(HTML)));
        assertEquals(List.of("/mizel/", "/mizel/live/"), box.log);
        box.log.clear();
        for (int open = 0; open < 3; open++) {
            PinCache c = new PinCache(dir, box, BOX);
            long t0 = System.nanoTime();
            box.delayMs = 3000; // a slow box would hold the redirect read; it is not asked at all
            assertNull(c.answer(BOX + "/mizel/", "GET", false, accept(HTML)));
            assertTrue("no wait on the box for the redirect", (System.nanoTime() - t0) / 1_000_000L < 500);
            assertEquals(1, c.passed.get());
            box.delayMs = 0;
            PinCache.Reply page = c.answer(BOX + "/mizel/live/", "GET", false, accept(HTML));
            assertEquals("<h1>Recorder</h1>", new String(page.body, StandardCharsets.UTF_8));
        }
        assertFalse("the redirect was never read again by the phone", box.log.contains("/mizel/"));
        // Switch off clears it with everything else.
        PinCache.clear(dir);
        box.log.clear();
        new PinCache(dir, box, BOX).answer(BOX + "/mizel/", "GET", false, accept(HTML));
        assertEquals(List.of("/mizel/"), box.log);
    }
}
