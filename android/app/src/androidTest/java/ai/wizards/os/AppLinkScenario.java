package ai.wizards.os;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import static org.junit.Assert.*;

/**
 * wizard-ux issue 1948: a tapped link an installed app owns (YouTube owning youtube.com) opens in that app, not the
 * browser panel; a link no app owns still opens the panel; a link this app claims itself never hands off (no loop).
 * The test APK's AppLinkTarget owns https://applink-1948.wizard.test, made the phone's choice for it the way a person
 * leaves "Open supported links" on (pm set-app-links-user-selection), then off again. One synthetic Wizard on
 * localhost, no owner traffic. Panel launches are intercepted, so no browser has to load anything.
 */
final class AppLinkScenario {
    private AppLinkScenario() { }

    static final String OWNED = "https://applink-1948.wizard.test/watch?v=dQw4w9WgXcQ";
    /** The debug build's own deep-link host (no origin baked in): this app claims /wizard-os-home/ on it. */
    static final String OWN = "https://unconfigured.invalid/wizard-os-home/1948";

    /** Records every VIEW this app starts; lets the app hand-off (FLAG_ACTIVITY_REQUIRE_NON_BROWSER) really start, blocks the rest. */
    private static final class Capture extends Instrumentation.ActivityMonitor {
        final List<Intent> handoffs = new CopyOnWriteArrayList<>(), blocked = new CopyOnWriteArrayList<>();
        @Override public Instrumentation.ActivityResult onStartActivity(Intent intent) {
            if (!Intent.ACTION_VIEW.equals(intent.getAction())) return null;
            boolean handoff = android.os.Build.VERSION.SDK_INT >= 30 && (intent.getFlags() & Intent.FLAG_ACTIVITY_REQUIRE_NON_BROWSER) != 0
                    || android.os.Build.VERSION.SDK_INT < 30 && intent.getPackage() != null && !intent.hasExtra(CustomTabsIntent.EXTRA_SESSION) && !"ai.wizards.os".equals(intent.getPackage());
            if (handoff) { handoffs.add(intent); return null; }
            blocked.add(intent);
            return new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null);
        }
    }

    static void run() throws Exception {
        Instrumentation inst = InstrumentationRegistry.getInstrumentation();
        Context c = inst.getTargetContext();
        UiDevice device = UiDevice.getInstance(inst);
        String testPkg = inst.getContext().getPackageName();
        assertTrue(BuildConfig.DEBUG);
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        boolean selection = android.os.Build.VERSION.SDK_INT >= 31;
        if (selection) {
            sh(device, "pm set-app-links-user-selection --user 0 --package " + testPkg + " false applink-1948.wizard.test");
            // The strongest loop case: this app is the phone's choice for its own Wizard links.
            sh(device, "pm set-app-links-user-selection --user 0 --package " + c.getPackageName() + " true unconfigured.invalid");
        }
        try (Fake wizard = new Fake()) {
            assertTrue(ServerSettings.save(c, wizard.origin()));
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            assertNotNull("the synthetic chat never showed", device.wait(Until.findObject(By.text("Chat with links")), 30000));

            // 1. A link no app owns: the browser panel, exactly as before.
            Capture plain = tap(inst, device, "Open the outside link");
            assertEquals("plain link: no app hand-off", 0, plain.handoffs.size());
            assertEquals("plain link: one panel launch", 1, plain.blocked.size());
            assertEquals(wizard.outside(), plain.blocked.get(0).getDataString());

            if (selection) {
                // 2. The owning app is installed but the person turned "Open supported links" off for it: the panel.
                Capture off = tap(inst, device, "Open the app link");
                android.util.Log.i("AppLink1948", "OFF handoffs=" + off.handoffs.size() + " blocked=" + off.blocked.size());
                assertEquals("supported links off: the panel opens", 1, off.blocked.size());
                assertEquals(OWNED, off.blocked.get(0).getDataString());
                assertEquals(c.getPackageName(), device.getCurrentPackageName());
                sh(device, "pm set-app-links-user-selection --user 0 --package " + testPkg + " true applink-1948.wizard.test");
                android.util.Log.i("AppLink1948", "LINKS " + sh(device, "pm get-app-links --user 0 " + testPkg).replace('\n', ' '));
            }

            // 3. A link an installed app owns: that app opens, no panel.
            Capture owned = tap(inst, device, "Open the app link");
            android.util.Log.i("AppLink1948", "OWNED handoffs=" + owned.handoffs.size() + " blocked=" + owned.blocked.size());
            assertEquals("owned link: handed to the app", 1, owned.handoffs.size());
            assertEquals(OWNED, owned.handoffs.get(0).getDataString());
            assertEquals("owned link: no panel", 0, owned.blocked.size());
            assertNotNull("the owning app is in front", device.wait(Until.findObject(By.pkg(testPkg).textContains("Opened in the app: " + OWNED)), 15000));
            assertEquals(testPkg, device.getCurrentPackageName());
            device.pressBack();
            assertNotNull("Back returns to the chat", device.wait(Until.findObject(By.text("Chat with links")), 15000));

            // 4. A link this app claims itself: never handed off, so it can't loop back into Wizard.
            Capture own = tap(inst, device, "Open an own Wizard link");
            android.util.Log.i("AppLink1948", "OWN handoffs=" + own.handoffs.size() + " blocked=" + own.blocked.size());
            assertEquals("own link: no app hand-off", 0, own.handoffs.size());
            assertEquals("own link: the panel, as before", 1, own.blocked.size());
            assertEquals(OWN, own.blocked.get(0).getDataString());
            assertFalse("own link: not re-opened in this app", c.getPackageName().equals(own.blocked.get(0).getPackage()));
        } finally {
            if (selection) {
                sh(device, "pm set-app-links-user-selection --user 0 --package " + testPkg + " false applink-1948.wizard.test");
                sh(device, "pm set-app-links-user-selection --user 0 --package " + c.getPackageName() + " false unconfigured.invalid");
            }
        }
    }

    private static Capture tap(Instrumentation inst, UiDevice device, String button) throws InterruptedException {
        Capture capture = new Capture(); inst.addMonitor(capture);
        try {
            device.wait(Until.findObject(By.text(button)), 10000).click();
            for (int i = 0; i < 50 && capture.handoffs.isEmpty() && capture.blocked.isEmpty(); i++) Thread.sleep(100);
            Thread.sleep(1500); // a fallback after a refused hand-off comes right behind it
        } finally { inst.removeMonitor(capture); }
        return capture;
    }

    private static String sh(UiDevice device, String cmd) {
        try { String out = device.executeShellCommand(cmd); android.util.Log.i("AppLink1948", "$ " + cmd + " -> " + out.trim()); return out; }
        catch (IOException e) { throw new AssertionError(cmd, e); }
    }

    private static final class Fake implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        volatile boolean running = true;
        Fake() throws IOException {
            new Thread(() -> { while (running) try { respond(socket.accept()); } catch (IOException ignored) {} }, "Fake-applink-1948").start();
        }
        String origin() { return "http://localhost:" + socket.getLocalPort(); }
        String outside() { return "http://127.0.0.1:" + socket.getLocalPort() + "/outside"; }
        private static String button(String label, String url) {
            return "<p><button onclick=\"window.WizardOSNative.openInPanel('" + url + "')\">" + label + "</button></p>";
        }
        private void respond(Socket s) throws IOException {
            try (Socket client = s) {
                client.setSoTimeout(3000);
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                String request = in.readLine(); if (request == null) return;
                while (true) { String h = in.readLine(); if (h == null || h.isEmpty()) break; }
                boolean shell = request.startsWith("GET /wizard-os-home/");
                String html = shell
                    ? "<!doctype html><title>WizardOS</title><!-- core/ QA fixture -->"
                    + "<meta name='viewport' content='width=device-width, initial-scale=1'><body style='background:#05030c;color:#f3efff;font:22px sans-serif;padding-top:120px'>"
                    + "<p>Chat with links</p>" + button("Open the outside link", outside()) + button("Open the app link", OWNED)
                    + button("Open an own Wizard link", OWN) + "<script>window.__wosNativeBack=()=>'handled';</script>"
                    : "{}";
                byte[] bytes = html.getBytes(StandardCharsets.UTF_8);
                OutputStream o = client.getOutputStream();
                o.write(("HTTP/1.1 200 OK\r\nContent-Type: " + (shell ? "text/html" : "application/json") + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                o.write(bytes);
            }
        }
        @Override public void close() throws IOException { running = false; socket.close(); }
    }
}
