package ai.wizards.os;

import android.app.Instrumentation;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import ai.wizards.os.call.CallActivity;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

/**
 * wizard-messenger issue 445: a call window opens only for this Wizard's own call page, gives that page the microphone,
 * hands Element Call its list of outputs (controls.setAvailableAudioDevices) and routes the call's sound to the one it
 * picks; closing it puts the phone's audio mode back. A synthetic call page on localhost stands in for Element Call
 * (same host hooks), no owner traffic.
 */
final class CallWindowScenario {
    private CallWindowScenario() { }

    /** Element Call's host side, reduced: take the list, pick the speaker (as for a video call), ask for the mic. */
    static final String PAGE = "<!doctype html><meta name=viewport content='width=device-width'><title>Call</title><body>"
            + "<p id=d>Waiting for outputs</p><p id=m>Mic not asked</p><script>"
            + "window.controls={setAvailableAudioDevices:function(list){"
            + "  var sp=list.filter(function(x){return x.isSpeaker})[0];"
            + "  document.getElementById('d').textContent='Outputs '+list.length+(sp?' speaker '+sp.id:' no speaker');"
            + "  if(sp&&!window.picked&&this.onAudioDeviceSelect){window.picked=true;this.onAudioDeviceSelect(sp.id);}"
            + "}};"
            + "navigator.mediaDevices.getUserMedia({audio:true}).then(function(){document.getElementById('m').textContent='Mic granted'},"
            + " function(e){document.getElementById('m').textContent='Mic '+e.name});"
            + "</script>";

    static void run() throws Exception {
        Instrumentation inst = InstrumentationRegistry.getInstrumentation();
        Context c = inst.getTargetContext();
        UiDevice device = UiDevice.getInstance(inst);
        assertTrue(BuildConfig.DEBUG);
        inst.getUiAutomation().grantRuntimePermission(c.getPackageName(), android.Manifest.permission.RECORD_AUDIO);
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        try (Page page = new Page()) {
            assertTrue("could not set the test Wizard", ServerSettings.save(c, page.origin()));
            assertFalse("another site must never open a call window", CallActivity.open(c, "http://127.0.0.1:" + page.port() + "/call/"));
            assertTrue(CallActivity.open(c, page.origin() + "/messenger/call/k/test/join/"));
            UiObject2 outs = pastSystemDialogs(device, By.textStartsWith("Outputs "), 30000);
            assertNotNull("Element Call's host hook never got the outputs; the page was asked " + page.served + " times", outs);
            String text = outs.getText();
            android.util.Log.i("CallWindowScenario", text);
            // CI's emulator runs without audio (-noaudio): a granted mic may still fail to start (NotReadableError or
            // NotFoundError). What must never happen is the call page being refused it.
            UiObject2 mic = pastSystemDialogs(device, By.text(java.util.regex.Pattern.compile("Mic (granted|[A-Z][A-Za-z]+Error)")), 20000);
            assertNotNull("the call page never heard back about the microphone", mic);
            android.util.Log.i("CallWindowScenario", mic.getText());
            assertFalse("the call page was refused the microphone: " + mic.getText(), mic.getText().contains("NotAllowedError") || mic.getText().contains("SecurityError"));
            assertEquals("a call window is in call audio mode", AudioManager.MODE_IN_COMMUNICATION, am.getMode());
            if (android.os.Build.VERSION.SDK_INT >= 31 && text.contains(" speaker ")) {
                long until = System.currentTimeMillis() + 10000;
                AudioDeviceInfo d = am.getCommunicationDevice();
                while ((d == null || d.getType() != AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) && System.currentTimeMillis() < until) {
                    Thread.sleep(250);
                    d = am.getCommunicationDevice();
                }
                assertNotNull(d);
                assertEquals("Element Call's pick (the speaker) is where the call's sound goes", AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, d.getType());
            }
            device.pressBack();
            long until = System.currentTimeMillis() + 10000;
            while (am.getMode() == AudioManager.MODE_IN_COMMUNICATION && System.currentTimeMillis() < until) Thread.sleep(250);
            assertNotEquals("closing the call window ends call audio mode", AudioManager.MODE_IN_COMMUNICATION, am.getMode());
        } finally {
            c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }

    /** CI emulators raise "Pixel Launcher isn't responding" over the call window; tap Wait and keep looking. */
    private static UiObject2 pastSystemDialogs(UiDevice device, androidx.test.uiautomator.BySelector target, long ms) {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) {
            UiObject2 hit = device.wait(Until.findObject(target), 1500);
            if (hit != null) return hit;
            UiObject2 wait = device.findObject(By.res("android:id/aerr_wait"));
            if (wait != null) wait.click();
        }
        try {
            ByteArrayOutputStream tree = new ByteArrayOutputStream();
            device.dumpWindowHierarchy(tree);
            String t = tree.toString("UTF-8").replaceAll("\\s+", " ");
            for (int i = 0; i < t.length(); i += 3000) android.util.Log.i("CallWindowScenario", "window: " + t.substring(i, Math.min(t.length(), i + 3000)));
        } catch (IOException ignored) { }
        return null;
    }

    /**
     * One page on localhost, for any path. Each connection is answered on its own thread: the WebView opens idle
     * connections ahead of use, and one of them must never hold up the page itself (wizard-ux issue 2011).
     */
    private static final class Page implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        final Thread thread = new Thread(this::serve, "call-page");
        volatile int served;
        Page() throws IOException { thread.setDaemon(true); thread.start(); }
        int port() { return socket.getLocalPort(); }
        String origin() { return "http://localhost:" + port(); }
        private void serve() {
            while (!socket.isClosed()) {
                try {
                    Socket s = socket.accept();
                    Thread t = new Thread(() -> answer(s), "call-page-client");
                    t.setDaemon(true);
                    t.start();
                } catch (IOException ignored) { }
            }
        }
        private void answer(Socket client) {
            try (Socket s = client) {
                s.setSoTimeout(5000);
                BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
                String line = in.readLine();
                if (line == null || line.isEmpty()) return; // an idle preconnect, closed unused
                served++;
                while ((line = in.readLine()) != null && !line.isEmpty()) { }
                byte[] body = PAGE.getBytes(StandardCharsets.UTF_8);
                OutputStream out = s.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: "
                        + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                out.write(body);
                out.flush();
            } catch (IOException ignored) { }
        }
        @Override public void close() throws IOException { socket.close(); }
    }
}
