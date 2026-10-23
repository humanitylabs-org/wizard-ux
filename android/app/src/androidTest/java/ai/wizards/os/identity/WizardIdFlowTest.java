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
            call("cancel-setup","identity.setup",null); visible("Create your Wizard ID"); screenshot("onboarding-dark.png");
            device.pressBack(); assertTrue(result("cancel-setup").getBoolean("cancelled")); alive();
            call("setup","identity.setup",null); visible("Create your Wizard ID");
            device.findObjects(By.clazz("android.widget.EditText")).get(0).setText("Emulator Wizard");
            click("Create key"); pin(); visible("Save your key");
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
            click("Cancel"); assertTrue(result("deny").getBoolean("denied"));
            call("skin","identity.sign",new JSONObject().put("event",event)); visible("Publish Midnight as your skin"); click("Approve & sign"); pin();
            JSONObject signed=result("skin"); verify(signed); write("signed-event.json",signed.toString(2));
            JSONObject capture=result(call("capture","view.capture",new JSONObject().put("rect",new JSONObject().put("x",0).put("y",0).put("width",80).put("height",50))));
            byte[] image=android.util.Base64.decode(capture.getString("webp_b64"),android.util.Base64.DEFAULT);
            assertEquals("RIFF",new String(image,0,4,StandardCharsets.US_ASCII));
            android.graphics.Bitmap bitmap=android.graphics.BitmapFactory.decodeByteArray(image,0,image.length);
            assertEquals(capture.getInt("width"),bitmap.getWidth()); assertEquals(capture.getInt("height"),bitmap.getHeight()); bitmap.recycle();
            Files.write(new File(output,"capture.webp").toPath(),image);
            assertTrue(result(call("bad-capture","view.capture",new JSONObject().put("rect",new JSONObject().put("x",-1).put("y",0).put("width",80).put("height",50)))).getBoolean("denied"));
            evaluate("document.documentElement.style.cssText='--wz-base:#faf5ec;--wz-text:#201c30;--wz-accent:#6140a0;--wz-warning:#855000'");
            call("settings","identity.setup",null); visible("Backed up"); screenshot("settings-light.png"); device.pressBack(); result("settings"); alive();
            JSONObject app=new JSONObject().put("kind",30617).put("tags",new JSONArray("[[\"d\",\"editor\"]]")).put("content","");
            call("app","identity.sign",new JSONObject().put("event",app)); visible("Publish editor as your app"); screenshot("approval-app-light.png"); device.pressBack(); assertTrue(result("app").getBoolean("denied")); alive();
            // Restore the backed-up key after simulating a fresh install.
            assertTrue(context.getSharedPreferences("wizard-id-v1",0).edit().clear().commit()); store.deleteEntry(KeyVault.ALIAS);
            call("restore","identity.setup",null); visible("Create your Wizard ID"); click("Use my existing key"); visible("I have a Wizard ID");
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
    private void visible(String text) { assertTrue("Missing native UI: "+text,device.wait(Until.hasObject(By.text(text)),15000)); }
    private void click(String text) {
        for(int i=0;i<10;i++){UiObject2 v=device.findObject(By.text(text));if(v!=null&&!v.getVisibleBounds().isEmpty()){v.click();return;}UiObject2 s=device.findObject(By.scrollable(true));if(s!=null)s.scroll(Direction.DOWN,.65f);device.waitForIdle();}fail("Cannot reach "+text);
    }
    private void pin() throws Exception {
        device.waitForIdle(); UiObject2 choose=device.wait(Until.findObject(By.text(java.util.regex.Pattern.compile("(?i)(use )?(PIN|screen lock|device credential)"))),2000); if(choose!=null)choose.click();
        try {
            waitFor(() -> device.hasObject(By.res("com.android.systemui","pinEntry")) || device.hasObject(By.res("com.android.systemui","lockPassword")) || device.hasObject(By.res("com.android.settings","password_entry")) || device.hasObject(By.textContains("Enter your PIN")) || device.hasObject(By.textContains("Confirm your PIN")) || device.hasObject(By.textContains("Enter your device PIN")));
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
        final byte[] bridge;
        Fixture() throws Exception {
            try(InputStream in=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("bridge.js")){bridge=readBytes(in);}
            new Thread(()->{while(running)try{respond(socket.accept());}catch(IOException ignored){}},"IdentityFixture").start();
        }
        private static byte[] readBytes(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}
        String origin(){return "http://localhost:"+socket.getLocalPort();}
        private void respond(Socket s)throws IOException {
            try(Socket client=s){client.setSoTimeout(3000);BufferedReader in=new BufferedReader(new InputStreamReader(client.getInputStream(),StandardCharsets.UTF_8));String request=in.readLine();if(request==null)return;String line;while((line=in.readLine())!=null&&!line.isEmpty()){}
                boolean script=request.startsWith("GET /bridge.js ");
                String html="<!doctype html><html style='--wz-base:#0f1014;--wz-text:#f4f0e8;--wz-accent:#b69fff;--wz-warning:#ffc15c'><title>Wizard OS</title><!-- core/ isolated fixture --><meta name='viewport' content='width=device-width,initial-scale=1'><body style='background:#0f1014;color:white;padding:100px 24px'><h1>Wizard ID isolated QA</h1><script>window.qaReplies={};</script><script src='/bridge.js'></script></body></html>";
                if(request.startsWith("GET /child "))html="<script>wizardDevicePort.onmessage=()=>parent.postMessage('native-reply',location.origin);wizardDevicePort.postMessage(JSON.stringify({v:1,id:'child',method:'identity.info',params:{}}));</script>";
                byte[] bytes=script?bridge:html.getBytes(StandardCharsets.UTF_8);OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: "+(script?"application/javascript":"text/html")+"\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));out.write(bytes);out.flush();}
        }
        @Override public void close()throws IOException{running=false;socket.close();}
    }
}
