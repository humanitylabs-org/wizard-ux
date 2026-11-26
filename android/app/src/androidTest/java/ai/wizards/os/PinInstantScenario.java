package ai.wizards.os;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.SystemClock;
import android.util.Log;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
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
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.Assert.*;

/**
 * Instant home-screen apps (wizard-ux issue 1830, switch wizard/pin-instant-open) in the real app on an emulator,
 * against a disposable localhost Wizard (files/qa_home.txt) whose pinned page and app are stand-ins that never heard
 * of the feature (the pinned page only makes the two calls core/single-app-session.js makes). Each open is a cold one:
 * the pinned window's task is removed first, as when Android has dropped it.
 *  1. Switch on, first open (no picture yet, the pinned page held back 4 s): Android's placeholder (the app's name on
 *     the skin's background) is on the window's first frame, never an empty window and no Connecting; then the app
 *     loads from the box, and a picture of it is kept while it is still on screen (field report 2, 26 Nov).
 *  1b. The pinned page held back 13 s, past the 10 s Can't-reach mark, while the box's /shell-health answers: no
 *     Can't reach, the placeholder or last screen stays, then the app (field report 1).
 *  2. Five more opens with the pinned page held back 4 s by the box: the last screen is on screen at once (time to the
 *     window's first frame with it, median logged), no Connecting, then the live app; the box is asked only whether the
 *     app's page changed (no script, stylesheet or shell file).
 *  3. The app is updated on the box: the next open shows the new version.
 *  4. Switch off: the same held-back open shows today's Connecting, no saved picture, and every file is asked for.
 * Run by {@link DeviceBridgeE2eTest}. Numbers and screenshots go to logcat (tags WizardPinQa, PinShot).
 */
final class PinInstantScenario {
    private static final String TAG = "WizardPinQa", APP = "qa-pin";
    private static final int BLUE = 0x1e88e5;

    static void run() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        File home = new File(c.getFilesDir(), "qa_home.txt");
        // CI turns Wi-Fi off; a network is what "the same network as the last answer" is about.
        shell("svc wifi enable");
        try (Box box = new Box()) {
            Files.write(home.toPath(), box.origin().getBytes(StandardCharsets.UTF_8));
            waitForNetwork(c);
            PinInstant.setOn(c, false);
            PinInstant.setOn(c, true);

            // The main app answered a moment ago on this network (as when it is open).
            PinInstant.reached(c);

            // 1. first open with nothing kept yet and the page held back: the placeholder, never an empty window
            File shot = PinInstant.shotFile(c, box.origin(), APP);
            assertFalse(shot.exists());
            box.pageDelayMs = 4000;
            long first = open(c);
            Activity a0 = waitResumed(10000);
            long cover = waitCoverDrawn(a0, first, 5000);
            assertTrue("first open: the placeholder was on the window's first frame", cover >= 0);
            boolean[] placeholder = {false};
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> placeholder[0] = ((MainActivity) a0).pinPlaceholderShowing());
            assertTrue("first open: it is the placeholder (no picture kept yet)", placeholder[0]);
            SystemClock.sleep(Math.max(0, 2200 - (SystemClock.uptimeMillis() - first)));
            assertNotNull("first open: the placeholder names the app", device.findObject(By.text("Qa Pin")));
            assertNull("first open: no Connecting", device.findObject(By.text("Connecting to your Wizard…")));
            shot(device, c, "placeholder");
            Log.i(TAG, "first open (nothing kept yet): placeholder on the first frame after " + cover + " ms");
            assertNotNull("the app never showed", find(device, By.textStartsWith("Pinned app v1"), 30000));
            Log.i(TAG, "first open: app page after " + (SystemClock.uptimeMillis() - first) + " ms");
            assertTrue("the app's files came from the box", box.saw("GET /qa-pin/app.js"));
            // A picture is kept once the app has shown, while the window is still on screen.
            assertTrue("a picture of the app was kept while it was on screen", waitFile(shot, 10000));
            shot(device, c, "after-first");
            device.pressHome();
            SystemClock.sleep(1200);

