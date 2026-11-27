package ai.wizards.os;

import static org.junit.Assert.*;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

/** Browser panel (core default; settings.json links.panel false opts out): which browser draws the Custom Tab, and the bridge the shell feature-detects. */
public class PanelLinksTest {
    private static final String SELF = "ai.wizards.os";

    @Test public void theDefaultBrowserDrawsThePanelEvenWhenBraveIsInstalled() {
        assertEquals("default=Chrome + Brave installed", "com.android.chrome", PanelLinks.pick(Arrays.asList("com.brave.browser", "com.android.chrome"), "com.android.chrome", SELF));
        assertEquals("default=Firefox + Brave installed", "org.mozilla.firefox", PanelLinks.pick(Arrays.asList("com.brave.browser", "org.mozilla.firefox"), "org.mozilla.firefox", SELF));
        assertEquals("com.android.chrome", PanelLinks.pick(Arrays.asList("org.mozilla.firefox", "com.android.chrome"), "com.android.chrome", SELF));
    }

    @Test public void braveDefaultDrawsWithBrave() {
        assertEquals("com.brave.browser", PanelLinks.pick(Arrays.asList("com.android.chrome", "com.brave.browser"), "com.brave.browser", SELF));
        assertEquals("com.brave.browser_beta", PanelLinks.pick(Arrays.asList("com.brave.browser", "com.brave.browser_beta"), "com.brave.browser_beta", SELF));
    }

    @Test public void aDefaultWithoutCustomTabsFallsBackToAnInstalledProviderBraveFirst() {
        assertEquals("com.brave.browser", PanelLinks.pick(Arrays.asList("com.android.chrome", "com.brave.browser"), "com.example.plainbrowser", SELF));
        assertEquals("com.brave.browser", PanelLinks.pick(Arrays.asList("com.brave.browser_beta", "com.brave.browser"), null, SELF));
        assertEquals("com.brave.browser_beta", PanelLinks.pick(Arrays.asList("com.android.chrome", "com.brave.browser_beta"), "android", SELF));
        assertEquals("without Brave, the first installed provider", "org.mozilla.firefox", PanelLinks.pick(Arrays.asList("org.mozilla.firefox", "com.android.chrome"), "com.example.plainbrowser", SELF));
        assertEquals("no default (the chooser)", "com.android.chrome", PanelLinks.pick(Arrays.asList("com.android.chrome"), "android", SELF));
        assertEquals("com.android.chrome", PanelLinks.pick(Arrays.asList("com.android.chrome"), null, SELF));
        assertEquals("never this app", "com.android.chrome", PanelLinks.pick(Arrays.asList(SELF, "com.android.chrome"), SELF, SELF));
    }

    @Test public void onOldAndroidALinkAnInstalledAppOwnsGoesToThatAppNotABrowser() { // issue 1948
        java.util.List<String> browsers = Arrays.asList("com.brave.browser", "com.android.chrome");
        assertEquals("YouTube owns youtube.com", "com.google.android.youtube", PanelLinks.appFor(Arrays.asList("com.brave.browser", "com.google.android.youtube", "com.android.chrome"), browsers, SELF));
        assertNull("only browsers: the panel", PanelLinks.appFor(Arrays.asList("com.brave.browser", "com.android.chrome"), browsers, SELF));
        assertNull("the chooser is not an app", PanelLinks.appFor(Arrays.asList("android"), browsers, SELF));
        assertNull("nothing resolves", PanelLinks.appFor(Collections.emptyList(), browsers, SELF));
        assertNull(PanelLinks.appFor(null, browsers, SELF));
    }

    @Test public void theOwnersOwnWizardLinkNeverLoopsBackIntoThisApp() { // issue 1948
        assertNull(PanelLinks.appFor(Arrays.asList(SELF), Arrays.asList("com.android.chrome"), SELF));
        assertNull("this app claims it, even next to another app", PanelLinks.appFor(Arrays.asList("com.example.other", SELF), Arrays.asList("com.android.chrome"), SELF));
        assertTrue(PanelLinks.claimsSelf(Arrays.asList("com.android.chrome", SELF), SELF));
        assertFalse(PanelLinks.claimsSelf(Arrays.asList("com.google.android.youtube"), SELF));
        assertFalse(PanelLinks.claimsSelf(null, SELF));
    }

    @Test public void otherwiseNullMeaningThePlainBrowserOpen() {
        assertNull(PanelLinks.pick(Collections.emptyList(), "com.android.chrome", SELF));
        assertNull(PanelLinks.pick(null, "com.android.chrome", SELF));
        assertNull("never this app", PanelLinks.pick(Arrays.asList(SELF), SELF, SELF));
        assertNull("never this app", PanelLinks.pick(Arrays.asList(SELF), null, SELF));
    }

    @Test public void onlyWebLinksGoIntoThePanel() {
        assertTrue(PanelLinks.web("https")); assertTrue(PanelLinks.web("http"));
        for (String s : new String[]{"javascript", "intent", "file", "content", "", null}) assertFalse(String.valueOf(s), PanelLinks.web(s));
    }

    @Test public void theBridgeTheShellFeatureDetectsAndTheCustomTabsQueryAreWired() throws Exception {
        String main = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/java/ai/wizards/os/MainActivity.java")));
        assertTrue(main.contains("@JavascriptInterface public void openInPanel(String url)"));
        assertTrue("default-browser-first choice", main.contains("PanelLinks.pick(providers"));
        assertTrue("launched from this activity (same task) so Back returns to the chat", main.contains("tab.launchUrl(this, u)"));
        assertFalse("never a new task: Back would not land on the chat", main.contains("tab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK"));
        assertTrue(main.contains("setShowTitle(true)"));
        String manifest = new String(Files.readAllBytes(Paths.get(System.getProperty("user.dir"), "src/main/AndroidManifest.xml")));
        assertTrue("package visibility for Custom Tabs providers (API 30+)", manifest.contains("android.support.customtabs.action.CustomTabsService"));
    }
}
