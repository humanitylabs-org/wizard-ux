package ai.wizards.os;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.test.uiautomator.BySelector;
import androidx.test.uiautomator.UiObject2;
import ai.wizards.os.device.Http;
import ai.wizards.os.device.ShellToken;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
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

/** Real WebView request/reply against a disposable localhost Wizard, never an owner's server. */
@RunWith(AndroidJUnit4.class)
@org.junit.FixMethodOrder(org.junit.runners.MethodSorters.NAME_ASCENDING) // the meeting test must run first, see there
public class DeviceBridgeE2eTest {
    /**
     * wizard-ux#1724: a meeting cut off by a process death resumes in the same meeting when WizardOS opens again.
     * Named to run first in this process: the recorder's uploader keeps the origin it was created with.
     */
    @Test public void aMeetingCutOffByAProcessDeathResumesWhenTheAppOpens() throws Exception {
        MeetingProcessDeathScenario.run();
    }

    /** wizard-ux#1769: a start's disk loads run off the UI thread; the bookkeeping after them still runs on it. */
    @Test public void startupLoadsRunOffTheUiThread() throws Exception {
        LongMeetingStartupScenario.startupLoadsRunOffTheUiThread();
    }

    /** wizard-ux#1769: a 6.4 h meeting's upload backlog never keeps the UI thread waiting on the meeting store. */
    @Test public void longMeetingUploadsDoNotHoldTheUiThread() throws Exception {
        LongMeetingStartupScenario.longMeetingUploadsDoNotHoldTheUiThread();
    }

