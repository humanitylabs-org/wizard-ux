package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Overlay pages: the Wizard copy only from exactly the Wizard's https origin, the bundled copy otherwise. */
public class OverlayPolicyTest {
    static final String O = "https://wizard.example.ts.net";

    @Test public void pageUrls() {
        assertEquals(O + "/wizard-os-home/assist/everywhere.html", OverlayPolicy.remoteUrl(O, "everywhere.html"));
        assertEquals(O + "/wizard-os-home/assist/surface.html#corner", OverlayPolicy.remoteUrl(O + "/", "surface.html#corner"));
        assertEquals("file:///android_asset/wizard-os-home/assist/screen.html", OverlayPolicy.bundledUrl("screen.html"));
    }

    @Test public void noWizardCopyWithoutAPlainHttpsOrigin() {
        assertNull(OverlayPolicy.remoteUrl("http://wizard.example.ts.net", "surface.html"));
        assertNull(OverlayPolicy.remoteUrl("https://user@wizard.example.ts.net", "surface.html"));
        assertNull(OverlayPolicy.remoteUrl("https://wizard.example.ts.net/sub", "surface.html"));
        assertNull(OverlayPolicy.remoteUrl("https://", "surface.html"));
        assertNull(OverlayPolicy.remoteUrl("", "surface.html"));
        assertNull(OverlayPolicy.remoteUrl(null, "surface.html"));
    }

    @Test public void theWizardCopyReachesOnlyTheWizardsShell() {
        assertTrue(OverlayPolicy.fromWizard(O, O + "/wizard-os-home/assist/surface.html"));
        assertTrue(OverlayPolicy.fromWizard(O, O + "/wizard-os-home/assist/surface.html#corner"));
        assertTrue(OverlayPolicy.fromWizard(O, O + "/wizard-os-home/orb.js"));
        assertTrue(OverlayPolicy.fromWizard(O, "https://WIZARD.example.ts.net:443/wizard-os-home/motion/wizard-motion.css"));
        assertFalse(OverlayPolicy.fromWizard(O, "http://wizard.example.ts.net/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "https://wizard.example.ts.net:8443/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "https://wizard.example.ts.net.evil.test/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "https://evil-wizard.example.ts.net/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "https://u@wizard.example.ts.net/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, O + "/wizard/api/sessions"));
        assertFalse(OverlayPolicy.fromWizard(O, O + "/wizard-os-home/api/voice"));
        assertFalse(OverlayPolicy.fromWizard(O, O + "/wizard-os-home-preview/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, O + "/wizard-os-home/../wizard/api/sessions"));
        assertFalse(OverlayPolicy.fromWizard(O, O + "/wizard-os-home/%2e%2e/wizard/api/sessions"));
        assertFalse(OverlayPolicy.fromWizard(O, "file:///android_asset/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "data:text/html,hi"));
        assertFalse(OverlayPolicy.fromWizard(O, "javascript:alert(1)"));
        assertFalse(OverlayPolicy.fromWizard("http://wizard.example.ts.net", "http://wizard.example.ts.net/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, null));
    }

    @Test public void theBundledCopyReachesOnlyTheBundledShell() {
        assertTrue(OverlayPolicy.bundled("file:///android_asset/wizard-os-home/assist/surface.html#corner"));
        assertTrue(OverlayPolicy.bundled("file:///android_asset/wizard-os-home/robert-thread-orb.png"));
        assertFalse(OverlayPolicy.bundled("file:///android_asset/scroll-capture.js"));
        assertFalse(OverlayPolicy.bundled("file:///android_asset/wizard-os-home/../scroll-capture.js"));
        assertFalse(OverlayPolicy.bundled("file:///data/data/ai.wizards.os/files/x"));
        assertFalse(OverlayPolicy.bundled(O + "/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.bundled(null));
    }

    @Test public void samePageIgnoresTheFragment() {
        assertTrue(OverlayPolicy.samePage(O + "/wizard-os-home/assist/surface.html#corner", O + "/wizard-os-home/assist/surface.html"));
        assertFalse(OverlayPolicy.samePage(O + "/wizard-os-home/assist/surface.html", OverlayPolicy.bundledUrl("surface.html")));
        assertFalse(OverlayPolicy.samePage(null, "x"));
    }

    @Test public void theWizardOriginIsTheBuildOrigin() {
        assertEquals(BuildConfig.ORIGIN, OverlayPolicy.wizardOrigin());
    }
}
