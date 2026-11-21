package ai.wizards.os.device;

import org.junit.Test;

import java.io.File;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.*;

/* Browser owner boundary (wizard-os#133): the app's own native owner calls carry the shell token, nothing else does. */
public class ShellTokenTest {
    static final String T = "ab".repeat(32);
    static final String BOX = "https://box.example.ts.net";

    private static String at(String url) throws Exception { return ShellToken.forUrl(BOX, T, new URL(url)); }

    @Test public void ownerRoutesOnTheBoxGetTheToken() throws Exception {
        for (String u : new String[] {
                BOX + "/wizard/hermes/v1/runs", BOX + "/wizard/hermes/v1/runs/r1?x=1", BOX + "/wizard/v1/bootstrap",
                BOX + "/wizard/files/upload", BOX + "/wizard/v1/shares", BOX + "/wizard-os-home/api/transcribe",
                BOX + "/wizard-os-home/api/diagnostics/scroll-capture", BOX + "/api/system/devices", BOX + "/v1/runs",
                BOX + "/wizard-os-home/store-install/_slots/chats", "https://BOX.example.ts.net:443/wizard/v1/bootstrap"}) {
            assertEquals(u, T, at(u));
        }
    }

    @Test public void appPathsOtherHostsAndOddPathsNever() throws Exception {
        for (String u : new String[] {
                BOX + "/notifications/api/items?view=all", BOX + "/messenger/api/unread", BOX + "/android-apps/api/updates",
                BOX + "/wizard-search/api/x", BOX + "/wizard-os-home/", BOX + "/wizard-os-home/core/app.js",
                BOX + "/reports/wizard-os/latest.json", BOX + "//wizard/x", BOX + "/wizard//x", BOX + "/wizardx/y",
                "https://evil.example/wizard/v1/bootstrap", "https://box.example.ts.net.evil.example/wizard/x",
                "http://box.example.ts.net/wizard/x", "https://box.example.ts.net:8443/wizard/x",
                "https://user@box.example.ts.net/wizard/x"}) {
            assertNull(u, at(u));
        }
    }

    @Test public void noTokenOrABadOneSendsNothing() throws Exception {
        URL u = new URL(BOX + "/wizard/v1/bootstrap");
        assertNull(ShellToken.forUrl(BOX, "", u));
        assertNull(ShellToken.forUrl(BOX, null, u));
        assertNull(ShellToken.forUrl(BOX, "AB".repeat(32), u));
        assertNull(ShellToken.forUrl(BOX, "ab".repeat(31), u));
        assertNull(ShellToken.forUrl("", T, u));
        assertNull(ShellToken.forUrl(BOX, T, null));
        assertFalse(ShellToken.valid("off"));
        assertTrue(ShellToken.valid(T));
    }

    @Test public void theBoxOriginIsNormalised() {
        assertEquals(BOX, ShellToken.normalize("https://Box.Example.ts.net:443/"));
        assertEquals("http://localhost:8080", ShellToken.normalize("http://localhost:8080"));
        assertEquals("", ShellToken.normalize("https://box.example.ts.net/wizard-os-home/"));
        assertEquals("", ShellToken.normalize("ftp://box.example.ts.net"));
        assertEquals("", ShellToken.normalize("not a url"));
        assertEquals("", ShellToken.normalize(null));
    }

    /* Every native client that calls an owner route adds the header, and only MainActivity's gated bridge sets it. */
    @Test public void everyNativeOwnerCallerAppliesIt() throws Exception {
        String[] callers = {"device/Http.java", "everywhere/EverywhereOutbox.java", "share/ShareHttp.java",
                "share/ShareActivity.java", "assist/Transcriber.java", "ScrollCaptureDiagnostics.java"};
        for (String f : callers) assertTrue(f, src(f).contains("ShellToken.apply("));
        String main = src("MainActivity.java");
        assertTrue(main.contains("gate == null || !ai.wizards.os.device.ShellToken.valid(token)"));
        assertTrue(main.contains("ShellToken.clear(this)"));
        String state = src("device/AppState.java");
        assertEquals(2, state.split("ShellToken.load\\(c\\)", -1).length - 1);
    }

    private static String src(String rel) throws Exception {
        File f = new File("src/main/java/ai/wizards/os/" + rel);
        if (!f.isFile()) f = new File("app/src/main/java/ai/wizards/os/" + rel);
        return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
    }
}