    @Test public void genericPackagesAndLegacyCompatibility() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        assertTrue(BuildConfig.DEBUG);
        assertEquals("", BuildConfig.ORIGIN);
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        try (Fixture fixture = new Fixture()) {
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            assertNotNull("Connect screen's address field never appeared", waitPastSystemDialogs(device, By.desc("Wizard address"), 30000));
            device.findObject(By.desc("Wizard address")).setText(fixture.origin());
            device.findObject(By.text("Connect")).click();
            assertNotNull("Real WebView generic request/reply or legacy compatibility failed", waitPastSystemDialogs(device, By.text("Device bridge verified"), 45000));
            assertEquals(c.getPackageName(), device.getCurrentPackageName());
            device.findObject(By.text("Check wrong path")).click();
            assertNotNull("Top-level non-shell path reached native", waitPastSystemDialogs(device, By.text("Wrong path refused"), 20000));
        }
    }

    /**
     * wizard-ux#1762: "WizardOS isn't responding" reached no diagnostics. A UI thread blocked past 4 s is saved with its
     * stack while it is still blocked (the ANR dialog may close the process next), and with its real length after.
     */
    @Test public void hangWatchSavesTheBlockedUiThreadsStack() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        HangLog log = HangWatch.log(c);
        int before = log.hangs().size();
        HangWatch.start(c);
        try {
            Thread.sleep(1500);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> android.os.SystemClock.sleep(6000));
            Thread.sleep(2000);
        } finally { HangWatch.stop(); }
        java.util.List<HangLog.Hang> hangs = log.hangs();
        assertEquals("one blocked stretch is one hang", before + 1, hangs.size());
        HangLog.Hang h = hangs.get(0);
        assertEquals("main", h.kind);
        // Counted from the first heartbeat the block swallowed, so up to one tick shorter than the 6 s block.
        assertTrue("its real length is kept: " + h.ms, h.ms >= 6000 - HangWatch.TICK_MS - 100);
        assertTrue("the stack names what blocked it: " + h.frames, String.join(" ", h.frames).contains("SystemClock.sleep"));
        assertTrue(new HangLog(new java.io.File(new java.io.File(c.getFilesDir(), "diagnostics"), "hangs.json")).hangs().size() > before);
    }

    /**
     * Browser owner boundary (wizard-os#133, wizard-ux issue 1430): once the shell says the box has it on, the shell page
     * keeps WizardOSNative/WizardOSDevice with working answers, and a sandboxed app frame sees neither and gets nothing
     * from the gate.
     */
    @Test public void boundaryKeepsNativeBridgesOutOfAppFrames() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        c.getSharedPreferences("wizard_browser_boundary", Context.MODE_PRIVATE).edit().clear().commit();
        try (Fixture fixture = new Fixture(true)) {
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            assertNotNull("Connect screen's address field never appeared", waitPastSystemDialogs(device, By.desc("Wizard address"), 30000));
            device.findObject(By.desc("Wizard address")).setText(fixture.origin());
            device.findObject(By.text("Connect")).click();
            androidx.test.uiautomator.UiObject2 ok = waitPastSystemDialogs(device, By.textStartsWith("Boundary verified"), 45000);
            if (ok == null) {
                androidx.test.uiautomator.UiObject2 failed = device.findObject(By.textStartsWith("FAILED"));
                fail(failed != null ? failed.getText() : "boundary page never finished");
            }
        } finally {
            c.getSharedPreferences("wizard_browser_boundary", Context.MODE_PRIVATE).edit().clear().commit();
        }
    }

    /**
     * wizard-ux issue 1775 (switch wizard/phone-recovery-mode): after a start that never finished, the app opens in
     * recovery mode; its card sends diagnostics, checks for an update and starts normally; with the switch off, nothing.
     */
    @Test public void recoveryModeOpensAfterAnUnfinishedStart() throws Exception {
        RecoveryModeScenario.run();
    }

    /**
     * wizard-ux issue 1830 (switch wizard/pin-instant-open): a home-screen app window opens on the app's last screen at
     * once with no Connecting, asks the box only whether the app's page changed, shows an updated app on the next open,
     * and with the switch off opens as today. Named to run last: it brings Wi-Fi up for its network check.
     */
    @Test public void thePinnedAppOpensOnItsLastScreen() throws Exception {
        PinInstantScenario.run();
    }

    /** CI emulators raise "Pixel Launcher isn't responding" over the app; tap Wait and keep looking. */
    private static androidx.test.uiautomator.UiObject2 waitPastSystemDialogs(UiDevice device, androidx.test.uiautomator.BySelector target, long ms) {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) {
            androidx.test.uiautomator.UiObject2 hit = device.wait(Until.findObject(target), 1500);
            if (hit != null) return hit;
            androidx.test.uiautomator.UiObject2 wait = device.findObject(By.res("android:id/aerr_wait"));
            if (wait != null) wait.click();
            else {
                // An ANR dialog whose root UiAutomator can't read: ask the system to close it.
                try { device.executeShellCommand("am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS"); }
                catch (java.io.IOException ignored) { /* best effort */ }
            }
        }
        return null;
    }

    private static final class Fixture implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        volatile boolean running = true;
        final boolean boundary;
        Fixture() throws IOException { this(false); }
        Fixture(boolean boundary) throws IOException {
            this.boundary = boundary;
            new Thread(() -> { while (running) try { respond(socket.accept()); } catch (IOException ignored) {} }, "DeviceFixture").start();
        }
        String origin() { return "http://localhost:" + socket.getLocalPort(); }
        private void respond(Socket s) throws IOException {
            try (Socket client = s) {
                client.setSoTimeout(3000);
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                String request = in.readLine(); if (request == null) return;
                String header; while ((header = in.readLine()) != null && !header.isEmpty()) { }
                String html = "<!doctype html><title>WizardOS</title><!-- core/ synthetic fixture -->"
                    + "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='padding-top:120px'><p id='status'>Checking device bridge</p><button onclick=\"location.href='/not-shell'\">Check wrong path</button>"
                    + "<script>const pending=new Map();let seq=0;"
                    + "function rpc(port,method,v=1,params={}){return new Promise((resolve,reject)=>{const id='t'+(++seq);pending.set(id,resolve);setTimeout(()=>reject(Error('timeout '+method)),10000);port.postMessage(JSON.stringify({v,id,method,params}));});}"
                    + "function receive(e){const m=JSON.parse(e.data);const done=pending.get(m.id);if(done){pending.delete(m.id);done(m);}}"
                    + "function check(v){if(!v)throw Error('assertion');}"
                    + "async function main(){wizardDevicePort.onmessage=receive;wizardAppsPort.onmessage=receive;"
                    + "let m=await rpc(wizardDevicePort,'device.capabilities');check(m.v===1&&m.ok&&m.result.capabilities['device.packages'].v===1);"
                    + "m=await rpc(wizardDevicePort,'device.packages.list');check(m.ok&&Array.isArray(m.result.apps));"
                    + "m=await rpc(wizardDevicePort,'device.packages.status');check(m.ok&&m.result.app==='ai.wizards.os.qa');"
                    + "m=await rpc(wizardDevicePort,'device.packages.scheduleUpdates');check(!m.ok&&m.error==='unknown method');"
                    + "let invalid=new Promise(resolve=>pending.set('',resolve));wizardDevicePort.postMessage(JSON.stringify({v:2,id:'bad',method:'device.packages.install',params:{}}));m=await invalid;check(!m.ok&&m.error==='invalid request');"
                    // Binary payloads (WEB_MESSAGE_ARRAY_BUFFER) must be refused, not crash the app on the UI thread.
                    + "let binary=true;try{invalid=new Promise(resolve=>pending.set('',resolve));wizardDevicePort.postMessage(new ArrayBuffer(4));}catch(e){binary=false;pending.delete('');}if(binary){m=await invalid;check(!m.ok&&m.error==='invalid request');}"
                    + "try{wizardAppsPort.postMessage(new ArrayBuffer(4));}catch(e){}"
                    + "m=await rpc(wizardAppsPort,'status');check(m.ok&&!('v' in m)&&m.result.bridge===1);"
                    + "let child=new Promise((resolve,reject)=>{window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data==='child-refused')resolve();if(e.data==='child-replied')reject(Error('iframe native access'));});});let frame=document.createElement('iframe');frame.src='/probe';document.body.append(frame);await child;"
                    + "document.getElementById('status').textContent='Device bridge verified';}"
                    + "main().catch(e=>document.getElementById('status').textContent='FAILED '+e.message);</script>";
                String child = "<!doctype html><script>if(window.wizardDevicePort){wizardDevicePort.onmessage=()=>parent.postMessage('child-replied',location.origin);wizardDevicePort.postMessage(JSON.stringify({v:1,id:'child',method:'device.packages.status',params:{}}));}setTimeout(()=>parent.postMessage('child-refused',location.origin),1500);</script>";
                String wrongPath = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><body style='padding-top:120px'><p id='status'>Checking wrong path</p><script>let replied=false;wizardDevicePort.onmessage=()=>{replied=true;document.getElementById('status').textContent='FAILED native reply';};wizardDevicePort.postMessage(JSON.stringify({v:1,id:'wrong',method:'device.packages.status',params:{}}));setTimeout(()=>{if(!replied)document.getElementById('status').textContent='Wrong path refused';},1500);</script>";
                // Boundary page: first load (bridges as always) tells the app the box is on; the app reloads with the gate.
                String boundaryHtml = "<!doctype html><title>WizardOS</title><!-- core/ synthetic fixture -->"
                    + "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='padding-top:120px'><p id='status'>Checking boundary</p>"
                    + "<script>const S=document.getElementById('status');function check(v,m){if(!v)throw Error(m);}"
                    + "async function main(){check(typeof WizardOSNative==='object'&&typeof WizardOSDevice==='object','shell has no bridges');"
                    + "if(!sessionStorage.getItem('armed')){sessionStorage.setItem('armed','1');check(typeof window.WizardOSGate==='undefined','gate while off');WizardOSNative.browserBoundary(true);S.textContent='Arming boundary';return;}"
                    + "check(typeof window.WizardOSGate==='undefined','gate left on the shell page');"
                    + "check(typeof WizardOSDevice.version()==='number','device answer');check(typeof WizardOSNative.platform()==='string','native answer');"
                    + "check(typeof WizardOSDevice.recStart==='function'&&typeof WizardOSDevice.nope==='undefined','method list');"
                    + "const got=new Promise((res,rej)=>{addEventListener('message',e=>{if(e.data&&e.data.probe)res(e.data);});setTimeout(()=>rej(Error('app frame silent')),10000);});"
                    + "const f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.src='/probe-sandboxed';document.body.append(f);const r=await got;"
                    + "check(r.native==='undefined'&&r.device==='undefined','app frame sees '+r.native+'/'+r.device);"
                    + "check(r.gate==='refused'||r.gate==='none','gate answered the app frame: '+r.gate);"
                    + "WizardOSNative.browserBoundary(false);S.textContent='Boundary verified ('+r.gate+')';}"
                    + "main().catch(e=>S.textContent='FAILED '+e.message);</script>";
                String sandboxed = "<!doctype html><script>let gate='none';try{if(window.WizardOSGate){const a=WizardOSGate.call('','WizardOSDevice','version','[]');"
                    + "gate=JSON.parse(a).e==='refused'?'refused':'answered '+a;if(WizardOSGate.methods('','WizardOSDevice'))gate='listed';}}catch(e){gate='threw '+e.message;}"
                    + "parent.postMessage({probe:1,native:typeof WizardOSNative,device:typeof WizardOSDevice,gate},'*');</script>";
                byte[] bytes = (request.startsWith("GET /wizard-os-home/") ? (boundary ? boundaryHtml : html) : request.startsWith("GET /probe-sandboxed ") ? sandboxed : request.startsWith("GET /probe ") ? child : request.startsWith("GET /not-shell ") ? wrongPath : "{}").getBytes(StandardCharsets.UTF_8);
                OutputStream out = client.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.write(bytes); out.flush();
            }
        }
        @Override public void close() throws IOException { running = false; socket.close(); }
    }

    private static final String SHELL = repeat('a');
    private static final String FRAME = repeat('f');

    /**
     * The browser owner boundary's shell token in the real Android app (wizard-os#133, wizard-ux#1687), on a real WebView
     * against a disposable localhost Wizard, never an owner's server.
     *
     * Proves what a JVM run cannot: MainActivity takes the token only from the shell page once its bridges are gated, an
     * app page can never plant one (not before the gate, not through the gate from a sandboxed app frame), and the app's
     * own native calls (Http.json, what sharing, Archimedes Anywhere, reply notifications and dictation use) then carry it
     * only to owner routes on that box. Turning the boundary off forgets it.
     */
    @Test public void shellTokenComesOnlyFromTheShellPageAndGoesOnlyToOwnerRoutes() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        assertTrue(BuildConfig.DEBUG);
        reset(c);
        try (TokenFixture fixture = new TokenFixture()) {
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            assertNotNull("Connect screen's address field never appeared", waitPastSystemDialogs(device, By.desc("Wizard address"), 30000));
            device.findObject(By.desc("Wizard address")).setText(fixture.origin());
            device.findObject(By.text("Connect")).click();

            // First load (bridges in every frame, no gate): the page and a same-origin frame try to set a token, then the
            // shell turns the boundary on and the app reloads with the gate.
            waitFor(device, "Ready to hand token", 60000);
            assertEquals("A token was taken before the bridges were gated", "", storedToken(c));
            assertNull("A native owner call carried a token before the shell handed one", fixture.callAndHeader("/wizard/v1/agents?step=before"));

            // Gated: the shell page hands its token, then a sandboxed app frame tries to plant its own through the gate.
            device.findObject(By.text("Hand token")).click();
            waitFor(device, "Token handed", 30000);
            assertTrue("The shell page's token was never taken", waitStored(c, SHELL, 5000));
            Thread.sleep(1000); // MainActivity takes bridge calls on its main thread: give a late frame call time to land
            assertEquals("An app frame replaced the shell's token", SHELL, storedToken(c));

            assertEquals("Owner route on the box: shell token", SHELL, fixture.callAndHeader("/wizard/v1/agents?step=on"));
            assertEquals("Owner route on the App Manager listener: shell token", SHELL, fixture.callAndHeader("/wizard-os-home/store-install/_updates?step=on"));
            assertNull("App path got the shell token", fixture.callAndHeader("/notes/api/list?step=on"));
            assertNull("Doubled slash path got the shell token", fixture.callAndHeader("/wizard//x?step=on"));
            assertNull("Another origin got the shell token", fixture.callAndHeader(fixture.otherOrigin(), "/wizard/v1/agents?step=other"));

            // The box says off: the token is forgotten at once.
            device.findObject(By.text("Boundary off")).click();
            waitFor(device, "Boundary is off", 30000);
            assertTrue("Turning the boundary off kept the token", waitStored(c, "", 5000));
            assertNull("Owner route still got a token after off", fixture.callAndHeader("/wizard/v1/agents?step=off"));
        } finally {
            reset(c);
        }
    }

    private static void reset(Context c) {
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        c.getSharedPreferences("wizard_browser_boundary", Context.MODE_PRIVATE).edit().clear().commit();
        ShellToken.clear(c);
        c.getSharedPreferences("wizard_shell_token", Context.MODE_PRIVATE).edit().clear().commit();
    }

    private static String storedToken(Context c) {
        SharedPreferences p = c.getSharedPreferences("wizard_shell_token", Context.MODE_PRIVATE);
        return p.getString("token", "");
    }

    private static boolean waitStored(Context c, String want, long ms) throws InterruptedException {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) {
            if (want.equals(storedToken(c))) return true;
            Thread.sleep(100);
        }
        return want.equals(storedToken(c));
    }

    private static void waitFor(UiDevice device, String text, long ms) {
        UiObject2 ok = waitPastSystemDialogs(device, By.textStartsWith(text), ms);
        if (ok != null) return;
        UiObject2 failed = device.findObject(By.textStartsWith("FAILED"));
        fail(failed != null ? failed.getText() : "page never showed \"" + text + "\"");
    }

    private static String repeat(char ch) {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < 64; i++) s.append(ch);
        return s.toString();
    }

    private static final class TokenFixture implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
        final Map<String, String> seen = new ConcurrentHashMap<>();
        volatile boolean running = true;
        TokenFixture() throws IOException {
            new Thread(() -> { while (running) try { respond(socket.accept()); } catch (IOException ignored) {} }, "ShellTokenFixture").start();
        }
        /** The box the app connects to; the same server under 127.0.0.1 is "another origin". */
        String origin() { return "http://localhost:" + socket.getLocalPort(); }
        String otherOrigin() { return "http://127.0.0.1:" + socket.getLocalPort(); }

        String callAndHeader(String path) throws Exception { return callAndHeader(origin(), path); }

        /** One real native call (Http.json, as the app's own features make them); the token header the box saw, or null. */
        String callAndHeader(String base, String path) throws Exception {
            seen.remove(path);
            Http.json("GET", base + path, base, null, null);
            String h = seen.get(path);
            assertNotNull("fixture never saw " + path, h);
            return h.isEmpty() ? null : h;
        }

        private void respond(Socket s) throws IOException {
            try (Socket client = s) {
                client.setSoTimeout(3000);
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                String request = in.readLine(); if (request == null) return;
                String token = "";
                String header;
                while ((header = in.readLine()) != null && !header.isEmpty()) {
                    int colon = header.indexOf(':');
                    if (colon > 0 && header.substring(0, colon).trim().toLowerCase(Locale.ROOT).equals("x-wizard-shell-token")) token = header.substring(colon + 1).trim();
                }
                String[] parts = request.split(" ");
                String path = parts.length > 1 ? parts[1] : "";
                String body; String type = "text/html";
                if (path.equals("/wizard-os-home/")) body = shell();
                else if (path.equals("/probe-plant")) body = plantSameOrigin();
                else if (path.equals("/probe-plant-sandboxed")) body = plantSandboxed();
                else { seen.put(path, token); body = "{}"; type = "application/json"; }
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                OutputStream out = client.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + type + "\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.write(bytes); out.flush();
            }
        }

        /** The shell page: load 1 tries to plant tokens without the gate and turns the boundary on; load 2 is gated. */
        private static String shell() {
            return "<!doctype html><title>WizardOS</title><!-- core/ synthetic fixture -->"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'><body style='padding-top:120px'><p id='status'>Checking shell token</p>"
                + "<script>const S=document.getElementById('status');function check(v,m){if(!v)throw Error(m);}"
                + "function button(label,fn){const b=document.createElement('button');b.textContent=label;b.style.cssText='display:block;margin:16px;padding:16px;font-size:20px';b.onclick=()=>fn().catch(e=>S.textContent='FAILED '+e.message);document.body.append(b);}"
                + "function frameSays(src,sandbox){return new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('frame silent '+src)),10000);addEventListener('message',function h(e){if(e.data&&e.data.probe===src){clearTimeout(t);removeEventListener('message',h);res(e.data);}});const f=document.createElement('iframe');if(sandbox)f.setAttribute('sandbox','allow-scripts');f.src=src;document.body.append(f);});}"
                + "async function main(){check(typeof WizardOSNative==='object','shell has no WizardOSNative');"
                + "if(!sessionStorage.getItem('armed')){check(typeof window.WizardOSGate==='undefined','gate while off');"
                + "WizardOSNative.shellToken('" + FRAME + "');"
                + "await frameSays('/probe-plant',false);"
                + "sessionStorage.setItem('armed','1');WizardOSNative.browserBoundary(true);S.textContent='Arming boundary';return;}"
                + "check(typeof window.WizardOSGate==='undefined','gate left on the shell page');check(typeof WizardOSNative.shellToken==='function','shell lost shellToken');"
                + "button('Hand token',async()=>{WizardOSNative.shellToken('" + SHELL + "');"
                + "const r=await frameSays('/probe-plant-sandboxed',true);"
                + "check(r.native==='undefined','app frame sees WizardOSNative');check(r.parent==='blocked','app frame reached the shell page');"
                + "check(!/answered|listed/.test(r.gate),'gate answered the app frame: '+r.gate);"
                + "S.textContent='Token handed ('+r.gate+')';});"
                + "button('Boundary off',async()=>{WizardOSNative.browserBoundary(false);S.textContent='Boundary is off';});"
                + "S.textContent='Ready to hand token';}"
                + "main().catch(e=>S.textContent='FAILED '+e.message);</script>";
        }

        /** A same-origin frame on the first, ungated load: it can reach WizardOSNative, but its token must be ignored. */
        private static String plantSameOrigin() {
            return "<!doctype html><script>try{if(window.WizardOSNative)WizardOSNative.shellToken('" + FRAME + "');}catch(e){}"
                + "parent.postMessage({probe:'/probe-plant'},location.origin);</script>";
        }

        /** A sandboxed app frame under the gate: no bridges, no parent, and the gate refuses every key it can guess. */
        private static String plantSandboxed() {
            return "<!doctype html><script>let gate='none',par='blocked';"
                + "try{void parent.WizardOSNative;par=typeof parent.WizardOSNative==='undefined'?'blocked':'open';}catch(e){par='blocked';}"
                + "try{if(window.WizardOSGate){const keys=['','x','" + SHELL + "','0000000000000000000000000000000000000000000000000000000000000000'];const got=[];"
                + "for(const k of keys){const a=WizardOSGate.call(k,'WizardOSNative','shellToken',JSON.stringify(['" + FRAME + "']));got.push(a&&JSON.parse(a).e==='refused'?'refused':'answered '+a);}"
                + "if(WizardOSGate.methods('','WizardOSNative'))got.push('listed');gate=got.join(',');}}catch(e){gate='threw '+e.message;}"
                + "parent.postMessage({probe:'/probe-plant-sandboxed',native:typeof WizardOSNative,parent:par,gate},'*');</script>";
        }

        @Override public void close() throws IOException { running = false; socket.close(); }
    }
}
