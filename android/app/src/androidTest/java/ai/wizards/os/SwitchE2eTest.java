package ai.wizards.os;

import android.content.Context;
import android.content.Intent;
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
import static org.junit.Assert.*;

/**
 * Two synthetic Wizards; no owner traffic. The fake shell's switcher follows the web contract
 * (web/core/workspaces.js): ask WizardOSNative.switchWizard, else navigate to the other origin.
 * The "old behaviour" button is that navigation alone, which the app hands to the phone's browser.
 */
@RunWith(AndroidJUnit4.class)
public class SwitchE2eTest {
    private final Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private void visible(String text) {
        if (device.wait(Until.findObject(By.text(text)), 15000) != null) return;
        shot("fail-" + text.replaceAll("[^A-Za-z0-9]+", "-"));
        try { java.io.ByteArrayOutputStream dump = new java.io.ByteArrayOutputStream(); device.dumpWindowHierarchy(dump); android.util.Log.e("SwitchE2e", dump.toString("UTF-8")); } catch (IOException ignored) { }
        fail(text + " not visible; origin=" + ServerSettings.origin(c) + " top=" + device.getCurrentPackageName());
    }
    private void foreground() { assertEquals(c.getPackageName(), device.getCurrentPackageName()); }
    private void shot(String name) {
        try { device.executeShellCommand("screencap -p /data/local/tmp/" + name + ".png"); } catch (IOException ignored) { }
    }

    @Test public void switchingStaysInTheAppAndTheWayBackWorks() throws Exception {
        assertTrue(BuildConfig.DEBUG);
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        try (Fake one = new Fake("Wizard one"); Fake two = new Fake("Wizard two")) {
            one.other = two.origin(); two.other = one.origin();
            assertTrue(ServerSettings.save(c, one.origin()));
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            visible("Wizard one"); foreground(); shot("switch-1-wizard-one");

            device.findObject(By.text("Switch to the other Wizard")).click();
            visible("Wizard two"); foreground(); shot("switch-2-wizard-two");
            assertEquals(two.origin(), ServerSettings.origin(c));
            assertTrue("the app's own page load reached the second Wizard", two.shellLoads > 0);

            // The way back: Change Wizard offers the Wizard this app was just on.
            device.findObject(By.text("Change Wizard")).click();
            visible("Back to your previous Wizard"); shot("switch-3-way-back");
            device.findObject(By.text("Back to your previous Wizard")).click();
            visible("Wizard one"); foreground();
            assertEquals(one.origin(), ServerSettings.origin(c));

            // Not a Wizard of this owner: refused, the page falls back to its own navigation, the saved Wizard is unchanged.
            assertNull(WizardSwitch.target(ai.wizards.os.device.AppState.primaryOrigin(c), "https://evil.example", true));
            assertEquals(one.origin(), ServerSettings.origin(c));
        }
    }

    private static final class Fake implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        final String name; volatile boolean running = true; volatile String other = ""; volatile int shellLoads;
        Fake(String name) throws IOException {
            this.name = name;
            new Thread(() -> { while (running) try { respond(socket.accept()); } catch (IOException ignored) {} }, "Fake-" + name).start();
        }
        String origin() { return "http://localhost:" + socket.getLocalPort(); }
        private void respond(Socket s) throws IOException {
            try (Socket client = s) {
                client.setSoTimeout(3000);
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                String request = in.readLine(); if (request == null) return;
                while (true) { String h = in.readLine(); if (h == null || h.isEmpty()) break; }
                boolean shell = request.startsWith("GET /wizard-os-home/");
                if (shell) shellLoads++;
                String html = "<!doctype html><title>WizardOS</title><!-- core/ QA fixture -->"
                    + "<meta name='viewport' content='width=device-width, initial-scale=1'><body style='background:#05030c;color:#f3efff;font:22px sans-serif;padding-top:120px'>"
                    + "<p id='place'>" + name + "</p>"
                    + "<p><button id='sw'>Switch to the other Wizard</button></p><p><button id='old'>Old behaviour: navigate</button></p><p><button id='chg'>Change Wizard</button></p>"
                    + "<script>const OTHER=" + js(other) + ";"
                    + "document.getElementById('sw').onclick=()=>{const d=window.WizardOSNative;"
                    + "if(d&&typeof d.switchWizard==='function'&&d.switchWizard(OTHER)==='started')return;location.assign(OTHER+'/wizard-os-home/#wzfrom=x');};"
                    + "document.getElementById('old').onclick=()=>location.assign(OTHER+'/wizard-os-home/#wzfrom=x');"
                    + "document.getElementById('chg').onclick=()=>window.WizardOSNative.changeServer();"
                    + "window.__wosNativeBack=()=>'handled';</script>";
                byte[] bytes = (shell ? html : "{}").getBytes(StandardCharsets.UTF_8);
                OutputStream out = client.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + (shell ? "text/html" : "application/json") + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.write(bytes);
            }
        }
        private static String js(String v) { return "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }
        @Override public void close() throws IOException { running = false; socket.close(); }
    }
}
