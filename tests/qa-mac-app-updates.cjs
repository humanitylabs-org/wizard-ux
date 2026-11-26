'use strict';
// Wizard for Mac in Settings › About & updates (wizard-ux issue 1624, switch wizard/mac-app-updates; native half
// humanitylabs-org/try-wizard#126). Real desktop and phone shells on a synthetic origin. Wizard for Mac is stood in
// by a fake `window.webkit.messageHandlers.wizardNative` that answers updates.status / check / install / download
// the way the app does and pushes `wizard:app-update` events; the WizardOS status is a plain up-to-date box.
//  1. Up to date: version + build, "Up to date · checked 5 min ago", Check for updates goes Checking… and back.
//  2. A newer build: Downloading with a rising percentage, then "is ready" + Update and restart (updates.install);
//     a refusal ({started:false, reason}) is a toast and the card stays; ready while recording: no button.
//  3. Needs a new download: Download calls updates.download.  4. Failed: the app's words + Try again.
//  5. A browser, the phone, and a Mac app without updates.*: no group, no errors, WizardOS group unchanged.
//  6. Switch off inside the Mac app: no updates.* call, and the About page is byte-identical to QA_WEB_MAIN's.
//  7. An event that changes nothing rewrites nothing (no blink).
// QA_OUT=<dir> saves screenshots (the About page, 412 px wide in a 912 px desktop window like the Mac's Settings). QA_WEB=<checkout>/web points at another build;
// QA_WEB_MAIN=<main>/web enables the byte-identical switch-off check. QA_EXPECT=broken: run against a build without
// the feature and assert the group is missing everywhere.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.env.QA_WEB||path.join(__dirname,'../web')),origin='https://mac-app-updates.test',prefix='/wizard-os-home/';
const mainRoot=process.env.QA_WEB_MAIN?path.resolve(process.env.QA_WEB_MAIN):'',broken=process.env.QA_EXPECT==='broken';
const out=process.env.QA_OUT||'';if(out)fs.mkdirSync(out,{recursive:true});
const SW='wizard/mac-app-updates';
const type=f=>f.endsWith('.js')||f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':f.endsWith('.json')?'application/json':f.endsWith('.svg')?'image/svg+xml':'application/octet-stream';
const OS={mode:'ask',chosen:true,channel:'latest',installed:'0.3.242',latest:'0.3.242',stable:'0.3.240',update_available:false,unpinned:false,checked:true,installing:false,interrupted:false};
const MIN=60e3;
const st=(phase,extra={})=>({schema:1,installed:{version:'0.8.1',build:'312'},phase,latest:null,progress:null,checkedAt:null,waitingFor:null,manual:null,error:null,channel:null,...extra});
async function boot(browser,{shell='desktop',w=1280,h=800,mac=true,legacy=false,on=true,web=root}){
 const phone=shell==='phone';
 const ctx=await browser.newContext({viewport:{width:w,height:h},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
 await ctx.routeWebSocket('**/*',ws=>ws.close());
 const mix=on?{[SW]:true}:{};
 await ctx.addInitScript(({shell,mix,mac,legacy})=>{
  if(window!==window.top)return;
  for(const[k,v]of Object.entries({'wos.shell':shell,'wux.shell':shell,'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.desktop-view.v1':'classic','wos.channel.v1':'latest','wos.skin-tweaks.v1':JSON.stringify({version:1,preset:'none',off:{},mix})}))localStorage.setItem(k,v);
  if(!mac)return;
  // The Mac app: replies come back through window.wizardNativeReply, like WKWebView's evaluateJavaScript.
  window.__mauCalls=[];window.__mauStatus=null;window.__mauNext={};
  const reply=(id,result,error)=>setTimeout(()=>window.wizardNativeReply?.(error?{id,error}:{id,result}),30);
  const push=d=>{window.__mauStatus=d;window.dispatchEvent(new CustomEvent('wizard:app-update',{detail:d}));};
  window.__mauPush=push;
  window.webkit={messageHandlers:{wizardNative:{postMessage(m){
   const {id,method}=m||{};window.__mauCalls.push(method);
   if(!String(method).startsWith('updates.'))return reply(id,null,'unknown method');
   if(legacy)return reply(id,null,'unknown method: '+method);
   if(method==='updates.status')return reply(id,window.__mauStatus);
   if(method==='updates.check'){const cur=window.__mauStatus;const checking={...cur,phase:'checking'};window.__mauStatus=checking;reply(id,checking);setTimeout(()=>push({...cur,phase:'current',checkedAt:Date.now()}),1200);return;}
   if(method==='updates.install'){const a=window.__mauNext.install||{started:true};reply(id,a);if(a.started)setTimeout(()=>push({...window.__mauStatus,phase:'installing'}),200);return;}
   if(method==='updates.download')return reply(id,{opened:true});
   reply(id,null,'unknown');
  }}}};
 },{shell,mix,mac,legacy});
 const errors=[];
 await ctx.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url()),p=u.pathname;
  if(u.origin!==origin)return r.abort();
  if(p===prefix+'store-install/_updates')return r.fulfill({json:OS});
  if(!['GET','HEAD'].includes(q.method()))return r.fulfill({status:405,json:{error:'refused by test'}});
  if(p.startsWith(prefix)){const f=path.resolve(web,p.slice(prefix.length)||'index.html');if(f.startsWith(web+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({contentType:type(f),body:fs.readFileSync(f)});}
  if(p==='/wizard/hermes/api/model/options')return r.fulfill({status:404,json:{error:'not in this test'}});
  if(p==='/wizard/v1/ui-preferences')return r.fulfill({json:{launcher:{},migrations:{'launcher-seed-v1':true}}});
  if(p.endsWith('/v1/setup'))return r.fulfill({json:{first_run:false}});
  if(p.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
  if(p.includes('/store-data/api/apps/installed'))return r.fulfill({json:{installed:[]}});
  return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
 });
 const pg=await ctx.newPage();
 pg.on('pageerror',e=>errors.push('pageerror: '+e.message));
 pg.on('console',m=>{if(m.type()==='error'&&/mac|updates\.|app-update|os-updates/i.test(m.text()))errors.push('console: '+m.text());});
 return {ctx,pg,errors};
}
async function start(pg,phone,status){
 if(status)await pg.addInitScript(s=>{if(window.__mauCalls)window.__mauStatus=s;},status);
 await pg.goto(origin+prefix+(phone?'':'desktop.html'));
 await pg.waitForFunction(()=>window.WosSettings&&window.WosUpdates&&(window.__wos||window.__wux));
 await pg.evaluate(()=>document.getElementById('wosWelcome')?.remove());
 if(!broken)await pg.waitForFunction(sw=>(document.documentElement.dataset.tweaks||'').split(' ').includes(sw)||!JSON.parse(localStorage.getItem('wos.skin-tweaks.v1')||'{}').mix?.[sw],SW,{timeout:15000});
 await pg.evaluate(()=>(window.__wos?.openSettings||window.__wux?.openSettings)('updates'));
 await pg.waitForFunction(()=>[...document.querySelectorAll('[data-settings-feature="updates"] [data-osu-group]')].some(n=>n.getClientRects().length),null,{timeout:15000});
 await pg.waitForTimeout(700);
}
const group=pg=>pg.evaluate(()=>{const g=[...document.querySelectorAll('[data-mau-group]')].find(n=>n.getClientRects().length);if(!g)return null;
 const sec=[...g.closest('.st-page').querySelectorAll(':scope > section[data-settings-feature]')].map(s=>s.dataset.settingsFeature);
 return {text:g.innerText.replace(/\s+/g,' ').trim(),phase:g.dataset.mauPhase,buttons:[...g.querySelectorAll('button')].map(b=>({t:b.textContent,dis:b.disabled,k:b.dataset.mau})),order:sec};});
const osGroup=pg=>pg.evaluate(()=>[...document.querySelectorAll('[data-settings-feature="updates"] [data-osu-group]')].find(n=>n.getClientRects().length)?.innerText.replace(/\s+/g,' ').trim());
async function shot(pg,name){
 if(!out)return;
 // Settings rewrites its markup on a change, so clip the page's box instead of holding an element. The Apps list sits
 // at the top, so the Wizard for Mac group (under it) is in the shot; the page is 412 px wide at a 912 px window.
 await pg.waitForTimeout(250);
 await pg.evaluate(()=>{const p=[...document.querySelectorAll('.st-page')].find(n=>n.getClientRects().length),a=p?.querySelector('[data-osu-apps]');if(p&&a)p.scrollTop+=a.getBoundingClientRect().top-p.getBoundingClientRect().top-60;});
 await pg.waitForTimeout(100);
 const box=await pg.evaluate(()=>{const p=[...document.querySelectorAll('.st-page')].find(n=>n.getClientRects().length);const r=p.getBoundingClientRect();return {x:r.x,y:r.y,width:Math.min(r.width,412),height:Math.min(r.height,innerHeight-r.y)};});
 await pg.screenshot({path:path.join(out,name),clip:box});
}
const until=async(pg,fn,label,ms=8000)=>{const t=Date.now();let g;while(Date.now()-t<ms){g=await group(pg);if(fn(g))return g;await pg.waitForTimeout(150);}throw new Error(`${label}: ${JSON.stringify(g)}`);};
(async()=>{
 const browser=await chromium.launch({headless:true});const results=[];
 try{
  const MAC={shell:'desktop',w:+(process.env.QA_W||912),h:800};
  if(broken){
   const {ctx,pg,errors}=await boot(browser,MAC);await start(pg,false,st('ready',{latest:{version:'0.8.2',build:'313'}}));
   assert.equal(await group(pg),null,'a build without the feature has no Wizard for Mac group');
   await shot(pg,'mac-app-updates-before.png');results.push({check:'broken: no group'});await ctx.close();
   console.log(JSON.stringify(results,null,1));return;
  }
  // 1. Up to date, Check for updates.
  {
   const {ctx,pg,errors}=await boot(browser,MAC);await start(pg,false,st('current',{checkedAt:Date.now()-5*MIN}));
   let g=await until(pg,x=>x,'group shows');
   if(process.env.QA_PROBE){console.log(JSON.stringify(await pg.evaluate(()=>{const p=[...document.querySelectorAll('.st-page')].find(n=>n.getClientRects().length);return p.getBoundingClientRect();})));process.exit(0);}
   assert.match(g.text,/Wizard for Mac 0\.8\.1 \(312\)/);assert.match(g.text,/Up to date · checked 5 min ago/);
   assert.match(g.text,/looks for a new version every hour and downloads it by itself\. It restarts only when you say so, never while you’re recording\./);
   assert.deepEqual(g.buttons,[{t:'Check for updates',dis:false,k:'check'}]);
   assert.deepEqual(g.order.slice(0,2),['updates','mac-app-updates'],'right under WizardOS');
   await shot(pg,'mac-app-updates-current.png');
   await pg.locator('[data-mau-group] [data-mau="check"]:visible').click();
   g=await until(pg,x=>x&&/Checking…/.test(x.text),'Checking…',3000);
   assert.deepEqual(g.buttons,[{t:'Checking…',dis:true,k:'check'}]);
   await shot(pg,'mac-app-updates-checking.png');
   g=await until(pg,x=>x&&/Up to date · checked just now/.test(x.text),'back to up to date');
   assert.ok((await pg.evaluate(()=>window.__mauCalls)).includes('updates.check'));
   assert.deepEqual(errors,[]);results.push({check:'current+check',text:g.text});
   // 7. No blink: the same status again rewrites nothing.
   const muts=await pg.evaluate(async()=>{const r=[...document.querySelectorAll('.st-root')].find(x=>x.querySelector('[data-mau-group]'));let n=0;window.__muts=[];const o=new MutationObserver(l=>{for(const m of l){if(m.type==='attributes'&&m.oldValue===m.target.getAttribute(m.attributeName))continue;n++;window.__muts.push(m.type+' '+(m.target.className||m.target.nodeName)+' '+(m.attributeName||'')+' '+[...m.addedNodes].map(x=>x.className||x.nodeName).join(','));}});o.observe(r,{subtree:true,childList:true,attributes:true,attributeOldValue:true,characterData:true});for(let i=0;i<5;i++){window.__mauPush({...window.__mauStatus});await new Promise(ok=>setTimeout(ok,120));}o.disconnect();return n;});
   assert.equal(muts,0,'an unchanged status leaves Settings alone '+JSON.stringify(await pg.evaluate(()=>window.__muts)));results.push({check:'no blink',mutations:muts});
   await ctx.close();
  }
  // 2. Downloading → ready → Update and restart; refusal toast; waiting for a recording.
  {
   const {ctx,pg,errors}=await boot(browser,MAC);const latest={version:'0.8.2',build:'313'};
   await start(pg,false,st('downloading',{latest,progress:0.12}));
   let g=await until(pg,x=>x&&/Downloading · 12%/.test(x.text),'downloading 12');
   await pg.evaluate(l=>window.__mauPush({...window.__mauStatus,progress:0.42,latest:l}),latest);
   g=await until(pg,x=>x&&/Downloading · 42%\. It installs only when you say so\./.test(x.text),'downloading 42');
   assert.match(g.text,/^Wizard for Mac 0\.8\.2 Downloading · 42%/);assert.match(g.text,/Wizard for Mac 0\.8\.1 \(312\) Installed on this Mac/);
   assert.deepEqual(g.buttons,[],'no button while downloading');
   await shot(pg,'mac-app-updates-downloading.png');
   await pg.evaluate(()=>window.__mauPush({...window.__mauStatus,phase:'ready',progress:null}));
   g=await until(pg,x=>x&&/is ready/.test(x.text),'ready');
   assert.match(g.text,/Wizard for Mac 0\.8\.2 is ready Restart to finish\. Takes about a minute; chats, files and apps stay as they are\./);
   assert.deepEqual(g.buttons,[{t:'Update and restart',dis:false,k:'install'}]);
   await shot(pg,'mac-app-updates-ready.png');
   await pg.evaluate(()=>{window.__mauNext.install={started:false,reason:'Recording is on. Update after it ends.'};});
   await pg.locator('[data-mau-group] [data-mau="install"]:visible').click();
   await pg.waitForFunction(()=>/Recording is on\. Update after it ends\./.test(document.body.innerText),null,{timeout:5000});
   g=await until(pg,x=>x&&x.buttons[0]?.dis===false&&/is ready/.test(x.text),'card stays after a refusal');
   await pg.evaluate(()=>window.__mauPush({...window.__mauStatus,waitingFor:'recording'}));
   g=await until(pg,x=>x&&/once the recording ends/.test(x.text),'waiting for recording');
   assert.deepEqual(g.buttons,[],'a card never keeps a disabled button');
   await shot(pg,'mac-app-updates-ready-recording.png');
   await pg.evaluate(()=>window.__mauPush({...window.__mauStatus,waitingFor:'work'}));
   g=await until(pg,x=>x&&/once Wizard finishes what it’s working on/.test(x.text),'waiting for work');
   await pg.evaluate(()=>{window.__mauNext.install={started:true};window.__mauPush({...window.__mauStatus,waitingFor:null});});
   await until(pg,x=>x&&x.buttons.length===1,'button back');
   await pg.locator('[data-mau-group] [data-mau="install"]:visible').click();
   g=await until(pg,x=>x&&/Updating Wizard for Mac Wizard restarts in a moment\./.test(x.text),'installing');
   const calls=await pg.evaluate(()=>window.__mauCalls);
   assert.equal(calls.filter(c=>c==='updates.install').length,2);
   await shot(pg,'mac-app-updates-installing.png');
   assert.deepEqual(errors,[]);results.push({check:'download→ready→install',calls});await ctx.close();
  }
  // 3. Needs a new download; 4. failed.
  {
   const {ctx,pg,errors}=await boot(browser,MAC);
   await start(pg,false,st('manual',{latest:{version:'0.9.0',build:'400'},manual:{url:'https://www.aiwizards.com/downloads'}}));
   let g=await until(pg,x=>x&&/needs a new download/.test(x.text),'manual');
   assert.match(g.text,/Wizard for Mac 0\.9\.0 needs a new download This version can’t install itself\. Download it and drag it to Applications\. Your Wizard, chats and files stay\./);
   assert.deepEqual(g.buttons,[{t:'Download',dis:false,k:'download'}]);
   await shot(pg,'mac-app-updates-manual.png');
   await pg.locator('[data-mau-group] [data-mau="download"]:visible').click();await pg.waitForTimeout(300);
   assert.ok((await pg.evaluate(()=>window.__mauCalls)).includes('updates.download'));
   // A page that isn't Wizard's: nothing opens.
   await pg.evaluate(()=>{window.__mauCalls.length=0;window.__mauPush({...window.__mauStatus,manual:{url:'https://evil.example/x.dmg'}});});
   await pg.waitForTimeout(200);await pg.locator('[data-mau-group] [data-mau="download"]:visible').click();await pg.waitForTimeout(300);
   assert.ok(!(await pg.evaluate(()=>window.__mauCalls)).includes('updates.download'),'only aiwizards.com download pages');
   await pg.evaluate(()=>window.__mauPush({...window.__mauStatus,phase:'failed',manual:null,error:'The update couldn’t be checked: the network is offline.'}));
   g=await until(pg,x=>x&&/Couldn’t update Wizard for Mac/.test(x.text),'failed');
   assert.match(g.text,/the network is offline\./);assert.deepEqual(g.buttons,[{t:'Try again',dis:false,k:'check'}]);
   await shot(pg,'mac-app-updates-failed.png');
   await pg.evaluate(()=>window.__mauPush({...window.__mauStatus,error:null}));
   g=await until(pg,x=>x&&/The version you have keeps working\./.test(x.text),'failed default words');
   await pg.evaluate(()=>{window.__mauCalls.length=0;});
   await pg.locator('[data-mau-group] [data-mau="check"]:visible').click();await pg.waitForTimeout(300);
   assert.ok((await pg.evaluate(()=>window.__mauCalls)).includes('updates.check'));
   assert.deepEqual(errors,[]);results.push({check:'manual+failed'});await ctx.close();
  }
  // 5. Browser, phone, old Mac app: no group, no errors, WizardOS unchanged.
  let refOs='';
  for(const v of [{label:'browser',shell:'desktop',w:1280,h:800,mac:false},{label:'phone',shell:'phone',w:412,h:915,mac:false},{label:'old Mac app',shell:'desktop',w:1280,h:800,legacy:true}]){
   const {ctx,pg,errors}=await boot(browser,v);await start(pg,v.shell==='phone',st('ready',{latest:{version:'0.8.2',build:'313'}}));
   await pg.waitForTimeout(800);
   assert.equal(await group(pg),null,`${v.label}: no Wizard for Mac group`);
   const os=await osGroup(pg);assert.match(os,/WizardOS \(server\) 0\.3\.242 Up to date/);
   if(v.shell==='desktop'){if(!refOs)refOs=os;assert.equal(os,refOs,`${v.label}: WizardOS group unchanged`);}
   assert.deepEqual(errors,[],`${v.label}: no errors`);
   if(v.label==='old Mac app')assert.ok((await pg.evaluate(()=>window.__mauCalls)).includes('updates.status'),'old Mac app was asked once');
   results.push({check:`${v.label}: no group`});await ctx.close();
  }
  // 6. Switch off inside the Mac app: no updates.* calls; About identical to main.
  {
   const about=async web=>{const {ctx,pg,errors}=await boot(browser,{...MAC,on:false,web});await start(pg,false,st('ready',{latest:{version:'0.8.2',build:'313'}}));await pg.waitForTimeout(800);
    const r={g:await group(pg),calls:await pg.evaluate(()=>window.__mauCalls.filter(c=>c.startsWith('updates.'))),html:await pg.evaluate(()=>[...document.querySelectorAll('.st-page')].find(n=>n.getClientRects().length)?.innerHTML||'')};
    if(web===root)await shot(pg,'mac-app-updates-off.png');assert.deepEqual(errors,[]);await ctx.close();return r;};
   const off=await about(root);
   assert.equal(off.g,null,'switch off: no group');assert.deepEqual(off.calls,[],'switch off: the Mac app is never asked');
   if(mainRoot){const m=await about(mainRoot);assert.equal(off.html,m.html,'switch off: About is byte-identical to main');results.push({check:'switch off = main',bytes:off.html.length});}
   else results.push({check:'switch off: no group, no calls'});
  }
  console.log(JSON.stringify(results,null,1));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
