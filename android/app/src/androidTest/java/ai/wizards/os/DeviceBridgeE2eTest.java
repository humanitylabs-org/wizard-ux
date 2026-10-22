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

/** Real WebView request/reply against a disposable localhost Wizard, never an owner's server. */
@RunWith(AndroidJUnit4.class)
public class DeviceBridgeE2eTest {
    @Test public void genericPackagesAndLegacyCompatibility() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        assertTrue(BuildConfig.DEBUG);
        assertEquals("", BuildConfig.ORIGIN);
        c.getSharedPreferences("wizard_server", Context.MODE_PRIVATE).edit().clear().commit();
        try (Fixture fixture = new Fixture()) {
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
            assertNotNull(device.wait(Until.findObject(By.desc("Wizard address")), 15000));
            device.findObject(By.desc("Wizard address")).setText(fixture.origin());
            device.findObject(By.text("Connect")).click();
            assertNotNull("Real WebView generic request/reply or legacy compatibility failed", device.wait(Until.findObject(By.text("Device bridge verified")), 30000));
            assertEquals(c.getPackageName(), device.getCurrentPackageName());
            device.findObject(By.text("Check wrong path")).click();
            assertNotNull("Top-level non-shell path reached native", device.wait(Until.findObject(By.text("Wrong path refused")), 15000));
        }
    }

    private static final class Fixture implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        volatile boolean running = true;
        Fixture() throws IOException {
            new Thread(() -> { while (running) try { respond(socket.accept()); } catch (IOException ignored) {} }, "DeviceFixture").start();
        }
        String origin() { return "http://localhost:" + socket.getLocalPort(); }
        private void respond(Socket s) throws IOException {
            try (Socket client = s) {
                client.setSoTimeout(3000);
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
                String request = in.readLine(); if (request == null) return;
                String header; while ((header = in.readLine()) != null && !header.isEmpty()) { }
                String html = "<!doctype html><title>Wizard OS</title><!-- core/ synthetic fixture -->"
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
                    + "m=await rpc(wizardAppsPort,'status');check(m.ok&&!('v' in m)&&m.result.bridge===1);"
                    + "let child=new Promise((resolve,reject)=>{window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data==='child-refused')resolve();if(e.data==='child-replied')reject(Error('iframe native access'));});});let frame=document.createElement('iframe');frame.src='/probe';document.body.append(frame);await child;"
                    + "document.getElementById('status').textContent='Device bridge verified';}"
                    + "main().catch(e=>document.getElementById('status').textContent='FAILED '+e.message);</script>";
                String child = "<!doctype html><script>if(window.wizardDevicePort){wizardDevicePort.onmessage=()=>parent.postMessage('child-replied',location.origin);wizardDevicePort.postMessage(JSON.stringify({v:1,id:'child',method:'device.packages.status',params:{}}));}setTimeout(()=>parent.postMessage('child-refused',location.origin),1500);</script>";
                String wrongPath = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><body style='padding-top:120px'><p id='status'>Checking wrong path</p><script>let replied=false;wizardDevicePort.onmessage=()=>{replied=true;document.getElementById('status').textContent='FAILED native reply';};wizardDevicePort.postMessage(JSON.stringify({v:1,id:'wrong',method:'device.packages.status',params:{}}));setTimeout(()=>{if(!replied)document.getElementById('status').textContent='Wrong path refused';},1500);</script>";
                byte[] bytes = (request.startsWith("GET /wizard-os-home/") ? html : request.startsWith("GET /probe ") ? child : request.startsWith("GET /not-shell ") ? wrongPath : "{}").getBytes(StandardCharsets.UTF_8);
                OutputStream out = client.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.write(bytes); out.flush();
            }
        }
        @Override public void close() throws IOException { running = false; socket.close(); }
    }
}
