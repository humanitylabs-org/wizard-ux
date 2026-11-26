package ai.wizards.os;

import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.Assert.*;

/**
 * Recovery mode (wizard-ux issue 1775, switch wizard/phone-recovery-mode) in the real app on an emulator, against a
 * disposable localhost Wizard (files/qa_home.txt), never an owner's server:
 *  1. With the switch on and the last start never finished (pending in another process), MainActivity opens with the
 *     recovery card over the shell and the background work paused.
 *  2. Send diagnostics posts the report (with the saved freezes) to the Wizard and says it was sent.
 *  3. Check for update reads the normal update feed and says this build is the newest.
 *  4. Start normally removes the card and ends the pause.
 *  5. With the switch off, the same unfinished start opens normally: no card, nothing paused.
 * Run by {@link DeviceBridgeE2eTest}.
 */
final class RecoveryModeScenario {
    private static final String TAG = "WizardRecoveryQa";

    static void run() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        File home = new File(c.getFilesDir(), "qa_home.txt");
        try (Box box = new Box()) {
            Files.write(home.toPath(), box.origin().getBytes(StandardCharsets.UTF_8));
            // 1. switch on, a normal start left pending by another (dead) process
            StartGuard.setOn(c, true);
            unfinishedStart(c);
            StartGuard.forgetProcessForQa();
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            if (find(device, By.text("Recovery mode"), 30000) == null) {
                ByteArrayOutputStream tree = new ByteArrayOutputStream();
                device.dumpWindowHierarchy(tree);
                String t = tree.toString("UTF-8").replaceAll("\\s+", " ");
                for (int i = 0; i < t.length(); i += 3000) Log.i(TAG, "window: " + t.substring(i, Math.min(t.length(), i + 3000)));
                fail("the recovery card never showed");
            }
            screen(device, c, "device");
            assertNotNull(device.findObject(By.textStartsWith("WizardOS closed before it finished starting")));
            assertTrue("background work is paused", StartGuard.paused());
            assertTrue("the shell loads underneath", box.waitFor("GET /wizard-os-home/", 20000));
            // 2. Send diagnostics
            find(device, By.text("Send diagnostics"), 10000).click();
            assertNotNull("diagnostics never reported sent", find(device, By.text("Diagnostics sent to your Wizard."), 20000));
            String report = box.body("POST /wizard-os-home/api/diagnostics/scroll-capture");
            assertNotNull("the Wizard got the report", report);
            assertTrue("the report carries the saved freezes", report.contains("\"hangs\""));
            // 3. Check for update, through the normal update feed
            find(device, By.text("Check for update"), 10000).click();
            assertNotNull("the update check never answered",
                    find(device, By.text("WizardOS " + BuildConfig.VERSION_NAME + " is the newest version."), 20000));
            assertTrue(box.waitFor("GET /reports/wizard-os/latest.json", 1000));
            // 4. Start normally
            find(device, By.text("Start normally"), 10000).click();
            assertTrue("the card left", device.wait(Until.gone(By.text("Recovery mode")), 10000));
            assertFalse("the pause ended", StartGuard.paused());
            // 5. switch off: the same unfinished start opens normally
            StartGuard.setOn(c, false);
            unfinishedStart(c);
            StartGuard.forgetProcessForQa();
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            assertTrue("the shell loads again", box.waitFor("GET /wizard-os-home/", 20000));
            assertNotNull("switch off: the shell is on screen", find(device, By.text("Shell"), 20000));
            assertNull("switch off: no card", device.findObject(By.text("Recovery mode")));
            assertFalse("switch off: nothing paused", StartGuard.paused());
            Log.i(TAG, "recovery mode scenario passed");
        } finally {
            //noinspection ResultOfMethodCallIgnored
            home.delete();
            StartGuard.setOn(c, false);
            c.getSharedPreferences("start-guard", Context.MODE_PRIVATE).edit().clear().commit();
            StartGuard.forgetProcessForQa();
            device.pressHome();
        }
    }

    /** CI emulators raise "Pixel Launcher isn't responding" over the app; tap Wait and keep looking. */
    private static UiObject2 find(UiDevice device, androidx.test.uiautomator.BySelector target, long ms) {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) {
            UiObject2 hit = device.wait(Until.findObject(target), 1500);
            if (hit != null) return hit;
            UiObject2 wait = device.findObject(By.res("android:id/aerr_wait"));
            if (wait != null) wait.click();
        }
        return null;
    }

    /** The emulator's real screen, logged (tag RecoveryShot, base64 PNG in chunks) for the pull request. */
    private static void screen(UiDevice device, Context c, String name) throws IOException {
        File f = new File(c.getCacheDir(), "recovery-" + name + ".png");
        if (!device.takeScreenshot(f, 0.5f, 90)) return;
        String all = android.util.Base64.encodeToString(Files.readAllBytes(f.toPath()), android.util.Base64.NO_WRAP);
        int n = (all.length() + 2999) / 3000;
        for (int i = 0; i < n; i++) Log.i("RecoveryShot", name + " " + i + "/" + n + " " + all.substring(i * 3000, Math.min(all.length(), (i + 1) * 3000)));
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** What a start that died leaves behind: pending, normal, in a process that isn't this one. */
    private static void unfinishedStart(Context c) {
        c.getSharedPreferences("start-guard", Context.MODE_PRIVATE).edit().clear()
                .putLong("pendingAt", System.currentTimeMillis() - 60_000).putInt("pendingPid", 1).putBoolean("pendingNormal", true).commit();
    }

    /** A disposable Wizard: the shell page, the update feed (an older build) and the diagnostics endpoint. */
    private static final class Box implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        final List<String> seen = new CopyOnWriteArrayList<>();
        final List<String> bodies = new CopyOnWriteArrayList<>();
        volatile boolean running = true;
        int read;

        Box() throws IOException {
            new Thread(() -> { while (running) try { respond(socket.accept()); } catch (IOException ignored) { } }, "RecoveryBox").start();
        }

        String origin() { return "http://localhost:" + socket.getLocalPort(); }

        /** True once a request starting with {@code line} came in after the last one waited for. */
        synchronized boolean waitFor(String line, long ms) throws InterruptedException {
            long end = System.currentTimeMillis() + ms;
            while (System.currentTimeMillis() < end) {
                for (int i = read; i < seen.size(); i++) if (seen.get(i).startsWith(line)) { read = i + 1; return true; }
                wait(200);
            }
            return false;
        }

        String body(String line) {
            for (int i = 0; i < seen.size(); i++) if (seen.get(i).startsWith(line)) return bodies.get(i);
            return null;
        }

        private void respond(Socket s) throws IOException {
            try (Socket client = s) {
                client.setSoTimeout(5000);
                InputStream in = new BufferedInputStream(client.getInputStream());
                String request = line(in); if (request == null) return;
                int length = 0; String h;
                while ((h = line(in)) != null && !h.isEmpty()) if (h.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:")) length = Integer.parseInt(h.substring(15).trim());
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                for (int i = 0; i < length; i++) { int b = in.read(); if (b < 0) break; body.write(b); }
                String status = "200 OK", type = "text/html", out;
                if (request.startsWith("GET /wizard-os-home/")) out = "<!doctype html><title>WizardOS</title><meta name='viewport' content='width=device-width,initial-scale=1'><body style='background:#05030c;color:#fff;padding-top:120px'><p>Shell</p>";
                else if (request.startsWith("GET /reports/wizard-os/latest.json")) { type = "application/json"; out = "{\"versionCode\":1,\"versionName\":\"0.0.1\",\"sha256\":\"" + new String(new char[64]).replace('\0', 'a') + "\",\"url\":\"/old.apk\",\"app\":\"" + BuildConfig.APPLICATION_ID + "\"}"; }
                else if (request.startsWith("POST /wizard-os-home/api/diagnostics/scroll-capture")) { status = "201 Created"; type = "application/json"; out = "{\"ok\":true}"; }
                else { status = "404 Not Found"; type = "application/json"; out = "{}"; }
                synchronized (this) { bodies.add(body.toString("UTF-8")); seen.add(request); notifyAll(); }
                byte[] bytes = out.getBytes(StandardCharsets.UTF_8);
                OutputStream o = client.getOutputStream();
                o.write(("HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                o.write(bytes); o.flush();
            }
        }

        private static String line(InputStream in) throws IOException {
            ByteArrayOutputStream b = new ByteArrayOutputStream(); int ch;
            while ((ch = in.read()) >= 0 && ch != '\n') if (ch != '\r') b.write(ch);
            return ch < 0 && b.size() == 0 ? null : b.toString("UTF-8");
        }

        @Override public void close() throws IOException { running = false; socket.close(); }
    }
}
