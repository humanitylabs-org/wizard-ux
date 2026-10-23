package ai.wizards.os;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Overlay pages: the Wizard copy only from exactly the Wizard's https origin, the bundled copy otherwise. */
public class OverlayPolicyTest {
    static final String O = "https://wizard.example.ts.net";
    static final String V = OverlayPolicy.VIRTUAL;

    @Test public void pageUrls() {
        assertEquals(V + "/wizard-os-home/assist/everywhere.html", OverlayPolicy.remoteUrl(O, "everywhere.html"));
        assertEquals(V + "/wizard-os-home/assist/surface.html#corner", OverlayPolicy.remoteUrl(O + "/", "surface.html#corner"));
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
        assertTrue(OverlayPolicy.fromWizard(O, V + "/wizard-os-home/assist/surface.html"));
        assertTrue(OverlayPolicy.fromWizard(O, V + "/wizard-os-home/assist/surface.html#corner"));
        assertTrue(OverlayPolicy.fromWizard(O, V + "/wizard-os-home/orb.js"));
        assertTrue(OverlayPolicy.fromWizard(O, V + "/wizard-os-home/motion/wizard-motion.css"));
        assertEquals(O + "/wizard-os-home/motion/wizard-motion.css", OverlayPolicy.upstream(O + "/", V + "/wizard-os-home/motion/wizard-motion.css#x"));
        assertFalse(OverlayPolicy.fromWizard(O, "http://wizard-overlay.invalid/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "https://wizard-overlay.invalid:8443/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "https://wizard-overlay.invalid.evil.test/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "https://u@wizard-overlay.invalid/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, V + "/wizard/api/sessions"));
        assertFalse(OverlayPolicy.fromWizard(O, V + "/wizard-os-home/api/voice"));
        assertFalse(OverlayPolicy.fromWizard(O, V + "/wizard-os-home-preview/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, V + "/wizard-os-home/../wizard/api/sessions"));
        assertFalse(OverlayPolicy.fromWizard(O, V + "/wizard-os-home/%2e%2e/wizard/api/sessions"));
        assertFalse(OverlayPolicy.fromWizard(O, V + "/wizard-os-home/assist%2fsurface.html"));
        assertFalse(OverlayPolicy.fromWizard(O, "file:///android_asset/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "data:text/html,hi"));
        assertFalse(OverlayPolicy.fromWizard(O, "javascript:alert(1)"));
        assertFalse(OverlayPolicy.fromWizard("http://wizard.example.ts.net", V + "/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, null));
        assertNull(OverlayPolicy.upstream(O, V + "/wizard/api/sessions"));
    }

    /** Never the Wizard origin: a service worker registered there (web/sw.js at /wizard-os-home/) would answer the
     *  overlay's requests where shouldInterceptRequest can't see them. Requests ON the Wizard origin are refused. */
    @Test public void overlayDocumentsNeverLiveOnTheWizardOrigin() {
        for (String page : new String[]{"surface.html", "everywhere.html", "screen.html#x"})
            assertTrue(OverlayPolicy.remoteUrl(O, page).startsWith(V + "/"));
        assertFalse(OverlayPolicy.fromWizard(O, O + "/wizard-os-home/assist/surface.html"));
        assertFalse(OverlayPolicy.fromWizard(O, O + "/wizard-os-home/orb.js"));
        assertFalse(OverlayPolicy.fromWizard(O, "https://WIZARD.example.ts.net:443/wizard-os-home/orb.js"));
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
        assertTrue(OverlayPolicy.samePage(V + "/wizard-os-home/assist/surface.html#corner", V + "/wizard-os-home/assist/surface.html"));
        assertFalse(OverlayPolicy.samePage(O + "/wizard-os-home/assist/surface.html", OverlayPolicy.bundledUrl("surface.html")));
        assertFalse(OverlayPolicy.samePage(null, "x"));
    }

    @Test public void rejectBroaderShellFramesQueriesAndInvalidPorts() {
        for (String path : new String[]{"index.html", "core/settings.js", "api", "api/voice", "assist/unknown.html", "assist/%73urface.html", "assist/surface.html?x=1"})
            assertFalse(path, OverlayPolicy.fromWizard(O, V + "/wizard-os-home/" + path));
        for (String port : new String[]{":0", ":8443", ":65536"})
            assertNull(OverlayPolicy.remoteUrl(O + port, "surface.html"));
        assertNull(OverlayPolicy.remoteUrl(O, "../index.html"));
        assertFalse(OverlayPolicy.bundled(OverlayPolicy.ASSETS + "index.html"));
        assertTrue(OverlayPolicy.CSP.contains("frame-src 'none'"));
        assertTrue(OverlayPolicy.CSP.contains("worker-src 'none'"));
        assertTrue(OverlayPolicy.CSP.contains("connect-src 'none'"));
    }
}
