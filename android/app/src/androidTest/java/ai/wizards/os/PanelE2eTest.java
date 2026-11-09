package ai.wizards.os;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabsService;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

/**
 * Browser panel (settings.json links.panel, on by default; the shell's links.js calls WizardOSNative.openInPanel unless it
 * is false). One synthetic Wizard, no owner traffic. Part 1 intercepts the launch: a Custom Tab intent for the chosen
 * browser (the default browser's), dark toolbar, title shown, started from this app's task. Part 2 lets it open for real,
 * skips the browser's own first-run screens if any still show (so Back measures the panel, not onboarding), requires a
 * Custom Tab in front, then one Back must land on the Wizard page it was tapped from. Instrumentation arg expectPackage
 * pins the browser (com.brave.browser when the QA script made Brave the default); requirePanel=true fails when no
 * browser on the device offers Custom Tabs.
 */
@RunWith(AndroidJUnit4.class)
public class PanelE2eTest {
    private final Instrumentation inst = InstrumentationRegistry.getInstrumentation();
    private final Context c = inst.getTargetContext();
    private final UiDevice device = UiDevice.getInstance(inst);
    private final Bundle args = InstrumentationRegistry.getArguments();

    private void visible(String text) {
        if (device.wait(Until.findObject(By.text(text)), 15000) != null) return;
        shot("fail-" + text.replaceAll("[^A-Za-z0-9]+", "-"));
        fail(text + " not visible; top=" + device.getCurrentPackageName());
    }
    private void shot(String name) {
        try { device.executeShellCommand("screencap -p /data/local/tmp/" + name + ".png"); } catch (IOException ignored) { }
    }
    private String expectedProvider() {
        PackageManager pm = c.getPackageManager();
        List<String> providers = new ArrayList<>();
        for (ResolveInfo ri : pm.queryIntentServices(new Intent(CustomTabsService.ACTION_CUSTOM_TABS_CONNECTION), 0))
            if (ri.serviceInfo != null) providers.add(ri.serviceInfo.packageName);
        ResolveInfo def = pm.resolveActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")).addCategory(Intent.CATEGORY_BROWSABLE), PackageManager.MATCH_DEFAULT_ONLY);
        android.util.Log.i("PanelE2e", "providers=" + providers + " default=" + (def == null || def.activityInfo == null ? null : def.activityInfo.packageName));
        return PanelLinks.pick(providers, def == null || def.activityInfo == null ? null : def.activityInfo.packageName, c.getPackageName());
    }

