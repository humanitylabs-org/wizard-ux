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
    private void visible(String text) {
        if (device.wait(Until.findObject(By.text(text)), 15000) != null) return;
        // Keep the failing screen and its UI tree as evidence before failing.
        shot("fail-" + text.replaceAll("[^A-Za-z0-9]+", "-"));
        try { device.dumpWindowHierarchy(new File(c.getExternalFilesDir(null), "fail-hierarchy.xml")); } catch (Exception ignored) {}
        fail(text + " not visible; ConnectActivity status=" + statusText() + " origin=" + ServerSettings.origin(c) + " top=" + device.getCurrentPackageName());
    }
    private String statusText() {
        androidx.test.uiautomator.UiObject2 o = device.findObject(By.textContains("Wizard"));
        return o == null ? "?" : o.getText();
    }
    private void foreground() { assertEquals(c.getPackageName(), device.getCurrentPackageName()); }
    private void back() throws Exception {
        if ("true".equals(InstrumentationRegistry.getArguments().getString("gesture_back"))) {
            assertTrue(device.swipe(1, device.getDisplayHeight() / 2,
                    device.getDisplayWidth() / 2, device.getDisplayHeight() / 2, 30));
        } else device.pressBack();
        device.waitForIdle(); Thread.sleep(350);
    }
    private void clearOfBars(String label, String name) throws Exception {
        if (Build.VERSION.SDK_INT < 30) return;
        final android.graphics.Insets[] bars = new android.graphics.Insets[1];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            android.app.Activity a = androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                    .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).iterator().next();
            bars[0] = a.getWindow().getDecorView().getRootWindowInsets().getInsets(
                    android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout()
                            | android.view.WindowInsets.Type.ime());
        });
        androidx.test.uiautomator.UiObject2 control = device.wait(Until.findObject(By.text(label)), 10000);
        assertNotNull(label, control);
        android.graphics.Rect bounds = control.getVisibleBounds();
        String detail = label + " bounds=" + bounds + " insets=" + bars[0] + " height=" + device.getDisplayHeight();
        try (FileWriter out = new FileWriter(new File(c.getExternalFilesDir(null), name + ".txt"))) { out.write(detail); }
        shot(name);
        // WebView accessibility bounds come from CSS px and can round past the clip by up to one device dp.
        int slack = (int) Math.ceil(c.getResources().getDisplayMetrics().density);
        assertTrue(detail, bounds.top >= bars[0].top - slack && bounds.bottom <= device.getDisplayHeight() - bars[0].bottom + slack);
        assertTrue(detail, bounds.height() >= 30);
    }
    private void start(Class<?> activity) { c.startActivity(new Intent(c, activity).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
    private void shot(String name) { device.takeScreenshot(new File(c.getExternalFilesDir(null), name + ".png")); }

    @Test public void freshPairingNestedAndRootBackPersistenceAndChange() throws Exception {
        assertTrue(BuildConfig.DEBUG);
        assertTrue(Build.MODEL.contains("sdk") || Build.FINGERPRINT.contains("generic"));
        assertEquals("", BuildConfig.ORIGIN);
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        try (FakeWizard fake = new FakeWizard(); FakeWizard other = new FakeWizard()) {
            start(MainActivity.class);
            visible("Connect to your Wizard"); clearOfBars("Connect to your Wizard", "connect-fresh");
            back(); visible("Connect to your Wizard"); foreground();
            // The actual QR scanner is a nested native activity: cancelling returns to Connect, not the launcher.
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(c.getPackageName(), "android.permission.CAMERA");
            device.findObject(By.text("Scan QR code")).click();
            Thread.sleep(1800); back(); visible("Connect to your Wizard"); foreground();
            device.findObject(By.desc("Wizard address")).setText(fake.origin());
            device.findObject(By.text("Connect")).click();
            visible("Fixture home"); foreground();
            clearOfBars("Fixture home", "shell-top-insets");
            clearOfBars("Fixture composer", "shell-composer-insets");
            device.findObject(By.text("Fixture composer")).click(); Thread.sleep(1000);
            clearOfBars("Fixture composer", "shell-composer-ime-insets");
            back(); foreground(); visible("Fixture home");
            device.findObject(By.text("Open overlay")).click(); visible("Fixture overlay");
            back(); visible("Fixture home"); foreground();
            // The overlay node can still be in the tree for a frame after Back; wait for it to go rather than racing it.
            assertTrue("overlay closed by Back", device.wait(Until.gone(By.text("Fixture overlay")), 5000));
            assertEquals(fake.origin(), ServerSettings.origin(c));
            assertEquals(fake.origin(), ai.wizards.os.device.AppState.origin(c));
            assertEquals(fake.origin(), ai.wizards.os.mizel.MizelConfig.origin(c));
            for (int repeat = 0; repeat < 3; repeat++) {
                device.findObject(By.text("Open nested")).click(); visible("Fixture nested");
                shot("nested-" + repeat); back(); visible("Fixture home"); foreground();
                shot("nested-back-" + repeat);
            }
            back(); visible("Fixture home"); foreground();
            back(); visible("Fixture home"); foreground(); shot("root-back-twice");
            // A new Activity/process-independent persisted read uses the same server.
            start(ConnectActivity.class); visible("Keep current Wizard");
            back(); visible("Fixture home"); foreground();
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
            back(); visible("Fixture home"); foreground();
            // The lock surface used to rely only on legacy onBackPressed, ignored by target 36.
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(c.getPackageName(), "android.permission.RECORD_AUDIO");
            start(ai.wizards.os.assist.AssistLockActivity.class); Thread.sleep(2000);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                try {
                    android.app.Activity a = androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                            .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).iterator().next();
                    java.lang.reflect.Field field = ai.wizards.os.assist.AssistLockActivity.class.getDeclaredField("web");
                    field.setAccessible(true);
                    ((android.webkit.WebView) field.get(a)).evaluateJavascript("W.reset();W.lockState(false);W.showList()", null);
                } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
            });
            visible("What you told the Wizard"); foreground(); shot("assist-nested");
            back(); foreground(); assertNull(device.findObject(By.text("What you told the Wizard")));
            shot("assist-nested-back"); back(); foreground(); shot("assist-root-back");
            start(MainActivity.class); // stop the silent emulator take; no owner endpoint or real audio
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
                    + "<meta name='viewport' content='width=device-width, initial-scale=1'>"
                    + "<style>body{margin:0;background:#05030c;color:#f3efff;font:22px sans-serif}header{padding:16px;padding-top:calc(16px + var(--nat-t,0px))}button{font-size:20px;margin:12px}input{box-sizing:border-box;position:fixed;bottom:0;left:0;width:100%;height:64px;font-size:22px}#overlay{position:fixed;inset:25%;background:#483068;padding:20px}</style>"
                    + "<header><div id='place'>Fixture home</div></header><button onclick=\"document.getElementById('place').textContent='Fixture nested'\">Open nested</button>"
                    + "<button onclick=\"document.getElementById('overlay').hidden=false\">Open overlay</button><div id='overlay' hidden>Fixture overlay</div><input value='Fixture composer'>"
                    + "<script>window.__wosTop=n=>document.documentElement.style.setProperty('--nat-t',n+'px');window.__wosNativeBack=()=>{const o=document.getElementById('overlay');if(!o.hidden){o.hidden=true;return 'handled'}document.getElementById('place').textContent='Fixture home';return 'handled'};</script>";
                byte[] bytes = (shell ? (wizard ? html : "<title>Sign in</title>") : "{}").getBytes(StandardCharsets.UTF_8);
                OutputStream out = client.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + (shell ? "text/html" : "application/json") + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8)); out.write(bytes); out.flush();
            }
        }
        @Override public void close() throws IOException { running = false; socket.close(); }
    }
}