            // 1b. a slow cold load past the Can't-reach mark while the box answers its health check: no Can't reach
            close(c);
            box.clear();
            box.pageDelayMs = 13000;
            long slow = open(c);
            Activity a1 = waitResumed(10000);
            SystemClock.sleep(Math.max(0, 11500 - (SystemClock.uptimeMillis() - slow)));
            boolean[] offline = {true}, covered = {false};
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                offline[0] = ((MainActivity) a1).reachOfflineShowing(); covered[0] = ((MainActivity) a1).pinShotShowing(); });
            assertFalse("slow load, box answering: no Can't reach at 11.5 s", offline[0]);
            assertTrue("slow load: the window is still covered (never empty)", covered[0]);
            assertTrue("slow load: the phone asked the box's health check", box.saw("GET /shell-health"));
            assertNotNull("slow load: the live app", find(device, By.textStartsWith("Pinned app v1"), 20000));
            Log.i(TAG, "slow load (page held back 13 s): no Can't reach, the app by " + (SystemClock.uptimeMillis() - slow) + " ms");
            device.pressHome();
            SystemClock.sleep(1200);

            // 2. five cold opens with the pinned page held back: the last screen at once, no Connecting
            List<Long> toShot = new ArrayList<>();
            for (int i = 0; i < 5; i++) {
                close(c);
                box.clear();
                box.pageDelayMs = 4000;
                long t0 = open(c);
                Activity a = waitResumed(10000);
                long shown = waitShotDrawn(a, t0, 5000);
                assertTrue("open " + (i + 1) + ": the last screen was on screen", shown >= 0);
                toShot.add(shown);
                if (i == 0) {
                    // Screenshots trail the screen on CI emulators: take it well inside the 3 s the page is held back.
                    SystemClock.sleep(Math.max(0, 1500 - (SystemClock.uptimeMillis() - t0)));
                    // CI emulators sometimes raise "… isn't responding" over everything: wait it out, then look again
                    // (still well inside the 4 s the page is held back).
                    boolean blue = false;
                    for (int k = 0; k < 3 && !blue && SystemClock.uptimeMillis() - t0 < 3300; k++) {
                        UiObject2 anr = device.findObject(By.res("android:id/aerr_wait"));
                        if (anr != null) { anr.click(); SystemClock.sleep(300); }
                        Bitmap b = screen(device, c);
                        assertNotNull(b);
                        int px = b.getPixel(b.getWidth() / 2, b.getHeight() / 2);
                        Log.i(TAG, "screen centre while the page is held back: #" + Integer.toHexString(px & 0xffffff));
                        blue = near(px, BLUE);
                        if (blue) shot(device, c, "on-held-back");
                    }
                    assertTrue("open 1: the app's last screen fills the window while its page is held back", blue);
                }
                SystemClock.sleep(Math.max(0, 3000 - (SystemClock.uptimeMillis() - t0)));
                assertNull("open " + (i + 1) + ": no Connecting", device.findObject(By.text("Connecting to your Wizard…")));
                assertNotNull("open " + (i + 1) + ": the live app", find(device, By.textStartsWith("Pinned app v1"), 20000));
                assertTrue("open " + (i + 1) + ": the picture gave way to the live page", waitShotGone(a, 5000));
                SystemClock.sleep(800);
                List<String> files = box.files();
                Log.i(TAG, "open " + (i + 2) + ": last screen after " + shown + " ms; box saw " + files);
                assertTrue("open " + (i + 1) + ": the page was checked with the box", box.saw("GET /qa-pin/ (conditional)"));
                assertFalse("open " + (i + 1) + ": no app script read", box.saw("GET /qa-pin/app.js"));
                assertFalse("open " + (i + 1) + ": no app stylesheet read", box.saw("GET /qa-pin/app.css"));
                assertFalse("open " + (i + 1) + ": no shell file read", box.saw("GET /wizard-os-home/core/"));
                device.pressHome();
                SystemClock.sleep(1200);
            }
            List<Long> sorted = new ArrayList<>(toShot); Collections.sort(sorted);
            Log.i(TAG, "switch on: last screen on screen after " + toShot + " ms, median " + sorted.get(2) + " ms (5 cold opens, page held back 4 s)");

            // 3. the app is updated on the box: the next open shows it
            box.version = 2;
            close(c);
            box.clear(); box.pageDelayMs = 0;
            open(c);
            assertNotNull("an updated app shows its new version on the next open", find(device, By.textStartsWith("Pinned app v2"), 30000));
            assertTrue("its changed script was read again", box.saw("GET /qa-pin/app.js"));
            device.pressHome();
            SystemClock.sleep(1200);

            // 4. switch off: today's behaviour
            PinInstant.setOn(c, false);
            SystemClock.sleep(500);
            assertFalse("switch off removes the kept pictures", shot.exists());
            close(c);
            box.clear(); box.pageDelayMs = 5000;
            long t0 = open(c);
            Activity a = waitResumed(10000);
            assertTrue("switch off: no saved picture", waitShotDrawn(a, t0, 600) < 0);
            long[] firstFrame = {0};
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> firstFrame[0] = ((MainActivity) a).pinFirstDrawAt());
            assertNotNull("switch off: Connecting as today", find(device, By.text("Connecting to your Wizard…"), 4000));
            long connecting = SystemClock.uptimeMillis() - t0;
            SystemClock.sleep(Math.max(0, 2500 - connecting));
            shot(device, c, "off-held-back");
            assertNotNull("switch off: the live app", find(device, By.textStartsWith("Pinned app v2"), 20000));
            Log.i(TAG, "switch off: first frame (empty) after " + (firstFrame[0] > 0 ? firstFrame[0] - t0 : -1) + " ms, Connecting seen by " + connecting
                    + " ms, the app by " + (SystemClock.uptimeMillis() - t0) + " ms (page held back 5 s)");
            SystemClock.sleep(800);
            Log.i(TAG, "switch off: box saw " + box.files());
            assertTrue("switch off: the app's files are asked for as before", box.saw("GET /qa-pin/app.js"));
            Log.i(TAG, "pin instant open scenario passed");
        } finally {
            //noinspection ResultOfMethodCallIgnored
            home.delete();
            PinInstant.setOn(c, false);
            close(c);
            shell("svc wifi disable");
            device.pressHome();
        }
    }

    /** A JPEG of a flat colour comes back within a few steps of it. */
    private static boolean near(int a, int b) {
        for (int shift = 0; shift <= 16; shift += 8) if (Math.abs(((a >> shift) & 0xff) - ((b >> shift) & 0xff)) > 16) return false;
        return true;
    }

    private static long open(Context c) {
        long t0 = SystemClock.uptimeMillis();
        c.startActivity(new Intent(c, AppSessionActivity.class).setAction(Intent.ACTION_VIEW)
                .setData(HomeScreenShortcuts.taskUri(c, APP)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        return t0;
    }

    /** The pinned window's task goes, so the next open is a cold one. */
    private static void close(Context c) {
        ActivityManager am = c.getSystemService(ActivityManager.class);
        for (ActivityManager.AppTask t : am.getAppTasks()) {
            try {
                Intent base = t.getTaskInfo().baseIntent;
                if (base != null && base.getData() != null && APP.equals(base.getData().getQueryParameter("app"))) t.finishAndRemoveTask();
            } catch (RuntimeException gone) { /* already gone */ }
        }
        SystemClock.sleep(1500);
    }

    private static Activity waitResumed(long ms) {
        long end = SystemClock.uptimeMillis() + ms;
        while (SystemClock.uptimeMillis() < end) {
            Activity[] hit = new Activity[1];
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                Collection<Activity> r = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED);
                for (Activity a : r) if (a instanceof AppSessionActivity) hit[0] = a;
            });
            if (hit[0] != null) return hit[0];
            SystemClock.sleep(20);
        }
        fail("the pinned window never came to the front");
        return null;
    }

    /** ms from the tap to a drawn frame of the window with the last screen on it; -1 if it never showed. */
    private static long waitShotDrawn(Activity a, long t0, long ms) {
        long end = SystemClock.uptimeMillis() + ms;
        while (SystemClock.uptimeMillis() < end) {
            long[] at = {-1};
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> at[0] = ((MainActivity) a).pinShotDrawnAt());
            if (at[0] > 0) return at[0] - t0;
            SystemClock.sleep(10);
        }
        return -1;
    }

    /** ms from the tap to a drawn frame of the window with its last screen or the placeholder on it; -1 if neither. */
    private static long waitCoverDrawn(Activity a, long t0, long ms) {
        long end = SystemClock.uptimeMillis() + ms;
        while (SystemClock.uptimeMillis() < end) {
            long[] at = {-1};
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> at[0] = ((MainActivity) a).pinCoverDrawnAt());
            if (at[0] > 0) return at[0] - t0;
            SystemClock.sleep(10);
        }
        return -1;
    }

    private static boolean waitShotGone(Activity a, long ms) {
        long end = SystemClock.uptimeMillis() + ms;
        while (SystemClock.uptimeMillis() < end) {
            boolean[] showing = {true};
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> showing[0] = ((MainActivity) a).pinShotShowing());
            if (!showing[0]) return true;
            SystemClock.sleep(50);
        }
        return false;
    }

    private static void waitForNetwork(Context c) {
        long end = SystemClock.uptimeMillis() + 30000;
        while (SystemClock.uptimeMillis() < end && PinInstant.network(c).isEmpty()) SystemClock.sleep(500);
        Log.i(TAG, "network " + PinInstant.network(c));
        assertFalse("the emulator has a network", PinInstant.network(c).isEmpty());
    }

    private static boolean waitFile(File f, long ms) {
        long end = SystemClock.uptimeMillis() + ms;
        while (SystemClock.uptimeMillis() < end) { if (f.isFile() && f.length() > 0) return true; SystemClock.sleep(100); }
        return false;
    }

    private static void shell(String cmd) {
        try {
            android.os.ParcelFileDescriptor out = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(cmd);
            try (InputStream in = new android.os.ParcelFileDescriptor.AutoCloseInputStream(out)) { while (in.read() >= 0) { /* drain */ } }
        } catch (IOException | RuntimeException e) { Log.w(TAG, "shell " + cmd + ": " + e); }
    }

    /** CI emulators raise "Pixel Launcher isn't responding" over the app; tap Wait and keep looking. */
    private static UiObject2 find(UiDevice device, androidx.test.uiautomator.BySelector target, long ms) {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) {
            UiObject2 hit = device.wait(Until.findObject(target), 500);
            if (hit != null) return hit;
            UiObject2 wait = device.findObject(By.res("android:id/aerr_wait"));
            if (wait != null) wait.click();
        }
        return null;
    }

    private static Bitmap screen(UiDevice device, Context c) {
        File f = new File(c.getCacheDir(), "pin-qa-screen.png");
        if (!device.takeScreenshot(f, 1f, 100)) return null;
        Bitmap b = BitmapFactory.decodeFile(f.getPath());
        //noinspection ResultOfMethodCallIgnored
        f.delete();
        return b;
    }

    /** The emulator's real screen, logged (tag PinShot, base64 PNG in chunks) for the pull request. */
    private static void shot(UiDevice device, Context c, String name) throws IOException {
        File f = new File(c.getCacheDir(), "pin-" + name + ".png");
        if (!device.takeScreenshot(f, 0.5f, 90)) return;
        String all = android.util.Base64.encodeToString(Files.readAllBytes(f.toPath()), android.util.Base64.NO_WRAP);
        int n = (all.length() + 2999) / 3000;
        for (int i = 0; i < n; i++) Log.i("PinShot", name + " " + i + "/" + n + " " + all.substring(i * 3000, Math.min(all.length(), (i + 1) * 3000)));
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** A disposable Wizard: a pinned page that frames the app, the app (page, script, stylesheet) and one shell file. */
    private static final class Box implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        final List<String> seen = new CopyOnWriteArrayList<>();
        volatile boolean running = true;
        volatile long pageDelayMs = 0;
        volatile int version = 1;

        Box() throws IOException {
            new Thread(() -> {
                while (running) try {
                    Socket s = socket.accept();
                    new Thread(() -> { try { respond(s); } catch (IOException ignored) { } }, "PinBoxClient").start();
                } catch (IOException ignored) { }
            }, "PinBox").start();
        }

        String origin() { return "http://localhost:" + socket.getLocalPort(); }
        void clear() { seen.clear(); }
        boolean saw(String start) { for (String s : seen) if (s.startsWith(start)) return true; return false; }
        List<String> files() { return new ArrayList<>(seen); }

        private void respond(Socket s) throws IOException {
            try (Socket client = s) {
                client.setSoTimeout(15000);
                InputStream in = new BufferedInputStream(client.getInputStream());
                String request = line(in); if (request == null) return;
                String h, ifNone = null;
                while ((h = line(in)) != null && !h.isEmpty()) if (h.toLowerCase(java.util.Locale.ROOT).startsWith("if-none-match:")) ifNone = h.substring(14).trim();
                String path = request.split(" ").length > 1 ? request.split(" ")[1] : "";
                String status = "200 OK", type = "text/html", out, etag = null, cache = "no-cache";
                int v = version;
                if (path.startsWith("/wizard-os-home/?app-session=" + APP)) {
                    if (pageDelayMs > 0) SystemClock.sleep(pageDelayMs);
                    cache = "no-store";
                    out = "<!doctype html><meta charset='utf-8'><meta name='wos-release' content='abcdef012345'>"
                        + "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0;background:#05030c'>"
                        // As core/single-app-session.js does: the release first, then the app frame.
                        + "<script>try{WizardOSNative.pinRelease('abcdef012345')}catch(e){}"
                        + "var f=document.createElement('iframe');f.src='/qa-pin/';f.style.cssText='border:0;width:100vw;height:100vh;display:block';"
                        + "f.addEventListener('load',function(){requestAnimationFrame(function(){setTimeout(function(){try{WizardOSNative.pinShown()}catch(e){}},120)})});"
                        + "document.body.appendChild(f);</script>";
                } else if (path.equals("/shell-health")) {
                    type = "application/json"; out = "{\"ok\":true}";
                } else if (path.equals("/qa-pin/")) {
                    etag = "\"page" + v + "\"";
                    out = "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                        + "<link rel='stylesheet' href='/qa-pin/app.css'><body><h1 id='t'>Loading</h1>"
                        + "<script src='/wizard-os-home/core/app-client.js'></script><script src='/qa-pin/app.js'></script>";
                } else if (path.equals("/qa-pin/app.css")) {
                    type = "text/css"; etag = "\"css1\"";
                    out = "html,body{margin:0;height:100%;background:#1e88e5;color:#fff;font:28px sans-serif}h1{padding:120px 24px}";
                } else if (path.equals("/qa-pin/app.js")) {
                    type = "text/javascript"; etag = "\"js" + v + "\"";
                    out = "document.getElementById('t').textContent='Pinned app v" + v + "';";
                } else if (path.equals("/wizard-os-home/core/app-client.js")) {
                    type = "text/javascript"; etag = "\"client1\"";
                    out = "window.WizardApp={};";
                } else { status = "404 Not Found"; type = "text/plain"; out = "no"; }
                boolean notModified = etag != null && etag.equals(ifNone);
                seen.add(request.split(" HTTP")[0] + (ifNone != null ? " (conditional)" : ""));
                byte[] bytes = notModified ? new byte[0] : out.getBytes(StandardCharsets.UTF_8);
                OutputStream o = client.getOutputStream();
                o.write(("HTTP/1.1 " + (notModified ? "304 Not Modified" : status) + "\r\nContent-Type: " + type + "; charset=utf-8\r\nCache-Control: " + cache
                    + (etag != null ? "\r\nETag: " + etag : "") + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
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
