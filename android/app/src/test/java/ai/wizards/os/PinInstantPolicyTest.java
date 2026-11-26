package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import ai.wizards.os.PinInstantPolicy.Kind;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

/** Instant home-screen apps (wizard-ux issue 1830, switch wizard/pin-instant-open). */
public class PinInstantPolicyTest {
    private static final String BOX = "https://box.example.ts.net";
    private static final String HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

    private static Kind kind(String path, String accept) {
        return PinInstantPolicy.kind(BOX, "https", "box.example.ts.net", path, "GET", false, accept, false);
    }

    @Test
    public void connectingIsSkippedOnlyWhenOnReachedRecentlyAndOnTheSameNetwork() {
        long now = 1_000_000_000L;
        assertTrue(PinInstantPolicy.skipConnecting(true, now, now - 60_000L, "101|vpn", "101|vpn"));
        assertTrue(PinInstantPolicy.skipConnecting(true, now, now - PinInstantPolicy.REACHED_MS, "101|vpn", "101|vpn"));
        // Switch off: today's Connecting, always.
        assertFalse(PinInstantPolicy.skipConnecting(false, now, now - 1_000L, "101|vpn", "101|vpn"));
        // Too long ago, never reached, or a clock that went backwards.
        assertFalse(PinInstantPolicy.skipConnecting(true, now, now - PinInstantPolicy.REACHED_MS - 1, "101|vpn", "101|vpn"));
        assertFalse(PinInstantPolicy.skipConnecting(true, now, 0, "", "101|vpn"));
        assertFalse(PinInstantPolicy.skipConnecting(true, now, now + 5_000L, "101|vpn", "101|vpn"));
        // The network or the VPN changed (Tailscale turned off, Wi-Fi to mobile data), or there is no network now.
        assertFalse(PinInstantPolicy.skipConnecting(true, now, now - 1_000L, "101|vpn", "101|direct"));
        assertFalse(PinInstantPolicy.skipConnecting(true, now, now - 1_000L, "101|vpn", "102|vpn"));
        assertFalse(PinInstantPolicy.skipConnecting(true, now, now - 1_000L, "", ""));
    }

    @Test
    public void networkNamesTheActiveNetworkAndTheVpn() {
        assertEquals("101|vpn", PinInstantPolicy.network(true, "101", true));
        assertEquals("101|direct", PinInstantPolicy.network(true, "101", false));
        assertEquals("", PinInstantPolicy.network(false, "101", true));
    }

    @Test
    public void anAppsPageAndFilesAreKeptButApisNever() {
        assertEquals(Kind.PAGE, kind("/wizard-search/", HTML));
        assertEquals(Kind.PAGE, kind("/wisdom/index.html", HTML));
        assertEquals(Kind.PAGE, kind("/wizard-search/results", HTML));
        assertEquals(Kind.FILE, kind("/wizard-search/app.js", "*/*"));
        assertEquals(Kind.FILE, kind("/wizard-search/static/app.css", "text/css,*/*;q=0.1"));
        assertEquals(Kind.FILE, kind("/wisdom/art/cover.webp", "image/avif,image/webp,*/*"));
        assertEquals(Kind.SHELL, kind("/wizard-os-home/core/app-client.js", "*/*"));
        assertEquals(Kind.SHELL, kind("/wizard-os-home/kit/controls.css", "text/css"));
        // Data, wherever it sits.
        assertEquals(Kind.NONE, kind("/wizard/v1/apps", "*/*"));
        assertEquals(Kind.NONE, kind("/api/system/health", "*/*"));
        assertEquals(Kind.NONE, kind("/wizard-search/api/search", "*/*"));
        assertEquals(Kind.NONE, kind("/wizard-search/api/results.js", "*/*"));
        assertEquals(Kind.NONE, kind("/wizard-search/data.json", "*/*"));
        assertEquals(Kind.NONE, kind("/wizard-os-home/store-data/wizard/v1/app-logos", "*/*"));
        assertEquals(Kind.NONE, kind("/wizard-os-home/sw.js", "*/*"));
        assertEquals(Kind.NONE, kind("/wizard-os-home/installed-apps.json", "*/*"));
        assertEquals(Kind.NONE, kind("/wizard-search/files/report.png", "*/*"));
        assertEquals(Kind.NONE, kind("/wizard-search/results", "*/*"));      // a fetch, not the page
        assertEquals(Kind.NONE, kind("/wizard-search", HTML));                 // a redirect to /wizard-search/
        assertEquals(Kind.NONE, kind("/wizard-os-home/index.html", HTML));     // the shell's pages stay with its worker
        assertEquals(Kind.NONE, kind("/wizard-search/../wizard/v1/apps", "*/*"));
    }

    @Test
    public void onlyPlainGetsOnThisBoxAreKept() {
        assertEquals(Kind.NONE, PinInstantPolicy.kind(BOX, "https", "box.example.ts.net", "/wizard-search/app.js", "POST", false, "*/*", false));
        assertEquals(Kind.NONE, PinInstantPolicy.kind(BOX, "https", "box.example.ts.net", "/wizard-search/app.js", "GET", true, "*/*", false));
        assertEquals(Kind.NONE, PinInstantPolicy.kind(BOX, "https", "box.example.ts.net", "/wizard-search/song.mp3", "GET", false, "*/*", true));
        assertEquals(Kind.NONE, PinInstantPolicy.kind(BOX, "https", "cdn.example.com", "/wizard-search/app.js", "GET", false, "*/*", false));
        assertEquals(Kind.NONE, PinInstantPolicy.kind(BOX, "http", "box.example.ts.net", "/wizard-search/app.js", "GET", false, "*/*", false));
        assertEquals(Kind.NONE, PinInstantPolicy.kind("", "https", "box.example.ts.net", "/wizard-search/app.js", "GET", false, "*/*", false));
    }

