// Real Wizard APK/WebView flight loop on a disposable emulator; no external Wizard.
const {fixture}=require('./tools/offline-chats-fixture.cjs');
const {execFileSync,spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const adbBin=process.env.QA_ADB||'adb',app=process.env.QA_NATIVE_APP||'ai.wizards.os.qa';
const adb=(...args)=>execFileSync(adbBin,args,{encoding:'utf8',timeout:25000});
const out=process.env.QA_OUT||path.resolve('qa-live/android-flight');fs.mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(c,n)=>{assert(c,n);console.log('PASS '+n)};
const shot=n=>fs.writeFileSync(path.join(out,n+'.png'),execFileSync(adbBin,['exec-out','screencap','-p'],{timeout:20000}));
// Android WebView rejects Playwright's connectOverCDP (Browser.setDownloadBehavior: "Browser context
// management is not supported"), so this test drives the page over its own CDP websocket.
let wvOrigin=null;
function webviewOrigin(){
 if(wvOrigin)return wvOrigin;let x='';
 try{adb('shell','uiautomator','dump','/data/local/tmp/wv.xml');x=adb('shell','cat','/data/local/tmp/wv.xml');}catch(e){console.log('uiautomator dump failed; assuming edge-to-edge WebView at 0,0');return wvOrigin={x:0,y:0};}
 const m=[...x.matchAll(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].map(m=>m.slice(1).map(Number)).sort((a,b)=>(b[2]-b[0])*(b[3]-b[1])-(a[2]-a[0])*(a[3]-a[1]))[0];
 if(!m){console.log('WebView bounds not in dump; assuming 0,0');return wvOrigin={x:0,y:0};}console.log('WebView origin',m[0],m[1]);return wvOrigin={x:m[0],y:m[1]};
}
function cdpPage(wsUrl){
 return new Promise((resolve,reject)=>{
  const ws=new WebSocket(wsUrl);let id=0;const waits=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.method==='Runtime.consoleAPICalled'||m.method==='Runtime.exceptionThrown'){try{fs.appendFileSync(path.join(out,'page-console.txt'),JSON.stringify(m.params.args?.map(a=>a.value??a.description)||m.params.exceptionDetails?.exception?.description||m.params)+'\n');}catch(_){}}if(m.id&&waits.has(m.id)){const w=waits.get(m.id);waits.delete(m.id);m.error?w.reject(Error(m.error.message)):w.resolve(m.result);}};
  ws.onerror=e=>reject(Error('CDP websocket error'));
  const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;const t=setTimeout(()=>{waits.delete(i);rej(Error('CDP '+method+' did not answer in 20 s'))},20000);waits.set(i,{resolve:v=>{clearTimeout(t);res(v)},reject:e=>{clearTimeout(t);rej(e)}});ws.send(JSON.stringify({id:i,method,params}));});
  let sendNow=send;
  // WebView swaps the page target when Wizard reloads during start-up; reconnect to the live target instead of waiting on a dead one.
  const reconnect=async()=>{try{ws.close();}catch(_){}const fresh=await attach();sendNow=fresh.p._send;};
  const evaluate=async(fn,arg)=>{const expr=typeof fn==='function'?`(${fn})(${JSON.stringify(arg===undefined?null:arg)})`:fn;
   let r;try{r=await sendNow('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});}
   catch(e){if(!/did not answer/.test(e.message))throw e;console.log('CDP stalled; reconnecting');await reconnect();r=await sendNow('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});}
   if(r.exceptionDetails)throw Error('page: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));return r.result.value;};
  const waitForFunction=async(fn,arg,opt={})=>{const end=Date.now()+(opt.timeout||30000);let last;
   for(;;){try{if(await evaluate(fn,arg))return;}catch(e){last=e;}if(Date.now()>end)throw Error('waitForFunction timed out: '+String(fn).slice(0,120)+(last?' ('+last.message+')':''));await pause(250);}};
  const loc=(sel,text)=>{const find=`(()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.getClientRects().length);return ${text==null?'els[0]':`els.find(e=>e.textContent.trim()===${JSON.stringify(text)})`}||null;})()`;
   const api={first:()=>api,
    waitFor:async(o={})=>waitForFunction(`!!${find}`,undefined,{timeout:o.timeout||30000}),
    click:async()=>{await api.waitFor();const r=await evaluate(`(()=>{const e=${find};e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2,dpr:devicePixelRatio};})()`);
     // A real Android tap (adb input) on the WebView's on-screen bounds: WebView never acknowledges CDP touch input.
     const o=webviewOrigin(),tx=Math.round(o.x+r.x*r.dpr),ty=Math.round(o.y+r.y*r.dpr);
     await evaluate(`(()=>{window.__taps=[];for(const t of ['pointerdown','pointerup','click','touchstart'])document.addEventListener(t,e=>__taps.push([t,(e.target.closest('[data-flight-download],button')||e.target).outerHTML.slice(0,80),Math.round(e.clientX||0),Math.round(e.clientY||0),e.defaultPrevented]),true);return 1;})()`);
     adb('shell','input','tap',String(tx),String(ty));await pause(600);
     const taps=await evaluate('JSON.stringify(window.__taps)');console.log('TAP',sel,JSON.stringify(r),tx,ty,taps,'flight busy/line:',await evaluate(`document.querySelector('[data-flight-ready]')?.textContent||''`));},
    fill:async v=>{await api.waitFor();await evaluate(`(()=>{const e=${find};e.focus();const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value');d.set.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);},
    innerText:async()=>{await api.waitFor();return evaluate(`${find}.innerText`);}};return api;};
  const page={_send:(...a)=>sendNow(...a),evaluate,waitForFunction,locator:sel=>loc(sel),getByText:t=>loc('button,a,div,span,p,h1,h2,h3,li,summary,label,b,[role]',t)};
  ws.onopen=async()=>{try{await send('Runtime.enable');resolve({b:{close:async()=>ws.close()},p:page});}catch(e){reject(e);}};
 });
}
async function attach(){
 await pause(4000);
 let last='',seen='';
 for(let n=0;n<90;n++){
  try{
   const pid=adb('shell','pidof',app).trim().split(' ')[0];
   if(!pid){last='app not running';await pause(500);continue;}
   adb('forward','tcp:9333','localabstract:webview_devtools_remote_'+pid);
   const list=await (await fetch('http://127.0.0.1:9333/json/list')).json();seen=JSON.stringify(list.map(x=>[x.type,x.url]));
   const t=list.find(x=>x.type==='page'&&x.url.includes('/wizard-os-home/'));
   if(t)return await cdpPage(t.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/,'ws://127.0.0.1:9333'));
   last='no shell target yet';
  }catch(e){last=String(e&&e.message||e).slice(0,400);}
  await pause(700);
 }
 try{shot('attach-failed');}catch(_){}
 try{fs.writeFileSync(path.join(out,'attach-debug.txt'),[last,seen].join('\n\n'));}catch(_){}
 throw Error('Wizard WebView debugging target unavailable: '+last+' | targets '+seen);
}
async function list(p){await p.evaluate(()=>{let w=Object.values(__wos.wins).find(w=>w.app==='chats');if(w){if(w.thread)__wos.chats.threadBack(w);__wos.goDesk(__wos.desks.findIndex(d=>d.wins.includes(w.id)));}else __wos.openWin({app:'chats'});});await p.locator('[data-flight-download]').first().waitFor();}
(async()=>{
 const f=fixture(),origin=await f.start(9397);let browser;
 try{
  ok(app==='ai.wizards.os.qa','isolated QA APK package, not owner app');
  adb('reverse','tcp:9397','tcp:9397');adb('shell','am','force-stop',app);
  // Debug/QA builds read the fake Wizard address from files/qa_home.txt (AppState.qaOrigin), never the owner setting.
  // Same proven route as tools/qa_background_audio.py: push, then copy inside run-as.
  fs.writeFileSync(path.join(out,'qaorigin'),'http://localhost:9397');execFileSync(adbBin,['push',path.join(out,'qaorigin'),'/data/local/tmp/qaorigin'],{timeout:20000});
  adb('shell','run-as',app,'sh','-c','"mkdir -p files && cp /data/local/tmp/qaorigin files/qa_home.txt && cp /data/local/tmp/qaorigin files/qa_origin.txt"');
  ok(adb('shell','run-as',app,'cat','files/qa_home.txt').trim()==='http://localhost:9397','QA app points only at the loopback fake Wizard');
  adb('shell','am','start','-n',app+'/ai.wizards.os.MainActivity');
  let {b,p}=await attach();browser=b;await p.waitForFunction(()=>window.__wos?.live?.ok,{},{timeout:60000});
  await p.evaluate(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');});
  // A fresh phone opens the first-run tour over Chats; skip it with a real tap, as a new owner would.
  if(await p.evaluate(()=>!!document.querySelector('[data-tskip],[data-dskip]')&&[...document.querySelectorAll('[data-tskip],[data-dskip]')].some(e=>e.getClientRects().length)))await p.locator('[data-tskip],[data-dskip]').first().click();
  await p.waitForFunction(()=>![...document.querySelectorAll('[data-tskip],[data-dskip]')].some(e=>e.getClientRects().length),{},{timeout:10000});shot('android-after-tour');
  await list(p);await p.locator('[data-flight-download]').first().click();
  try{await p.waitForFunction(()=>/^(Ready|Not ready) for flight/.test(document.querySelector('[data-flight-ready]')?.textContent||''),{},{timeout:240000});}
  catch(e){const st=await p.evaluate(()=>({line:document.querySelector('[data-flight-ready]')?.textContent,online:navigator.onLine,secure:isSecureContext,controller:!!navigator.serviceWorker?.controller,warm:!!window.WosShellOffline,href:location.href})).catch(x=>String(x));fs.writeFileSync(path.join(out,'ready-state.json'),JSON.stringify(st,null,2));shot('ready-timeout');throw Error(e.message+' state='+JSON.stringify(st));}
  const readyText=await p.evaluate(()=>document.querySelector('[data-flight-ready]').textContent);shot('android-ready');
  fs.writeFileSync(path.join(out,'ready-line.txt'),readyText);ok(readyText.startsWith('Ready for flight'),'native Download for flight: '+readyText);ok(await p.evaluate(()=>!!navigator.serviceWorker.controller),'native WebView is controlled by the scoped offline worker');
  await b.close();browser=null;
  // Real Android radio state plus a fixture which refuses every non-QA request.
  f.state.online=false;adb('shell','cmd','connectivity','airplane-mode','enable');adb('shell','svc','wifi','disable');
  adb('shell','am','force-stop',app);adb('shell','am','start','-n',app+'/ai.wizards.os.MainActivity');
  ({b,p}=await attach());browser=b;
  await p.waitForFunction(()=>window.__wos&&window.WosFlight,{},{timeout:30000});await list(p);
  await p.evaluate(()=>__wos.openWizardThread('flight-1'));await p.locator('.wos-flight-saved').first().waitFor();
  ok((await p.locator('.ch-msgs').first().innerText()).includes('Saved answer for flight-1'),'airplane-mode cold native launch reads a saved chat');
  shot('android-offline-thread');
  adb('shell','uiautomator','dump','/data/local/tmp/offline-chats.xml');adb('pull','/data/local/tmp/offline-chats.xml',path.join(out,'android-offline-thread.xml'));
  const xml=fs.readFileSync(path.join(out,'android-offline-thread.xml'),'utf8');
  ok(!/can[’']t reach|cannot reach|Connecting to your Wizard/i.test(xml),'native ReachScreen does not cover the offline shell');
  await p.locator('[data-chats] textarea').first().fill('Android typed reply recorded in airplane mode');
  await p.locator('[data-chats] .ch-compose button[type=submit]').first().click();
  await p.waitForFunction(()=>WosOutbox.unsent().some(it=>it.text.startsWith('Android typed')&&it.state==='held'&&it.durable));
  shot('android-offline-held');ok(f.state.runs.length===0,'native typed offline reply is held, never admitted');
  await b.close();browser=null;adb('shell','am','force-stop',app);adb('shell','am','start','-n',app+'/ai.wizards.os.MainActivity');
  ({b,p}=await attach());browser=b;await p.waitForFunction(()=>window.WosOutbox?.recoveryComplete);await list(p);
  ok(await p.evaluate(()=>WosOutbox.unsent().some(it=>it.text.startsWith('Android typed')&&it.state==='held')),'native held reply survives force-stop and offline reopen');
  f.state.online=true;adb('shell','cmd','connectivity','airplane-mode','disable');adb('shell','svc','wifi','enable');
  await p.evaluate(()=>WizLive.refresh(true));await p.waitForFunction(()=>!WosFlight.offline());await list(p);
  await p.getByText('1 reply recorded offline',{exact:true}).first().waitFor();shot('android-landing-tray');
  await p.locator('[data-flight-send]').first().click();await p.waitForFunction(()=>!WosOutbox.unsent().some(it=>it.text.startsWith('Android typed')));
  ok(f.state.runs.length===1&&f.state.runs[0].body.offline_context?.recordedOfflineAt,'native Send all admits one stamped typed reply');
  await b.close();browser=null;
  // Back never exits: open a saved thread, press the real Android Back key, stay in Wizard on the list.
  ({b,p}=await attach());browser=b;await list(p);// Open the thread the way the owner does (a real tap on its row), so Back has a real history step to undo.
  await p.evaluate(()=>{const c=Object.values(__wos.wins).find(w=>w.app==='chats');if(c?.thread)__wos.onBack();});await pause(1200);
  await p.locator('.ch-row[data-chopen="flight-1"]').first().click();
  await p.waitForFunction(()=>Object.values(__wos.wins).some(w=>w.app==='chats'&&w.thread));
  adb('shell','input','keyevent','KEYCODE_BACK');await pause(1500);
  ok(/ai\.wizards\.os\.qa/.test(adb('shell','dumpsys','activity','activities').split('\n').find(l=>/topResumedActivity|mResumedActivity/.test(l))||''),'native Back from a thread keeps Wizard open');
  const afterBack=await p.evaluate(()=>({thread:Object.values(__wos.wins).find(w=>w.app==='chats')?.thread||null,idx:__wos.idx,sheet:__wos.sheet,h:history.length}));shot('android-after-back');
  ok(!afterBack.thread,'native Back returns from the thread to the chat list '+JSON.stringify(afterBack));
  await b.close();browser=null;
  fs.writeFileSync(path.join(out,'android-result.json'),JSON.stringify({verdict:'PASS',package:app,actualApk:true,nativeChanges:false,reply:'typed (audio capture not exercised on emulator)',runs:f.state.runs.map(r=>({key:r.key,body:r.body})),origin:'disposable loopback fixture'},null,2));
 }finally{if(browser)await browser.close().catch(()=>{});try{adb('shell','cmd','connectivity','airplane-mode','disable')}catch(_){};await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
