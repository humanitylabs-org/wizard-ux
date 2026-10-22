package ai.wizards.os;

import static org.junit.Assert.*;
import org.junit.Test;

public class OriginTest {
    @Test public void originBelongsToSelectedServer() {
        String origin = "https://box.example.ts.net";
        assertTrue(ServerOrigin.matches(origin, origin + "/wizard-os-home/"));
        assertTrue(ServerOrigin.matches(origin, "https://BOX.example.ts.net:443/mizel-live/"));
        for (String u : new String[]{"https://other.example.ts.net/", "https://box.example.ts.net.evil.test/", "http://box.example.ts.net/", "https://user@box.example.ts.net/", "https://box.example.ts.net:8443/"}) assertFalse(u, ServerOrigin.matches(origin, u));
        assertFalse(ServerOrigin.matches("", "https://box.example.ts.net/"));
    }
    @Test public void nonDefaultPortIsPartOfOrigin() {
        assertTrue(ServerOrigin.matches("https://box.example:8443", "https://box.example:8443/wizard-os-home/"));
        assertFalse(ServerOrigin.matches("https://box.example:8443", "https://box.example/wizard-os-home/"));
    }
    @Test public void shellPaths() {
        assertTrue(Origin.isShellPath("/wizard-os-home/"));
        assertTrue(Origin.isShellPath("/wizard-os-home"));
        assertFalse(Origin.isShellPath("/wizard-os-home-preview/"));
        assertFalse(Origin.isShellPath(null));
    }
    @Test public void inAppPaths() {
        assertTrue(Origin.isInAppPath("/wizard-os-home/"));
        assertTrue(Origin.isInAppPath("/mizel-live/"));
        assertTrue(Origin.isInAppPath("/mizel-live"));
        assertFalse(Origin.isInAppPath("/mizel-live-evil/"));
        assertFalse(Origin.isInAppPath("/meetings/"));
        assertFalse(Origin.isInAppPath("/"));
    }
}