    /** The resumed activity, e.g. "com.brave.browser/org.chromium.chrome.browser.customtabs.CustomTabActivity". */
    private String resumed() {
        try {
            for (String line : device.executeShellCommand("dumpsys activity activities").split("\n")) {
                String l = line.trim();
                if (!l.startsWith("topResumedActivity") && !l.startsWith("ResumedActivity") && !l.startsWith("mResumedActivity")) continue;
                for (String part : l.split(" ")) if (part.contains("/")) return part.replace("}", "");
            }
        } catch (IOException ignored) { }
        return "";
    }
    private static boolean onboarding(String activity) {
        String a = activity.toLowerCase(java.util.Locale.ROOT);
        return a.contains(".firstrun.") || a.contains("onboarding") || a.contains("welcome");
    }
    private static final java.util.regex.Pattern SKIP = java.util.regex.Pattern.compile(
        "(?i)(skip|not now|no thanks|maybe later|accept (&|and) continue|continue|got it|next|done|start browsing)");
    /** Taps through the browser's first-run screens (harness setup, not the panel). Returns how many taps it took. */
    private int skipOnboarding(String provider) throws InterruptedException {
        int taps = 0;
        for (int i = 0; i < 8; i++) {
            String act = resumed();
            if (!onboarding(act)) break;
            androidx.test.uiautomator.UiObject2 b = device.wait(Until.findObject(By.pkg(provider).text(SKIP).clickable(true)), 4000);
            if (b == null) b = device.wait(Until.findObject(By.pkg(provider).text(SKIP)), 2000);
            if (b == null) { shot("onboarding-stuck-" + i); android.util.Log.w("PanelE2e", "ONBOARDING no skip button on " + act); break; }
            android.util.Log.i("PanelE2e", "ONBOARDING tap '" + b.getText() + "' on " + act);
            b.click(); taps++; Thread.sleep(1500);
        }
        return taps;
    }
    /** The browser's own one-time tip bubbles over a fresh Custom Tab (Brave: "Minimize tab to return to it later"). */
    private static final java.util.regex.Pattern TIP = java.util.regex.Pattern.compile(
        "(?i).*(minimi[sz]e (this )?tab|return to it later).*");
    /** Taps blank page area below the toolbar: closes a tip bubble without touching the panel's own controls. */
    private void tapBlankPage() {
        device.click(device.getDisplayWidth() / 2, device.getDisplayHeight() * 3 / 5);
    }
    /**
     * A fresh browser can float a one-time tip bubble over the Custom Tab, and Back closes that bubble first, so the Back
     * check would measure the browser's tip instead of the panel. Harness setup, not the panel: waits for a tip, taps
     * blank page area (then the bubble itself if it is still there) and fails unless it is gone, so the single Back that
     * follows meets the panel itself. One blank tap is made even when no tip is found, in case a bubble is not exposed to
     * accessibility. Returns how many tips were seen and dismissed.
     */
    private int dismissTips(String provider) throws InterruptedException {
        int dismissed = 0;
        for (int i = 0; i < 4; i++) {
            androidx.test.uiautomator.UiObject2 tip = device.wait(Until.findObject(By.pkg(provider).text(TIP)), i == 0 ? 6000 : 2000);
            if (tip == null) {
                if (i == 0) { tapBlankPage(); Thread.sleep(800); android.util.Log.i("PanelE2e", "TIP none found; one blank tap made"); }
                break;
            }
            String text = tip.getText();
            android.util.Log.i("PanelE2e", "TIP dismiss '" + text + "'");
            shot("panel-2b-tip-" + i);
            tapBlankPage();
            if (!device.wait(Until.gone(By.pkg(provider).text(TIP)), 3000)) {
                tip = device.findObject(By.pkg(provider).text(TIP));
                if (tip != null) tip.click();
                if (!device.wait(Until.gone(By.pkg(provider).text(TIP)), 3000)) {
                    shot("fail-tip-still-showing");
                    fail("the browser's tip is still over the panel after two taps: " + text);
                }
            }
            dismissed++;
            Thread.sleep(500);
        }
        return dismissed;
    }

