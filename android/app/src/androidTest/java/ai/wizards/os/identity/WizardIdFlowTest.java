package ai.wizards.os.identity;

import ai.wizards.os.MainActivity;
import ai.wizards.os.BuildConfig;
import android.content.Context;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.Direction;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import fr.acinq.secp256k1.Secp256k1;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Isolated emulator only. PIN 246810 is synthetic and provisioned by the Thales wrapper. */
@RunWith(AndroidJUnit4.class)
public class WizardIdFlowTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private final File output = new File(context.getExternalFilesDir(null),"identity-qa");
    private ActivityScenario<MainActivity> scenario;
    private WebView web;

    @Test public void pinGatedOnboardingBackupAndSigningThroughExistingBridge() throws Exception {
        assertTrue(BuildConfig.DEBUG); output.mkdirs();
        assertTrue(context.getSharedPreferences("wizard-id-v1",0).edit().clear().commit());
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); store.deleteEntry(KeyVault.ALIAS);
        try (Fixture fixture = new Fixture()) {
            Files.write(new File(context.getFilesDir(),"qa_home.txt").toPath(),fixture.origin().getBytes(StandardCharsets.UTF_8));
            scenario = ActivityScenario.launch(MainActivity.class);
            scenario.onActivity(a -> { try { java.lang.reflect.Field f=MainActivity.class.getDeclaredField("web"); f.setAccessible(true); web=(WebView)f.get(a); } catch(Exception e) { throw new AssertionError(e); } });
            waitFor(() -> "true".equals(evaluate("!!window.qaReplies && !!window.WizCore?.bridge && typeof wizardDevicePort==='object'")));
            assertTrue(result(call("before","identity.info",null)).getBoolean("none"));
            call("cancel-setup","identity.setup",null); visible("Create your Wizard ID");
            visible("Import the nsec you already use"); visible("A fresh ID made on this phone");
            assertEquals("#ff05030c",ai.wizards.os.WizardLook.identityColors(context).getString("base"));
            assertNotNull(device.findObject(By.desc("Close Wizard ID"))); assertFalse(device.hasObject(By.text("Cancel")));
            screenshot("onboarding-dark.png");
            click("Use my existing Nostr key"); visible("I have a Wizard ID");
            device.findObject(By.desc("Back")).click(); visible("Create your Wizard ID"); alive();
            click("Create a new key"); visible("Your name");
            device.pressBack(); visible("Create your Wizard ID"); alive();
            device.pressBack(); assertTrue(result("cancel-setup").getBoolean("cancelled")); alive();
            call("setup","identity.setup",null); visible("Create your Wizard ID"); click("Create a new key"); visible("Your name"); screenshot("create-dark.png");
            device.findObjects(By.clazz("android.widget.EditText")).get(0).setText("Emulator Wizard");
            click("Create key"); pin(); visible("Save your key"); screenshot("backup-options-dark.png");
            click("No password manager? Copy and check"); pin();
            UiObject2 secretView=device.wait(Until.findObject(By.textStartsWith("nsec1")),15000);
            assertNotNull(secretView); String nsec=secretView.getText();
            click("Copy");
            assertEquals(nsec,((android.content.ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE)).getPrimaryClip().getItemAt(0).getText().toString());
            // Native test memory only: never output or screenshot a secret.
            device.findObject(By.clazz("android.widget.EditText")).setText(nsec); hideKeyboard();
            click("Check backup"); visible("Update your profile"); click("Approve & sign"); pin();
            JSONObject enrolled=result("setup"); verify(enrolled.getJSONObject("profile_event"));
            JSONObject info=result(call("info","identity.info",null)); assertTrue(info.getBoolean("backed_up"));
            assertEquals(enrolled.getString("npub"),info.getString("npub")); assertFalse(info.toString().contains(nsec));
            String prefs=context.getSharedPreferences("wizard-id-v1",0).getAll().toString(); assertFalse(prefs.contains(nsec));
            byte[] secret=Nip19.secret(nsec); try { assertFalse(prefs.contains(NostrEvent.hex(secret))); } finally { Arrays.fill(secret,(byte)0); }
            JSONObject event=new JSONObject().put("kind",30117).put("tags",new JSONArray("[[\"name\",\"Midnight\"],[\"d\",\"midnight\"]]")).put("content","").put("description","Harmless login from requester");
            call("deny","identity.sign",new JSONObject().put("event",event)); visible("Publish Midnight as your skin");
            assertFalse(device.hasObject(By.textContains("Harmless login"))); screenshot("approval-skin-dark.png");
            device.findObject(By.desc("Close Wizard ID")).click(); assertTrue(result("deny").getBoolean("denied"));
            call("skin","identity.sign",new JSONObject().put("event",event)); visible("Publish Midnight as your skin"); click("Approve & sign"); pin();
            JSONObject signed=result("skin"); verify(signed); write("signed-event.json",signed.toString(2));
            JSONObject capture=result(call("capture","view.capture",new JSONObject().put("rect",new JSONObject().put("x",0).put("y",0).put("width",80).put("height",50))));
            byte[] image=android.util.Base64.decode(capture.getString("webp_b64"),android.util.Base64.DEFAULT);
            assertEquals("RIFF",new String(image,0,4,StandardCharsets.US_ASCII));
            android.graphics.Bitmap bitmap=android.graphics.BitmapFactory.decodeByteArray(image,0,image.length);
            assertEquals(capture.getInt("width"),bitmap.getWidth()); assertEquals(capture.getInt("height"),bitmap.getHeight()); bitmap.recycle();
            Files.write(new File(output,"capture.webp").toPath(),image);
            assertTrue(result(call("bad-capture","view.capture",new JSONObject().put("rect",new JSONObject().put("x",-1).put("y",0).put("width",80).put("height",50)))).getBoolean("denied"));
            call("dark-settings","identity.setup",null); visible("Backed up"); screenshot("settings-dark.png"); device.pressBack(); result("dark-settings"); alive();
            evaluate("document.documentElement.dataset.skin='paper';document.documentElement.style.cssText='--wz-base:#faf5ec;--wz-text:#201c30;--wz-text-secondary:#575060;--wz-text-muted:#685e73;--wz-border:#d5cddb;--wz-accent:#6140a0;--wz-warning:#855000;--wz-overlay:#f2edf7'");
            call("settings","identity.setup",null); visible("Backed up");
            JSONObject paper=ai.wizards.os.WizardLook.identityColors(context);
            assertEquals("#fffaf5ec",paper.getString("base")); assertEquals("#fff2edf7",paper.getString("sheet")); assertEquals("#ff6140a0",paper.getString("accent"));
            screenshot("settings-light.png"); device.pressBack(); result("settings"); alive();
            JSONObject app=new JSONObject().put("kind",30617).put("tags",new JSONArray("[[\"d\",\"editor\"]]")).put("content","");
            call("app","identity.sign",new JSONObject().put("event",app)); visible("Publish editor as your app"); screenshot("approval-app-light.png"); device.pressBack(); assertTrue(result("app").getBoolean("denied")); alive();
            installedAppIdentity(info);
            // Restore the backed-up key after simulating a fresh install.
            assertTrue(context.getSharedPreferences("wizard-id-v1",0).edit().clear().commit()); store.deleteEntry(KeyVault.ALIAS);
            evaluate("document.documentElement.dataset.skin='paper';document.documentElement.style.cssText='--wz-base:#faf5ec;--wz-text:#201c30;--wz-text-secondary:#575060;--wz-text-muted:#685e73;--wz-border:#d5cddb;--wz-accent:#6140a0;--wz-warning:#855000;--wz-overlay:#f2edf7'");
            call("restore","identity.setup",null); visible("Create your Wizard ID"); screenshot("onboarding-light.png"); click("Create a new key"); visible("Your name"); screenshot("create-light.png");
            device.findObject(By.desc("Back")).click(); visible("Create your Wizard ID");
            click("Use my existing Nostr key"); visible("I have a Wizard ID");
            java.util.List<UiObject2> inputs=device.findObjects(By.clazz("android.widget.EditText")); inputs.get(0).setText("Restored Wizard"); inputs.get(1).setText(nsec); hideKeyboard();
            click("Import key"); pin(); visible("Save your key"); click("Not now"); visible("Update your profile"); click("Approve & sign"); pin();
            JSONObject restored=result("restore"); assertEquals(info.getString("npub"),restored.getString("npub")); assertFalse(restored.getBoolean("backed_up")); verify(restored.getJSONObject("profile_event"));
            // Trusted-origin iframe cannot reach native even though its object is injected by WebView.
            evaluate("window.childReply=false;window.addEventListener('message',e=>{if(e.data==='native-reply')window.childReply=true;});let f=document.createElement('iframe');f.src='/child';document.body.append(f)");
            Thread.sleep(1800); assertEquals("false",evaluate("window.childReply"));
            call("navigation","identity.sign",new JSONObject().put("event",event)); visible("Publish Midnight as your skin");
            scenario.onActivity(a -> web.loadUrl(fixture.origin()+"/wizard-os-home/?next=1"));
            waitFor(() -> "true".equals(evaluate("location.search==='?next=1' && document.readyState==='complete' && !!window.qaReplies")));
            waitFor(() -> !device.hasObject(By.text("Approve & sign"))); alive(); // navigation closed the pending approval
            scenario.onActivity(a -> web.loadDataWithBaseURL("https://evil.example/wizard-os-home/","<html>Wrong origin</html>","text/html","utf-8",null));
            waitFor(() -> "true".equals(evaluate("location.hostname==='evil.example'")));
            assertEquals("\"undefined\"",evaluate("typeof window.wizardDevicePort")); device.pressBack(); alive();
            write("receipt.json",new JSONObject().put("status","ok").put("package",BuildConfig.APPLICATION_ID).put("synthetic_pin",true).put("backed_up",true)
                .put("npub",info.getString("npub")).put("signed_event_id",signed.getString("id")).put("skin_count",2).put("physical_phone",false).toString(2));
        } finally { if(scenario!=null)scenario.close(); Files.deleteIfExists(new File(context.getFilesDir(),"qa_home.txt").toPath()); }
    }
    private void installedAppIdentity(JSONObject info) throws Exception {
        waitFor(() -> "true".equals(evaluate("!!document.getElementById('profiles')?.contentWindow.WizardApp")));
        assertEquals(info.getString("pubkey"), result(appCall("app-info", "info", null)).getString("pubkey"));
        String publicKey = info.getString("pubkey"), shortKey = NostrEvent.shortNpub(publicKey);
        JSONObject devices = new JSONObject().put("kind", 30078).put("content", "").put("tags", new JSONArray()
            .put(new JSONArray().put("d").put("wizard-devices"))
            .put(new JSONArray().put("p").put(publicKey).put("wss://relay.example").put("inbox")));
        // The app cannot rename itself with requester fields; every visible label is catalog-owned.
        for (String skin : new String[]{"light", "dark"}) {
            if ("dark".equals(skin)) evaluate("document.documentElement.dataset.skin='nebula';document.documentElement.style.cssText='--wz-base:#05030c;--wz-text:#f3efff;--wz-text-secondary:#b9b0d8;--wz-text-muted:#7d74a3;--wz-border:#cdbeff3d;--wz-accent:#b99bff;--wz-warning:#ffd080;--wz-overlay:#120c25'");
            appCall("devices-" + skin, "sign", devices); visible("Let this Wizard receive for you"); visible("Profiles asks:"); visible("Wizard: " + shortKey);
            screenshot("approval-devices-" + skin + ".png");
            if ("light".equals(skin)) { device.pressBack(); assertTrue(result("devices-" + skin).getBoolean("denied")); alive(); }
            else { click("Approve & sign"); pin(); verify(result("devices-" + skin)); }
        }
        devices.getJSONArray("tags").put(new JSONArray().put("revoked").put(publicKey).put("123"));
        appCall("device-revoke", "sign", devices); visible("Remove a Wizard from your Wizard ID"); screenshot("approval-revoke-dark.png");
        device.pressBack(); assertTrue(result("device-revoke").getBoolean("denied")); alive();
        JSONObject rumor = new JSONObject().put("kind", 1078).put("content", "synthetic friend profile").put("tags", new JSONArray()
            .put(new JSONArray().put("t").put("wizard-profile")).put(new JSONArray().put("p").put(publicKey)));
        JSONObject encrypt = new JSONObject().put("pubkey", publicKey).put("plaintext", rumor.toString()).put("requester", "Fake bank").put("description", "Harmless login");
        appCall("encrypt-deny", "nip44_encrypt", encrypt); visible("Add " + shortKey + " as a friend · sealed to " + shortKey); visible("Profiles asks:");
        assertFalse(device.hasObject(By.textContains("Fake bank"))); assertFalse(device.hasObject(By.textContains("Harmless login")));
        screenshot("approval-encrypt-dark.png"); device.pressBack(); assertTrue(result("encrypt-deny").getBoolean("denied")); alive();
        appCall("encrypt", "nip44_encrypt", encrypt); visible("Profiles asks:"); click("Approve & encrypt"); pin();
        JSONObject encrypted = result("encrypt"); assertEquals(1, encrypted.length()); String ciphertext = encrypted.getString("ciphertext");
        assertFalse(ciphertext.contains("synthetic friend"));
        JSONObject decrypt = new JSONObject().put("pubkey", publicKey).put("ciphertext", ciphertext);
        appCall("decrypt-deny", "nip44_decrypt", decrypt); visible("Open a sealed message from " + shortKey); visible("Profiles asks:");
        screenshot("approval-decrypt-dark.png"); device.pressBack(); assertTrue(result("decrypt-deny").getBoolean("denied")); alive();
        appCall("decrypt", "nip44_decrypt", decrypt); visible("Open a sealed message from " + shortKey); click("Approve & open"); pin();
        JSONObject opened = result("decrypt"); assertEquals(1, opened.length()); assertEquals(rumor.toString(), opened.getString("plaintext"));
        // Tampering is denied after a separate fresh PIN, never producing unauthenticated plaintext.
        byte[] corrupt = android.util.Base64.decode(ciphertext, android.util.Base64.NO_WRAP); corrupt[corrupt.length - 1] ^= 1;
        decrypt.put("ciphertext", android.util.Base64.encodeToString(corrupt, android.util.Base64.NO_WRAP));
        appCall("decrypt-corrupt", "nip44_decrypt", decrypt); visible("Open a sealed message from " + shortKey); click("Approve & open"); pin();
        assertTrue(result("decrypt-corrupt").getBoolean("denied")); alive();
        JSONObject seal = new JSONObject().put("kind", 13).put("tags", new JSONArray()).put("content", ciphertext);
        appCall("seal", "sign", seal); visible("Send a sealed friend request"); visible("Profiles asks:"); screenshot("approval-seal-dark.png");
        device.pressBack(); assertTrue(result("seal").getBoolean("denied")); alive();
        write("apps-receipt.json", new JSONObject().put("status", "ok").put("app", "profiles").put("device_list_signed", true)
            .put("nip44_roundtrip", true).put("tamper_denied", true).put("back_stays_in_app", true).put("fresh_pin_operations", 4).toString(2));
    }
    private String appCall(String id, String method, JSONObject args) throws Exception {
        evaluate("document.getElementById('profiles').contentWindow.WizardApp.identity[" + JSONObject.quote(method) + "](" + (args == null ? "" : args.toString()) + ")"
            + ".then(r=>qaReplies[" + JSONObject.quote(id) + "]=r).catch(e=>qaReplies[" + JSONObject.quote(id) + "]={error:e.message})"); return id;
    }
    private String call(String id,String method,JSONObject params) throws Exception {
        evaluate("WizCore.bridge.call("+JSONObject.quote(method)+","+(params==null?"{}":params.toString())+").then(r=>qaReplies["+JSONObject.quote(id)+"]=r).catch(e=>qaReplies["+JSONObject.quote(id)+"]={error:e.message})"); return id;
    }
    private JSONObject result(String id) throws Exception {
        waitFor(() -> "true".equals(evaluate("Boolean(window.qaReplies && window.qaReplies["+JSONObject.quote(id)+"])")));
        JSONObject r=new JSONObject((String)new JSONTokener(evaluate("JSON.stringify(qaReplies["+JSONObject.quote(id)+"])")).nextValue()); assertFalse(r.toString(),r.has("error")); return r;
    }
    private String evaluate(String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1); AtomicReference<String> v=new AtomicReference<>("null");
        scenario.onActivity(a -> web.evaluateJavascript(script,x -> { v.set(x); latch.countDown(); })); assertTrue(latch.await(10,TimeUnit.SECONDS)); return v.get();
    }
    private void visible(String text) { if(!device.wait(Until.hasObject(By.text(text)),15000)){try{device.dumpWindowHierarchy(new File(output,"visible-timeout.xml"));}catch(Exception ignored){}fail("Missing native UI: "+text);} }
    private void click(String text) {
        for(int i=0;i<10;i++){UiObject2 v=device.findObject(By.text(text));if(v!=null&&!v.getVisibleBounds().isEmpty()){v.click();return;}java.util.List<UiObject2> ss=device.findObjects(By.scrollable(true));for(int k=ss.size()-1;k>=0;k--)ss.get(k).scroll(Direction.DOWN,.65f);device.waitForIdle();}
        try{device.dumpWindowHierarchy(new File(output,"click-timeout.xml"));}catch(Exception ignored){}fail("Cannot reach "+text);
    }
    private void pin() throws Exception {
        device.waitForIdle(); UiObject2 choose=device.wait(Until.findObject(By.text(java.util.regex.Pattern.compile("(?i)(use )?(PIN|screen lock|device credential)"))),2000); if(choose!=null)choose.click();
        try {
            waitFor(() -> device.hasObject(By.res("com.android.systemui","pinEntry")) || device.hasObject(By.res("com.android.systemui","auth_credential_header")) || device.hasObject(By.res("com.android.systemui","lockPassword")) || device.hasObject(By.res("com.android.settings","password_entry")) || device.hasObject(By.textContains("Enter your PIN")) || device.hasObject(By.textContains("Confirm your PIN")) || device.hasObject(By.textContains("Enter your device PIN")));
        } catch (AssertionError e) {
            // Diagnostics only (no secrets on screen at a PIN prompt): what the screen showed instead.
            screenshot("pin-timeout.png"); device.dumpWindowHierarchy(new File(output,"pin-timeout.xml")); throw e;
        }
        device.executeShellCommand("input text 246810"); device.pressEnter(); device.waitForIdle();
    }
    // Back on a native Wizard ID sheet cancels it (Back never exits, it closes one level), so only dismiss a keyboard that is really up.
    private void hideKeyboard() throws Exception { if (device.executeShellCommand("dumpsys input_method").contains("mInputShown=true")) device.pressBack(); device.waitForIdle(); }
    private void alive(){scenario.onActivity(a->{assertFalse(a.isFinishing());assertFalse(a.isDestroyed());});}
    private void screenshot(String name){assertTrue(device.takeScreenshot(new File(output,name)));}
    private void write(String name,String value)throws Exception{Files.write(new File(output,name).toPath(),value.getBytes(StandardCharsets.UTF_8));}
    private void verify(JSONObject e)throws Exception{byte[] digest=NostrEvent.digest(e);assertEquals(NostrEvent.hex(digest),e.getString("id"));assertTrue(Secp256k1.get().verifySchnorr(NostrEvent.bytes(e.getString("sig")),digest,NostrEvent.bytes(e.getString("pubkey"))));}
    private interface Check{boolean get()throws Exception;}
    private void waitFor(Check check)throws Exception{long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(30);while(System.nanoTime()<end){if(check.get())return;Thread.sleep(200);}fail("Timed out waiting for Wizard ID QA");}
    private static class Fixture implements AutoCloseable {
        final ServerSocket socket=new ServerSocket(0,10,InetAddress.getByName("127.0.0.1")); volatile boolean running=true;
        final java.util.Map<String, byte[]> scripts = new java.util.HashMap<>();
        Fixture() throws Exception {
            for (String name : new String[]{"bridge.js", "app-services.js", "app-client.js"}) {
                try(InputStream in=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open(name)){ scripts.put("/" + name, readBytes(in)); }
            }
            new Thread(()->{while(running)try{respond(socket.accept());}catch(IOException ignored){}},"IdentityFixture").start();
        }
        private static byte[] readBytes(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}
        String origin(){return "http://localhost:"+socket.getLocalPort();}
        private void respond(Socket s)throws IOException {
            try(Socket client=s){client.setSoTimeout(3000);BufferedReader in=new BufferedReader(new InputStreamReader(client.getInputStream(),StandardCharsets.UTF_8));String request=in.readLine();if(request==null)return;String line;while((line=in.readLine())!=null&&!line.isEmpty()){}
                String path = request.split(" ")[1]; boolean script = scripts.containsKey(path);
                String html="<!doctype html><html data-skin='nebula' style='--wz-base:#05030c;--wz-text:#f3efff;--wz-text-secondary:#b9b0d8;--wz-text-muted:#7d74a3;--wz-border:#cdbeff3d;--wz-accent:#b99bff;--wz-warning:#ffd080;--wz-overlay:#120c25'><title>Wizard OS</title><!-- core/ isolated fixture --><meta name='viewport' content='width=device-width,initial-scale=1'><body style='background:#05030c;color:white;padding:100px 24px'><h1>Wizard ID isolated QA</h1><script>window.qaReplies={};</script><script src='/bridge.js'></script>"
                    + "<script>WizCore.apps=()=>({APPS:[{id:'profiles',name:'Profiles',kind:'wizard',source:'apps.json',url:'/profiles/'}]});</script><script src='/app-services.js'></script>"
                    + "<iframe id='profiles' src='/profiles/'></iframe><script>WizAppServices.attach(document.getElementById('profiles'),{appId:'profiles',path:'/profiles/'});</script></body></html>";
                if(path.equals("/profiles/")) html="<!doctype html><title>Profiles</title><script src='/app-client.js'></script><script>WizardApp.ready({name:'Profiles'});</script>";
                if(request.startsWith("GET /child "))html="<script>wizardDevicePort.onmessage=()=>parent.postMessage('native-reply',location.origin);wizardDevicePort.postMessage(JSON.stringify({v:1,id:'child',method:'identity.info',params:{}}));</script>";
                byte[] bytes=script?scripts.get(path):html.getBytes(StandardCharsets.UTF_8);OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: "+(script?"application/javascript":"text/html")+"\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));out.write(bytes);out.flush();}
        }
        @Override public void close()throws IOException{running=false;socket.close();}
    }
}