    @Test
    public void onlyPlainSharedAnswersMayBeKept() {
        Map<String, String> ok = new HashMap<>();
        ok.put("content-type", "text/javascript");
        assertTrue(PinInstantPolicy.storable(200, ok, 10));
        assertFalse(PinInstantPolicy.storable(404, ok, 10));
        assertFalse(PinInstantPolicy.storable(200, ok, PinInstantPolicy.MAX_FILE + 1));
        Map<String, String> h = new HashMap<>(ok); h.put("cache-control", "no-store");
        assertFalse(PinInstantPolicy.storable(200, h, 10));
        h = new HashMap<>(ok); h.put("cache-control", "private, max-age=60");
        assertFalse(PinInstantPolicy.storable(200, h, 10));
        h = new HashMap<>(ok); h.put("set-cookie", "1");
        assertFalse(PinInstantPolicy.storable(200, h, 10));
        h = new HashMap<>(ok); h.put("vary", "Accept-Encoding");
        assertTrue(PinInstantPolicy.storable(200, h, 10));
        h = new HashMap<>(ok); h.put("vary", "Accept-Encoding, Cookie");
        assertFalse(PinInstantPolicy.storable(200, h, 10));
        assertFalse(PinInstantPolicy.storable(200, new HashMap<>(), 10)); // no content type
    }

    @Test
    public void aPagesVersionIsItsValidatorsElseItsBytes() {
        Map<String, String> h = new HashMap<>();
        assertEquals("h:abc", PinInstantPolicy.generation(h, "abc"));
        h.put("etag", "\"a1\"");
        assertEquals("v:\"a1\"|", PinInstantPolicy.generation(h, "abc"));
        h.put("last-modified", "Wed, 25 Nov 2026 14:19:22 GMT");
        assertEquals("v:\"a1\"|Wed, 25 Nov 2026 14:19:22 GMT", PinInstantPolicy.generation(h, "abc"));
    }

    @Test
    public void headersPassedOnAndReplayedLeaveOutTheTransportsOwn() {
        Map<String, String> req = new HashMap<>();
        req.put("Accept", "*/*"); req.put("Accept-Encoding", "gzip"); req.put("Range", "bytes=0-"); req.put("Referer", BOX + "/");
        Map<String, String> fwd = PinInstantPolicy.forward(req);
        assertEquals("*/*", fwd.get("Accept"));
        assertEquals(BOX + "/", fwd.get("Referer"));
        assertFalse(fwd.containsKey("Accept-Encoding"));
        assertFalse(fwd.containsKey("Range"));
        Map<String, String> res = new HashMap<>();
        res.put("content-type", "text/html"); res.put("content-encoding", "gzip"); res.put("content-length", "10");
        res.put("content-security-policy", "frame-ancestors 'self'"); res.put("set-cookie", "1");
        Map<String, String> out = PinInstantPolicy.replay(res);
        assertEquals("frame-ancestors 'self'", out.get("content-security-policy"));
        assertFalse(out.containsKey("content-encoding"));
        assertFalse(out.containsKey("content-length"));
        assertFalse(out.containsKey("set-cookie"));
        assertTrue(PinInstantPolicy.replayable(200));
        assertTrue(PinInstantPolicy.replayable(404));
        assertFalse(PinInstantPolicy.replayable(302));
    }

    @Test
    public void aSavedLastScreenIsShownForAWeek() {
        long now = 10_000_000_000L;
        assertTrue(PinInstantPolicy.shotFresh(now, now - 3_600_000L));
        assertFalse(PinInstantPolicy.shotFresh(now, now - PinInstantPolicy.SHOT_MAX_AGE_MS - 1));
        assertFalse(PinInstantPolicy.shotFresh(now, 0));
        assertEquals(10_000L, PinInstantPolicy.SHOT_MAX_MS);
    }

    @Test
    public void cantReachOnlyWhenTheBoxDoesNotAnswer() {
        assertTrue(PinInstantPolicy.boxAnswers(200));
        assertTrue(PinInstantPolicy.boxAnswers(401));   // a sign-in wall is still the box answering
        assertFalse(PinInstantPolicy.boxAnswers(502));  // the gateway: the Wizard behind it is not there
        assertFalse(PinInstantPolicy.boxAnswers(-1));   // no answer at all
        assertFalse(PinInstantPolicy.boxAnswers(0));
    }

    @Test
    public void thePlaceholderNamesTheApp() {
        assertEquals("Search", PinInstantPolicy.placeholderName("Search", "wizard-search"));
        assertEquals("Search", PinInstantPolicy.placeholderName("", "wizard-search"));
        assertEquals("Youtube Music", PinInstantPolicy.placeholderName(null, "youtube-music"));
        assertEquals("", PinInstantPolicy.placeholderName(null, null));
    }
}
