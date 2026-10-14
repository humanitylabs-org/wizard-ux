package ai.wizards.os.device;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AppStateTest {
    @Test
    public void onlyLoopbackFakesCanReplaceTheOrigin() {
        assertTrue(AppState.isQaOrigin("http://localhost:18788"));
        assertTrue(AppState.isQaOrigin("http://10.0.2.2:18788"));
        assertFalse(AppState.isQaOrigin("https://wizard.example.ts.net"));
        assertFalse(AppState.isQaOrigin("http://evil.example:80"));
        assertFalse(AppState.isQaOrigin("http://localhost:18788/path"));
        assertFalse(AppState.isQaOrigin(null));
    }

    @Test
    public void safetyNetRewritesOnlyTheOwnOrigin() {
        try {
            WizardAddress.setForTest("https://wizard.example.ts.net", "old-name.example.com");
            AppState.legacyFallback = false;
            assertEquals("https://wizard.example.ts.net", AppState.live("https://wizard.example.ts.net"));
            AppState.legacyFallback = true;
            assertEquals("https://old-name.example.com", AppState.live("https://wizard.example.ts.net"));
            assertEquals("http://localhost:18788", AppState.live("http://localhost:18788")); // QA fakes never move
            // A Wizard with no older name has no safety net.
            WizardAddress.setForTest("https://wizard.example.ts.net");
            assertEquals("https://wizard.example.ts.net", AppState.live("https://wizard.example.ts.net"));
        } finally {
            AppState.legacyFallback = false;
            WizardAddress.setForTest("");
        }
    }

    @Test
    public void jsonQuoteIsInertInScript() {
        assertEquals("\"a\\u003c/script\\u003e\\n\\u2028\\u0027\"", Json.quote("a</script>\n\u2028'"));
        assertEquals("{\"a\":\"x\",\"b\":true,\"c\":12}", DeviceBridge.obj("a", "x", "b", "true", "c", "12"));
    }
}