    /** Captures, and blocks, the next ACTION_VIEW this app starts. */
    private static final class Capture extends Instrumentation.ActivityMonitor {
        volatile Intent seen;
        @Override public Instrumentation.ActivityResult onStartActivity(Intent intent) {
            if (!Intent.ACTION_VIEW.equals(intent.getAction())) return null;
            seen = intent; return new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null);
        }
    }

    @Test public void outsideLinkOpensInACustomTabAndBackReturnsToTheChat() throws Exception {
        assertTrue(BuildConfig.DEBUG);
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        String expect = args.getString("expectPackage", "");
        boolean require = "true".equals(args.getString("requirePanel"));
        String provider = expectedProvider();
        if (!expect.isEmpty()) assertEquals("the browser chosen to draw the panel", expect, provider);
        if (require) assertNotNull("no browser on this device offers Custom Tabs", provider);
        try (Fake wizard = new Fake()) {
            assertTrue(ServerSettings.save(c, wizard.origin()));
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            visible("Chat with a link"); assertEquals(c.getPackageName(), device.getCurrentPackageName()); shot("panel-1-chat");

            // Part 1: what the bridge launches.
            Capture capture = new Capture(); inst.addMonitor(capture);
            try {
                device.findObject(By.text("Open the outside link")).click();
                for (int i = 0; i < 50 && capture.seen == null; i++) Thread.sleep(100);
            } finally { inst.removeMonitor(capture); }
            Intent seen = capture.seen;
            assertNotNull("openInPanel started nothing", seen);
            assertEquals(wizard.outside(), String.valueOf(seen.getData()));
            assertEquals("Wizard stays underneath while the launch is intercepted", c.getPackageName(), device.getCurrentPackageName());
            if (provider == null) { // no Custom Tabs browser: the existing default-browser open, unchanged
                assertFalse(seen.hasExtra(CustomTabsIntent.EXTRA_SESSION));
                android.util.Log.w("PanelE2e", "no Custom Tabs provider on this device: fallback proven, real panel skipped");
                return;
            }
            assertTrue("a Custom Tab, not a plain browser open", seen.hasExtra(CustomTabsIntent.EXTRA_SESSION));
            assertEquals(provider, seen.getPackage());
            assertEquals(CustomTabsIntent.SHOW_PAGE_TITLE, seen.getIntExtra(CustomTabsIntent.EXTRA_TITLE_VISIBILITY_STATE, -1));
            assertEquals(PanelLinks.TOOLBAR, seen.getIntExtra(CustomTabsIntent.EXTRA_TOOLBAR_COLOR, 0));
            assertEquals("same task as the chat", 0, seen.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK);

            // Part 2: the real panel over Wizard, then one Back.
            device.findObject(By.text("Open the outside link")).click();
            for (int i = 0; i < 200 && !provider.equals(device.getCurrentPackageName()); i++) Thread.sleep(100);
            assertEquals("the panel came to the front over Wizard", provider, device.getCurrentPackageName());
            int taps = skipOnboarding(provider);
            for (int i = 0; i < 100 && !resumed().contains("CustomTab"); i++) Thread.sleep(100);
            String front = resumed();
            android.util.Log.i("PanelE2e", "PANEL_FRONT activity=" + front + " onboardingTaps=" + taps);
            if (!front.contains("CustomTab")) shot("fail-not-custom-tab");
            assertTrue("a Custom Tab is in front before Back (not the browser's onboarding), resumed=" + front, front.contains("CustomTab"));
            boolean page = device.wait(Until.hasObject(By.textContains("Outside page")), 15000);
            shot("panel-2-open");
            // Reported, not asserted: whether a browser loads a loopback http page is that browser's policy, not WizardOS's.
            android.util.Log.i("PanelE2e", "PANEL_PAGE text=" + page + " served=" + wizard.outsideLoads);
            int tips = dismissTips(provider);
            String still = resumed();
            android.util.Log.i("PanelE2e", "TIPS dismissed=" + tips + " resumed=" + still);
            assertTrue("the Custom Tab is still in front after clearing the browser's tips, resumed=" + still, still.contains("CustomTab"));
            assertFalse("no browser tip is showing before the one Back", device.hasObject(By.pkg(provider).text(TIP)));
            shot("panel-2c-before-back");
            int loads = wizard.shellLoads;
            device.pressBack();
            for (int i = 0; i < 100 && !c.getPackageName().equals(device.getCurrentPackageName()); i++) Thread.sleep(100);
            boolean back = c.getPackageName().equals(device.getCurrentPackageName());
            shot("panel-3-after-back");
            assertTrue("one Back returns to WizardOS, top=" + device.getCurrentPackageName(), back);
            visible("Chat with a link");
            android.util.Log.i("PanelE2e", "PANEL_BACK shell reloads after Back=" + (wizard.shellLoads - loads));
        }
    }

    private static final class Fake implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        volatile boolean running = true; volatile int shellLoads, outsideLoads;
        Fake() throws IOException {
            new Thread(() -> { while (running) try { respond(socket.accept()); } catch (IOException ignored) {} }, "Fake-panel").start();
        }
        String origin() { return "http://localhost:" + socket.getLocalPort(); }
        String outside() { return "http://127.0.0.1:" + socket.getLocalPort() + "/outside"; }
        private void respond(Socket s) throws IOException {
            try (Socket client = s) {
                client.setSoTimeout(3000);
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                String request = in.readLine(); if (request == null) return;
                while (true) { String h = in.readLine(); if (h == null || h.isEmpty()) break; }
                boolean shell = request.startsWith("GET /wizard-os-home/"), out = request.startsWith("GET /outside");
                if (shell) shellLoads++;
                if (out) outsideLoads++;
                String html = shell
                    ? "<!doctype html><title>WizardOS</title><!-- core/ QA fixture -->"
                    + "<meta name='viewport' content='width=device-width, initial-scale=1'><body style='background:#05030c;color:#f3efff;font:22px sans-serif;padding-top:120px'>"
                    + "<p>Chat with a link</p><p><button id='go'>Open the outside link</button></p>"
                    + "<script>document.getElementById('go').onclick=()=>window.WizardOSNative.openInPanel('" + outside() + "');"
                    + "window.__wosNativeBack=()=>'handled';</script>"
                    : out ? "<!doctype html><title>Outside page</title><body style='font:28px sans-serif'><h1>Outside page</h1>" : "{}";
                byte[] bytes = html.getBytes(StandardCharsets.UTF_8);
                OutputStream o = client.getOutputStream();
                o.write(("HTTP/1.1 200 OK\r\nContent-Type: " + (shell || out ? "text/html" : "application/json") + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                o.write(bytes);
            }
        }
        @Override public void close() throws IOException { running = false; socket.close(); }
    }
}
