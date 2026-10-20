package ai.wizards.os;

import static org.junit.Assert.*;
import org.junit.Test;

public class ServerOriginTest {
    @Test public void plainHttpsAndShellPaste() {
        for (String value : new String[]{"https://Box.example/", " https://box.example:443 ", "https://box.example/wizard-os-home/"}) assertEquals("https://box.example", ServerOrigin.parse(value));
        assertEquals("https://box.example:8443", ServerOrigin.parse("https://box.example:8443/"));
        assertEquals("https://[::1]:8443", ServerOrigin.parse("https://[::1]:8443"));
    }
    @Test public void loopbackExceptionIsDebugOnly() {
        assertNull(ServerOrigin.parse("http://localhost:8123", false));
        assertEquals("http://localhost:8123", ServerOrigin.parse("http://localhost:8123", true));
        assertNull(ServerOrigin.parse("http://evil.example:8123", true));
        assertNull(ServerOrigin.parse("http://localhost:65536", true));
    }
    @Test public void canonicalSetupQr() {
        assertEquals("https://box.example.ts.net", ServerOrigin.parse("wizard://connect?origin=https%3A%2F%2Fbox.example.ts.net"));
        assertEquals("https://box.example", ServerOrigin.parse("wizard://connect?origin=https%3A%2F%2Fbox.example%3A443%2F"));
    }
    @Test public void rejectAmbiguousOrCredentialledAddresses() {
        for (String value : new String[]{"", "box.example", "http://box.example", "https://user:password@box.example", "https://box.example/other", "https://box.example?x=1", "https://box.example/#secret", "https://box.example:", "https://box.example:0", "https://box.example:65536", "https://box.example./", "https://box.example/%2f", "https://box.example\\@evil.test", "https://box.example\n.evil.test", "wizard://evil?origin=https%3A%2F%2Fbox.example", "wizard://connect?origin=https%3A%2F%2Fbox.example&origin=https%3A%2F%2Fevil.test", "wizard://connect?origin=https%253A%252F%252Fbox.example", "wizard://connect?origin=http%3A%2F%2Fbox.example", "wizard://connect?origin=%zz"}) assertNull(value, ServerOrigin.parse(value));
        assertNull(ServerOrigin.parse(null));
    }
    @Test public void storedChoiceWinsOverBuildMigration() {
        assertEquals("https://chosen.example", ServerOrigin.migrated("https://chosen.example", "https://legacy.example"));
        assertEquals("https://legacy.example", ServerOrigin.migrated(null, "https://legacy.example/"));
        assertEquals("https://legacy.example", ServerOrigin.migrated("invalid", "https://legacy.example"));
        assertNull(ServerOrigin.migrated(null, ""));
        assertNull(ServerOrigin.migrated(null, "http://legacy.example"));
    }
    @Test public void vpnOnlyRequiredForTailnet() {
        assertTrue(ServerOrigin.needsTailscale("https://box.example.ts.net"));
        assertFalse(ServerOrigin.needsTailscale("https://box.example"));
        assertFalse(ReachPolicy.failNow(true, false, false));
        assertTrue(ReachPolicy.failNow(true, false, true));
        assertTrue(ReachPolicy.failNow(false, false, false));
    }
    @Test public void rejectGenericOkAndLoginPages() {
        assertFalse(WizardProbe.looksLikeWizard("<title>Sign in</title>"));
        assertFalse(WizardProbe.looksLikeWizard("<title>Wizard OS</title>"));
        assertTrue(WizardProbe.looksLikeWizard("<title>Wizard OS</title><script src='core/app.js'></script>"));
    }
}
