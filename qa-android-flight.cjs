// Real Wizard APK/WebView flight loop on a disposable emulator; no external Wizard.
const {chromium}=require('./tools/qa-playwright.cjs'),{fixture}=require('./tools/offline-chats-fixture.cjs');
const {execFileSync,spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const adbBin=process.env.QA_ADB||'adb',app=process.env.QA_NATIVE_APP||'ai.wizards.os.qa';
const adb=(...args)=>execFileSync(adbBin,args,{encoding:'utf8',timeout:25000});
const out=process.env.QA_OUT||path.resolve('qa-live/android-flight');fs.mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(c,n)=>{assert(c,n);console.log('PASS '+n)};
const shot=n=>fs.writeFileSync(path.join(out,n+'.png'),execFileSync(adbBin,['exec-out','screencap','-p'],{timeout:20000}));
async function attach(){
 let last='',seen='';
 for(let n=0;n<90;n++){
  try{
   const pid=adb('shell','pidof',app).trim().split(' ')[0];
   if(!pid){last='app not running';await pause(500);continue;}
   adb('forward','tcp:9333','localabstract:webview_devtools_remote_'+pid);
   const list=await (await fetch('http://127.0.0.1:9333/json/list')).json();seen=JSON.stringify(list.map(x=>[x.type,x.url]));
   if(list.some(x=>x.url.includes('/wizard-os-home/'))){
    const b=await chromium.connectOverCDP('http://127.0.0.1:9333',{timeout:20000});
    const pages=b.contexts().flatMap(c=>c.pages());const p=pages.find(x=>x.url().includes('/wizard-os-home/'));
    if(p)return {b,p};last='playwright saw pages '+JSON.stringify(pages.map(x=>x.url()));await b.close().catch(()=>{});
   }else last='no shell target yet';
  }catch(e){last=String(e&&e.message||e).slice(0,400);}
  await pause(700);
 }
 try{shot('attach-failed');}catch(_){}
 try{fs.writeFileSync(path.join(out,'attach-debug.txt'),[last,seen,adb('shell','cat','/proc/net/unix').split('\n').filter(l=>l.includes('devtools')).join('\n')].join('\n\n'));}catch(_){}
 throw Error('Wizard WebView debugging target unavailable: '+last+' | targets '+seen);
}
async function list(p){await p.evaluate(()=>{let w=Object.values(__wos.wins).find(w=>w.app==='chats');if(w){if(w.thread)__wos.chats.threadBack(w);__wos.goDesk(__wos.desks.findIndex(d=>d.wins.includes(w.id)));}else __wos.openWin({app:'chats'});});await p.locator('[data-flight-download]').first().waitFor();}
(async()=>{
 const f=fixture(),origin=await f.start(9397);let browser;
 try{
  ok(app==='ai.wizards.os.qa','isolated QA APK package, not owner app');
  adb('reverse','tcp:9397','tcp:9397');adb('shell','am','force-stop',app);
  // Debug/QA builds read the fake Wizard address from files/qa_home.txt (AppState.qaOrigin), never the owner setting.
  adb('shell','run-as',app,'mkdir','-p','files');
  for(const f of ['qa_home.txt','qa_origin.txt'])execFileSync(adbBin,['exec-in','run-as',app,'tee','files/'+f],{input:'http://localhost:9397',timeout:15000});
  ok(adb('shell','run-as',app,'cat','files/qa_home.txt').trim()==='http://localhost:9397','QA app points only at the loopback fake Wizard');
  adb('shell','am','start','-n',app+'/ai.wizards.os.MainActivity');
  let {b,p}=await attach();browser=b;await p.waitForFunction(()=>window.__wos?.live?.ok,{},{timeout:60000});
  await p.evaluate(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1');});
  await list(p);await p.locator('[data-flight-download]').first().click();
  await p.waitForFunction(()=>document.querySelector('[data-flight-ready]')?.textContent.startsWith('Ready for flight'),{},{timeout:90000});
  shot('android-ready');ok(await p.evaluate(()=>!!navigator.serviceWorker.controller),'native WebView is controlled by the scoped offline worker');
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
  const back=spawnSync(process.execPath,['qa-android-back.cjs'],{cwd:__dirname,env:{...process.env,QA_CDP_URL:'http://127.0.0.1:9333',QA_NATIVE_APP:app},encoding:'utf8',timeout:60000});process.stdout.write(back.stdout);process.stderr.write(back.stderr);ok(back.status===0,'existing qa-android-back native branch passes');
  fs.writeFileSync(path.join(out,'android-result.json'),JSON.stringify({verdict:'PASS',package:app,actualApk:true,nativeChanges:false,reply:'typed (audio capture not exercised on emulator)',runs:f.state.runs.map(r=>({key:r.key,body:r.body})),origin:'disposable loopback fixture'},null,2));
 }finally{if(browser)await browser.close().catch(()=>{});try{adb('shell','cmd','connectivity','airplane-mode','disable')}catch(_){};await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
