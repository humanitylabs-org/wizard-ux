package ai.wizards.os;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * A disposable loopback "Wizard" for the hostile child-frame proof (wizard-os issue 387). Never an owner's server.
 *
 * /wizard-os-home/            the shell page: loads the REAL web/core/native-shell-port.js (androidTest assets), then
 *                             frames a hostile probe in every way a child can exist and collects what each child saw
 * /probe                      the hostile child: tries the old Java objects, every injected port, forged replies
 * /nest, /redirect            a nested child, and a child that arrives through a 302
 * http://127.0.0.1:port/probe the same page on another origin (localhost vs 127.0.0.1)
 * /not-shell                  a same-origin top-level page that is not the shell
 *
 * Results go to the page (#status) and to the WebView console (logcat tag chromium, lines starting PROBE / SHELL).
 */
final class HostileFrameFixture implements AutoCloseable {
    final ServerSocket socket = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
    private final String facade;
    volatile boolean running = true;

    HostileFrameFixture(String facadeSource) throws IOException {
        facade = facadeSource;
        new Thread(() -> { while (running) try { respond(socket.accept()); } catch (IOException ignored) {} }, "HostileFrameFixture").start();
    }

    String origin() { return "http://localhost:" + socket.getLocalPort(); }
    String crossOrigin() { return "http://127.0.0.1:" + socket.getLocalPort(); }

    static String readAsset(InputStream in) throws IOException {
        try (InputStream i = in) {
            java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[8192]; int n;
            while ((n = i.read(b)) > 0) o.write(b, 0, n);
            return o.toString("UTF-8");
        }
    }

    /** The hostile child: reports what it could see and whether anything native answered it. */
    static final String PROBE = "<!doctype html><meta charset=utf-8><script>(async()=>{"
        + "const name=(location.hash||'#'+(window.name||'unnamed')).slice(1)||'unnamed';"
        + "const r={frame:name,origin:String(self.origin),javaNative:typeof window.WizardOSNative,javaDevice:typeof window.WizardOSDevice,shellPort:typeof window.wizardShellPort,ports:[],replied:false,javaCall:'none'};"
        + "try{r.parentFacade=typeof parent.WizardOSNative;}catch(e){r.parentFacade='blocked';}"
        // The old all-frame Java objects: a direct call needs no message port at all.
        + "try{if(window.WizardOSNative){window.WizardOSNative.haptic(7);r.javaCall='haptic called';}}catch(e){r.javaCall='threw';}"
        + "try{if(window.WizardOSDevice){r.javaDeviceRead=String(window.WizardOSDevice.recPending()).slice(0,20);}}catch(e){r.javaDeviceRead='threw';}"
        + "const hit=n=>()=>{r.replied=true;r.repliedBy=(r.repliedBy||[]).concat(n);};"
        + "if(window.wizardShellPort){wizardShellPort.onmessage=hit('wizardShellPort');"
        +   "for(const m of [{v:1,id:'h',method:'hello'},{v:1,id:'x',target:'native',method:'haptic',args:[9]},"
        +     "{v:1,id:'y',target:'native',method:'openInBrowser',args:['https://example.com/hostile-child']},"
        +     "{v:1,id:'z',target:'device',method:'recPending',args:[]},{v:1,id:'ns-1-forged',target:'device',method:'micRoute',args:[]}])"
        +     "wizardShellPort.postMessage(JSON.stringify(m));}"
        + "for(const n of ['wizardDevicePort','wizardAppsPort','wizardMizelPort','wizardAudioPort','wizardPhotosPort','wizardScreenPort','wizardHomeScreenPort']){"
        +   "if(!window[n])continue;r.ports.push(n);try{window[n].onmessage=hit(n);"
        +   "window[n].postMessage(JSON.stringify({v:1,id:'p',method:'device.capabilities',params:{}}));"
        +   "window[n].postMessage(JSON.stringify({id:'q',method:'status',params:{}}));"
        +   "window[n].postMessage(JSON.stringify({id:'s',cmd:'status'}));"
        +   "window[n].postMessage(JSON.stringify({v:1,id:'a',appId:'wizard-music',method:'capabilities'}));"
        +   "window[n].postMessage('00112233445566778899aabbccddeeff');}catch(e){}}"
        + "await new Promise(res=>setTimeout(res,2500));"
        + "top.postMessage({probe:r},'*');"
        + "})();</script><p>probe</p>";

    private String shell(boolean probeOnly) {
        String cross = crossOrigin();
        return "<!doctype html><meta charset=utf-8><title>Wizard OS</title><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<body style='padding-top:120px;font:16px sans-serif'><p id='status'>Checking shell port</p><p id='detail'></p>"
            + "<script>window.__javaBefore=typeof window.WizardOSNative+'/'+typeof window.WizardOSDevice;"
            // Phase 2 (a new document after navigation) calls BEFORE the facade's handshake: native must refuse it.
            + "if(location.search.includes('phase=2')&&window.wizardShellPort){window.__early=false;wizardShellPort.addEventListener('message',e=>{try{if(JSON.parse(e.data).id==='early')window.__early=true;}catch(_){}});"
            + "wizardShellPort.postMessage(JSON.stringify({v:1,id:'early',target:'device',method:'micRoute',args:[]}));}</script>"
            + "<script src='/wizard-os-home/core/native-shell-port.js'></script>"
            + "<script>const show=(t,d)=>{document.getElementById('status').textContent=t;if(d)document.getElementById('detail').textContent=d;console.log('SHELL '+t+(d?' '+d:''));};"
            + "const want=['same-origin','srcdoc','about-blank','opaque-sandbox','nested-inner','redirected','cross-origin','opaque-srcdoc'];const got={};"
            + "window.addEventListener('message',e=>{const p=e.data&&e.data.probe;if(!p||got[p.frame])return;got[p.frame]=p;console.log('PROBE '+JSON.stringify(p));});"
            + "function frame(attrs){const f=document.createElement('iframe');Object.assign(f,attrs.props||{});for(const[k,v]of Object.entries(attrs.attr||{}))f.setAttribute(k,v);f.style.cssText='width:40px;height:40px';document.body.append(f);return f;}"
            + "const P=" + json(PROBE) + ";"
            + "function spawn(){"
            + "frame({props:{src:'/probe#same-origin'}});"
            + "frame({props:{srcdoc:P},attr:{name:'srcdoc'}});"
            + "const b=frame({props:{name:'about-blank'}});b.contentDocument.open();b.contentDocument.write(P);b.contentDocument.close();"
            + "frame({props:{src:'/probe#opaque-sandbox'},attr:{sandbox:'allow-scripts'}});"
            + "frame({props:{srcdoc:P},attr:{sandbox:'allow-scripts',name:'opaque-srcdoc'}});"
            + "frame({props:{src:'/nest'}});"
            + "frame({props:{src:'/redirect'}});"
            + "frame({props:{src:'" + cross + "/probe#cross-origin'}});}"
            + "async function collect(){const end=Date.now()+15000;while(Date.now()<end&&want.some(w=>!got[w]))await new Promise(r=>setTimeout(r,250));return want.filter(w=>!got[w]);}"
            + (probeOnly
                ? "(async()=>{console.log('SHELL java-before '+window.__javaBefore);spawn();const miss=await collect();show('Probe complete',miss.length?'missing '+miss.join(','):'all frames reported');})();"
                : "async function main(){"
                + "if(window.__javaBefore!=='undefined/undefined')throw Error('Java object present before the facade: '+window.__javaBefore);"
                + "const ok=await WosNativeShell.ready;if(!ok||WosNativeShell.status!=='ok')throw Error('handshake '+WosNativeShell.status);"
                // Positive shell flows over the port: cached reads, a fresh round-trip, actions.
                + "if(!String(WizardOSNative.platform()).startsWith('android:'))throw Error('platform');"
                + "JSON.parse(WizardOSNative.sideButton());JSON.parse(WizardOSNative.everywhere());JSON.parse(WizardOSNative.unsent());"
                + "if(WizardOSDevice.recActive()!=='null')throw Error('recActive');if(WizardOSDevice.version()!==1)throw Error('version');"
                + "const route=await WizardOSDevice.micRoute();if(typeof route!=='string')throw Error('micRoute');"
                + "const match=await WizardOSNative.usualsMatch('nothing like this');if(match!=='')throw Error('usualsMatch');"
                + "if(WizardOSNative.haptic(5)!==undefined)throw Error('haptic');WizardOSNative.keepAwake(true);WizardOSNative.keepAwake(false);"
                + "if(WosNativeShell.safeForAppFrames()!==true)throw Error('gate');"
                + "spawn();const miss=await collect();if(miss.length)throw Error('no report from '+miss.join(','));"
                + "for(const p of Object.values(got)){"
                +   "if(p.javaNative!=='undefined'||p.javaDevice!=='undefined')throw Error(p.frame+' sees a Java object');"
                +   "if(p.replied)throw Error(p.frame+' got a native reply from '+p.repliedBy);"
                +   "if(p.frame.startsWith('opaque')||p.frame==='cross-origin'){if(p.shellPort!=='undefined'||p.ports.length)throw Error(p.frame+' was given a port');}}"
                // The facade itself refuses to install in a child (same-origin children only have the bare port).
                + "if(got['same-origin'].shellPort!=='object')throw Error('fixture: same-origin child should see the bare port');"
                + "show('Shell port verified',Object.keys(got).length+' hostile frames, no native reply');"
                + "document.getElementById('detail').insertAdjacentHTML('afterend',\"<button onclick=\\\"location.href='/wizard-os-home/?phase=2'\\\">Check new document</button> <button onclick=\\\"location.href='/not-shell'\\\">Check wrong path</button>\");}"
                + "async function phase2(){"
                // A new document that skips the handshake: native refuses (no binding for this generation).
                + "await new Promise(r=>setTimeout(r,1500));if(window.__early!==false)throw Error('unbound document got a reply or sent nothing');"
                + "const ok=await WosNativeShell.ready;if(!ok)throw Error('handshake after navigation');"
                + "const route=await WizardOSDevice.micRoute();if(typeof route!=='string')throw Error('micRoute after navigation');"
                + "show('New document verified','unbound call refused, handshake then call answered');"
                + "document.getElementById('detail').insertAdjacentHTML('afterend',\"<button onclick=\\\"location.href='/not-shell'\\\">Check wrong path</button>\");}"
                + "(location.search.includes('phase=2')?phase2():main()).catch(e=>show('FAILED',e.message));")
            + "</script>";
    }

    private static final String NOT_SHELL = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>"
        + "<body style='padding-top:120px'><p id='status'>Checking wrong path</p><script>"
        + "let replied=false;const p=window.wizardShellPort;if(p){p.onmessage=()=>{replied=true;};"
        + "p.postMessage(JSON.stringify({v:1,id:'h',method:'hello'}));p.postMessage(JSON.stringify({v:1,id:'x',target:'native',method:'haptic',args:[9]}));}"
        + "setTimeout(()=>{const t=!p?'FAILED no port on same-origin page':replied?'FAILED native reply':'Wrong path refused';document.getElementById('status').textContent=t;console.log('SHELL '+t);},2000);"
        + "</script>";

    private static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '<') b.append("\\u003c");
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    volatile boolean probeOnly;

    private void respond(Socket s) throws IOException {
        try (Socket client = s) {
            client.setSoTimeout(3000);
            BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8));
            String request = in.readLine(); if (request == null) return;
            String header; while ((header = in.readLine()) != null && !header.isEmpty()) { }
            String path = request.split(" ").length > 1 ? request.split(" ")[1] : "/";
            String type = "text/html", body, extra = "";
            int status = 200;
            if (path.startsWith("/wizard-os-home/core/native-shell-port.js")) { type = "text/javascript"; body = facade == null ? "" : facade; if (facade == null) status = 404; }
            else if (path.startsWith("/wizard-os-home/")) body = shell(probeOnly);
            else if (path.startsWith("/probe")) body = PROBE;
            else if (path.startsWith("/nest")) body = "<!doctype html><iframe src='/probe#nested-inner'></iframe>";
            else if (path.startsWith("/redirect")) { status = 302; extra = "Location: /probe#redirected\r\n"; body = ""; }
            else if (path.startsWith("/not-shell")) body = NOT_SHELL;
            else body = "{}";
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            OutputStream out = client.getOutputStream();
            out.write(("HTTP/1.1 " + status + (status == 302 ? " Found" : status == 404 ? " Not Found" : " OK") + "\r\nContent-Type: " + type
                    + "; charset=utf-8\r\nCache-Control: no-store\r\n" + extra + "Content-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            out.write(bytes); out.flush();
        }
    }

    @Override public void close() throws IOException { running = false; socket.close(); }
}
