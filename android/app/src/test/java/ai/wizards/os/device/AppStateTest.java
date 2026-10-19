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
        assertFalse(AppState.isQaOrigin("https://wizard.tailc0f369.ts.net"));
        assertFalse(AppState.isQaOrigin("http://evil.example:80"));
        assertFalse(AppState.isQaOrigin("http://localhost:18788/path"));
        assertFalse(AppState.isQaOrigin(null));
    }

    @Test
    public void nativeHttpNeverMovesToTheRetiredName() {
        assertEquals(ai.wizards.os.BuildConfig.ORIGIN, AppState.live(ai.wizards.os.BuildConfig.ORIGIN));
        assertEquals("http://localhost:18788", AppState.live("http://localhost:18788")); // QA fakes never move
    }

    @Test
    public void jsonQuoteIsInertInScript() {
        assertEquals("\"a\\u003c/script\\u003e\\n\\u2028\\u0027\"", Json.quote("a</script>\n\u2028'"));
        assertEquals("{\"a\":\"x\",\"b\":true,\"c\":12}", DeviceBridge.obj("a", "x", "b", "true", "c", "12"));
    }
}
