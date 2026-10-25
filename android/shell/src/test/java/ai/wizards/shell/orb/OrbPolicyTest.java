package ai.wizards.shell.orb;

import org.junit.Test;

import static org.junit.Assert.*;

/** Ported from android/app's OverlayPolicyTest (#323), plus any HTTPS port for the selected Wizard. */
public class OrbPolicyTest {
    static final String O = "https://wizard.example.ts.net", P = "https://wizard.example.ts.net:8444";
    static final String V = OrbPolicy.VIRTUAL;

    @Test public void pageUrls() {
        assertEquals(V + "/wizard-os-home/assist/everywhere.html", OrbPolicy.remoteUrl(O));
        assertEquals(V + "/wizard-os-home/assist/everywhere.html", OrbPolicy.remoteUrl(P));
        assertEquals(V + "/wizard-os-home/assist/everywhere.html", OrbPolicy.bundledUrl());
    }

    @Test public void noWizardCopyWithoutAPlainHttpsOrigin() {
        for (String bad : new String[]{"http://wizard.example.ts.net", "https://user@wizard.example.ts.net", "https://wizard.example.ts.net/sub",
                "https://", "", null, "https://wizard.example.ts.net:0", "https://wizard.example.ts.net?x=1"})
            assertNull(String.valueOf(bad), OrbPolicy.remoteUrl(bad));
    }

    @Test public void anyHttpsPortMapsToTheSamePathOnThatWizard() {
        assertEquals(P + "/wizard-os-home/orb.js", OrbPolicy.upstream(P, V + "/wizard-os-home/orb.js"));
        assertEquals(O + "/wizard-os-home/assist/everywhere.js", OrbPolicy.upstream(O + "/", V + "/wizard-os-home/assist/everywhere.js#x"));
    }

    @Test public void theWizardCopyReachesOnlyTheOrbFiles() {
        for (String ok : new String[]{"assist/everywhere.html", "assist/everywhere.js", "assist/orb-size.js", "orb.js", "robert-thread-orb.png", "robert-listening-galaxy.png"})
            assertTrue(ok, OrbPolicy.fromWizard(P, V + "/wizard-os-home/" + ok));
        for (String bad : new String[]{"index.html", "app.js", "assist/surface.html", "assist/screen.js", "core/settings.js", "api/voice",
                "../wizard/api/sessions", "%2e%2e/wizard/api", "assist%2feverywhere.html", "assist/everywhere.html?x=1"})
            assertFalse(bad, OrbPolicy.fromWizard(P, V + "/wizard-os-home/" + bad));
        assertFalse(OrbPolicy.fromWizard(O, "http://wizard-overlay.invalid/wizard-os-home/orb.js"));
        assertFalse(OrbPolicy.fromWizard(O, "https://wizard-overlay.invalid:8443/wizard-os-home/orb.js"));
        assertFalse(OrbPolicy.fromWizard(O, "https://wizard-overlay.invalid.evil.test/wizard-os-home/orb.js"));
        assertFalse(OrbPolicy.fromWizard(O, "https://u@wizard-overlay.invalid/wizard-os-home/orb.js"));
        assertFalse(OrbPolicy.fromWizard(O, "file:///android_asset/wizard-os-home/orb.js"));
        assertFalse(OrbPolicy.fromWizard(O, "data:text/html,hi"));
        assertFalse(OrbPolicy.fromWizard("http://wizard.example.ts.net", V + "/wizard-os-home/orb.js"));
        assertFalse(OrbPolicy.fromWizard(O, null));
        assertNull(OrbPolicy.upstream(O, V + "/wizard/api/sessions"));
    }

    /** Never the Wizard origin: a service worker there would answer where shouldInterceptRequest can't see. */
    @Test public void orbDocumentsNeverLiveOnTheWizardOrigin() {
        assertTrue(OrbPolicy.remoteUrl(P).startsWith(V + "/"));
        assertFalse(OrbPolicy.fromWizard(P, P + "/wizard-os-home/assist/everywhere.html"));
        assertFalse(OrbPolicy.fromWizard(O, O + "/wizard-os-home/orb.js"));
    }

    @Test public void theBundledCopyReachesOnlyTheBundledOrbFiles() {
        assertTrue(OrbPolicy.bundled(OrbPolicy.bundledUrl()));
        assertTrue(OrbPolicy.bundled(V + "/wizard-os-home/assist/everywhere.js"));
        assertFalse(OrbPolicy.bundled(V + "/wizard-os-home/core/settings.js"));
        assertTrue(OrbPolicy.bundled("file:///android_asset/wizard-os-home/assist/everywhere.html"));
        assertTrue(OrbPolicy.bundled("file:///android_asset/wizard-os-home/robert-thread-orb.png"));
        assertFalse(OrbPolicy.bundled("file:///android_asset/wizard-os-home/../x.js"));
        assertFalse(OrbPolicy.bundled("file:///android_asset/wizard-os-home/assist/surface.html"));
        assertFalse(OrbPolicy.bundled("file:///data/data/ai.wizards.shell/files/x"));
        assertFalse(OrbPolicy.bundled(O + "/wizard-os-home/orb.js"));
        assertFalse(OrbPolicy.bundled(null));
    }

    @Test public void cspDeniesFramesWorkersAndNetwork() {
        for (String d : new String[]{"default-src 'none'", "script-src 'self'", "frame-src 'none'", "worker-src 'none'", "connect-src 'none'", "object-src 'none'"})
            assertTrue(d, OrbPolicy.CSP.contains(d));
        assertTrue(OrbPolicy.samePage(V + "/a.html#x", V + "/a.html"));
        assertFalse(OrbPolicy.samePage(null, "x"));
    }
}
