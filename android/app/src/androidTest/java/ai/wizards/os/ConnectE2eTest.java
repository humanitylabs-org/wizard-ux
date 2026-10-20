package ai.wizards.os;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
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

/** Synthetic Wizard only; no requests, chats or sign-in on an owner's box. */
@RunWith(AndroidJUnit4.class)
public class ConnectE2eTest {
    private final Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private void visible(String text) { assertNotNull(text, device.wait(Until.findObject(By.text(text)), 15000)); }
    private void foreground() { assertEquals(c.getPackageName(), device.getCurrentPackageName()); }
    private void start(Class<?> activity) { c.startActivity(new Intent(c, activity).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
    private void shot(String name) { device.takeScreenshot(new File(c.getExternalFilesDir(null), name + ".png")); }

    @Test public void freshPairingNestedAndRootBackPersistenceAndChange() throws Exception {
        assertTrue(BuildConfig.DEBUG);
        assertTrue(Build.MODEL.contains("sdk") || Build.FINGERPRINT.contains("generic"));
        assertEquals("", BuildConfig.ORIGIN);
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        try (FakeWizard fake = new FakeWizard(); FakeWizard other = new FakeWizard()) {
            start(MainActivity.class);
            visible("Connect to your Wizard"); shot("connect-fresh");
            device.pressBack(); visible("Connect to your Wizard"); foreground();
            // The actual QR scanner is a nested native activity: cancelling returns to Connect, not the launcher.
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(c.getPackageName(), "android.permission.CAMERA");
            device.findObject(By.text("Scan QR code")).click();
            Thread.sleep(1800); device.pressBack(); visible("Connect to your Wizard"); foreground();
            device.findObject(By.desc("Wizard address")).setText(fake.origin());
            device.findObject(By.text("Connect")).click();
            visible("Fixture home"); foreground(); shot("connect-shell");
            assertEquals(fake.origin(), ServerSettings.origin(c));
            assertEquals(fake.origin(), ai.wizards.os.device.AppState.origin(c));
            assertEquals(fake.origin(), ai.wizards.os.mizel.MizelConfig.origin(c));
            device.findObject(By.text("Open nested")).click(); visible("Fixture nested");
            device.pressBack(); visible("Fixture home"); foreground(); shot("connect-nested-back");
            device.pressBack(); visible("Fixture home"); foreground();
            // A new Activity/process-independent persisted read uses the same server.
            start(ConnectActivity.class); visible("Keep current Wizard");
            device.pressBack(); visible("Fixture home"); foreground();
            start(ConnectActivity.class); visible("Keep current Wizard");
            device.findObject(By.desc("Wizard address")).setText("http://evil.example");
            device.findObject(By.text("Connect")).click();
            visible("Enter an HTTPS box address without credentials, query or fragment.");
            assertEquals(fake.origin(), ServerSettings.origin(c));
            // A generic HTTP 200 must not replace the configured box; a second real fixture can.
            other.wizard = false;
            device.findObject(By.desc("Wizard address")).setText(other.origin());
            device.findObject(By.text("Connect")).click();
            visible("Could not verify this Wizard. Check the address, Tailscale, HTTPS certificate and owner access, then retry.");
            assertEquals(fake.origin(), ServerSettings.origin(c));
            other.wizard = true;
            device.findObject(By.text("Connect")).click(); visible("Fixture home"); foreground();
            assertEquals(other.origin(), ServerSettings.origin(c));
            assertEquals(other.origin(), ai.wizards.os.device.AppState.origin(c));
            assertEquals(other.origin(), ai.wizards.os.mizel.MizelConfig.origin(c));
            assertFalse(Origin.isPrivate(c, Uri.parse(fake.origin() + "/wizard-os-home/")));
            assertTrue(Origin.isPrivate(c, Uri.parse(other.origin() + "/wizard-os-home/")));
            start(ConnectActivity.class); visible("Keep current Wizard");
            // A legitimate HTTPS pairing intent only prefills; it cannot replace the saved server.
            c.startActivity(new Intent(c, ConnectActivity.class).setData(Uri.parse("wizard://connect?origin=https%3A%2F%2Fother.example")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            visible("Check this Wizard address, then tap Connect.");
            assertEquals(other.origin(), ServerSettings.origin(c)); shot("connect-pairing-confirmation");
            device.pressBack(); visible("Fixture home"); foreground();
        }
    }

    private static final class FakeWizard implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        volatile boolean running = true, wizard = true;
        FakeWizard() throws IOException {
            new Thread(() -> { while (running) try { respond(socket.accept()); } catch (IOException ignored) {} }, "FakeWizard").start();
        }
        String origin() { return "http://localhost:" + socket.getLocalPort(); }
        private void respond(Socket s) throws IOException {
            try (Socket client = s) {
                client.setSoTimeout(3000);
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                String request = in.readLine(); if (request == null) return;
                String header; int length = 0;
                while ((header = in.readLine()) != null && !header.isEmpty()) if (header.toLowerCase().startsWith("content-length:")) length = Integer.parseInt(header.substring(15).trim());
                for (int i = 0; i < length; i++) if (in.read() < 0) break;
                boolean shell = request.startsWith("GET /wizard-os-home/");
                String html = "<!doctype html><title>Wizard OS</title><!-- core/ QA fixture -->"
                    + "<meta name='viewport' content='width=device-width, initial-scale=1'><body style='background:#05030c;color:#f3efff;font:22px sans-serif'>"
                    + "<p id='place'>Fixture home</p><button onclick=\"document.getElementById('place').textContent='Fixture nested'\">Open nested</button>"
                    + "<script>window.__wosNativeBack=()=>{document.getElementById('place').textContent='Fixture home';return 'handled'};</script>";
                byte[] bytes = (shell ? (wizard ? html : "<title>Sign in</title>") : "{}").getBytes(StandardCharsets.UTF_8);
                OutputStream out = client.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + (shell ? "text/html" : "application/json") + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8)); out.write(bytes); out.flush();
            }
        }
        @Override public void close() throws IOException { running = false; socket.close(); }
    }
}
