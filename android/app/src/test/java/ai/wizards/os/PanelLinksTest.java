package ai.wizards.os;

import static org.junit.Assert.*;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

/** Browser panel trial (settings.json links.panel): which browser draws the Custom Tab, and the bridge the shell feature-detects. */
public class PanelLinksTest {
    private static final String SELF = "ai.wizards.os";

    @Test public void braveDrawsThePanelWhenInstalledEvenIfAnotherBrowserIsDefault() {
        assertEquals("com.brave.browser", PanelLinks.pick(Arrays.asList("com.android.chrome", "com.brave.browser"), "com.android.chrome", SELF));
        assertEquals("com.brave.browser", PanelLinks.pick(Arrays.asList("com.brave.browser_beta", "com.brave.browser"), null, SELF));
        assertEquals("com.brave.browser_beta", PanelLinks.pick(Arrays.asList("com.android.chrome", "com.brave.browser_beta"), "com.android.chrome", SELF));
    }

    @Test public void withoutBraveTheDefaultBrowsersCustomTab() {
        assertEquals("com.android.chrome", PanelLinks.pick(Arrays.asList("org.mozilla.firefox", "com.android.chrome"), "com.android.chrome", SELF));
    }

    @Test public void otherwiseNullMeaningThePlainBrowserOpen() {
        assertNull(PanelLinks.pick(Collections.emptyList(), "com.android.chrome", SELF));
        assertNull(PanelLinks.pick(null, "com.android.chrome", SELF));
        assertNull("default browser without Custom Tabs", PanelLinks.pick(Arrays.asList("org.mozilla.firefox"), "com.example.plainbrowser", SELF));
        assertNull("no default (the chooser)", PanelLinks.pick(Arrays.asList("com.android.chrome"), "android", SELF));
        assertNull(PanelLinks.pick(Arrays.asList("com.android.chrome"), null, SELF));
        assertNull("never this app", PanelLinks.pick(Arrays.asList(SELF), SELF, SELF));
    }

    @Test public void onlyWebLinksGoIntoThePanel() {
        assertTrue(PanelLinks.web("https")); assertTrue(PanelLinks.web("http"));
        for (String s : new String[]{"javascript", "intent", "file", "content", "", null}) assertFalse(String.valueOf(s), PanelLinks.web(s));
    }

    @Test public void theBridgeTheShellFeatureDetectsAndTheCustomTabsQueryAreWired() throws Exception {
        String main = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/java/ai/wizards/os/MainActivity.java")));
        assertTrue(main.contains("@JavascriptInterface public void openInPanel(String url)"));
        assertTrue("Brave/default choice", main.contains("PanelLinks.pick(providers"));
        assertTrue("launched from this activity (same task) so Back returns to the chat", main.contains("tab.launchUrl(this, u)"));
        assertFalse("never a new task: Back would not land on the chat", main.contains("tab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK"));
        assertTrue(main.contains("setShowTitle(true)"));
        String manifest = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/AndroidManifest.xml")));
        assertTrue("package visibility for Custom Tabs providers (API 30+)", manifest.contains("android.support.customtabs.action.CustomTabsService"));
    }
}
