// offline chats flight loop — real service worker + IDB, disposable Wizard only.
const {chromium}=require('./tools/qa-playwright.cjs');
const {fixture}=require('./tools/offline-chats-fixture.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=process.env.QA_OUT||path.resolve('qa-live/offline-chats');fs.mkdirSync(out,{recursive:true});
const ok=(c,name)=>{assert(c,name);console.log('PASS '+name);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function openList(p){await p.evaluate(()=>{const current=Object.values(__wos.wins).find(w=>w.app==='chats');if(current){if(current.thread)__wos.chats.threadBack(current);__wos.goDesk(__wos.desks.findIndex(d=>d.wins.includes(current.id)));__wos.focusWin(current.id);}else __wos.openWin({app:'chats'});});await p.locator('[data-flight-download]').first().waitFor();}
async function openThread(p,id){await p.evaluate(id=>__wos.openWizardThread(id),id);await p.locator('[data-part="thread"]').first().waitFor();}
async function boot(p,url){await p.goto(url+'/wizard-os-home/',{waitUntil:'load'});await p.waitForFunction(()=>window.__wos&&window.WosFlight&&window.WosOutbox);await p.evaluate(()=>WosFlight.ready);}
(async()=>{
 const f=fixture(process.env.QA_TREE||__dirname),origin=await f.start();let browser;
 try{
 browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const skin of ['nebula','grove']){
  const context=await browser.newContext({viewport:{width:412,height:892},hasTouch:true,isMobile:true,colorScheme:'dark',serviceWorkers:'allow'});
  await context.addInitScript(skin=>{localStorage.setItem('wos.skin',skin);localStorage.setItem('wos.tour.done','1');localStorage.setItem('wos.coached','true');localStorage.setItem('wos.rvCoached','true');},skin);
  let p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await boot(p,origin);await p.waitForFunction(()=>WizLive.ok&&!WizLive.cached);await openThread(p,'recent-older');await p.waitForFunction(()=>document.querySelector('.ch-msgs')?.textContent.includes('Saved answer'));await openList(p);
  await p.evaluate(async()=>{const c=await caches.open('foreign-offline-sentinel');await c.put('/sentinel',new Response('sibling-safe'));});
  await p.locator('[data-flight-download]').first().click();
  await p.waitForFunction(()=>document.querySelector('[data-flight-ready]')?.textContent.startsWith('Ready for flight'),null,{timeout:90000});
  const ready=await p.locator('[data-flight-ready]').first().innerText();
  ok(/5 threads/.test(ready),skin+' Download for flight confirms Ready plus recently opened archived main thread');
  await p.screenshot({path:path.join(out,skin+'-ready.png')});
  // A partial refresh must refuse readiness; the prior committed flight stays intact.
  await context.route('**/wizard/hermes/api/sessions/flight-4/messages?*',r=>r.fulfill({status:503,json:{error:'Fixture read unavailable'}}));
  await p.locator('[data-flight-download]').first().click();
  await p.waitForFunction(()=>document.querySelector('[data-flight-ready]')?.textContent.startsWith('Not ready for flight'));
  ok((await p.locator('[data-flight-ready]').first().innerText()).includes('did not save'),skin+' partial download fails loudly with the unsaved thread');
  await context.unroute('**/wizard/hermes/api/sessions/flight-4/messages?*');
  await p.locator('[data-flight-download]').first().click();
  await p.waitForFunction(()=>document.querySelector('[data-flight-ready]')?.textContent.startsWith('Ready for flight'),null,{timeout:90000});
  ok(await p.evaluate(async()=>{const c=await caches.open('foreign-offline-sentinel');return await(await c.match('/sentinel')).text()==='sibling-safe'}),skin+' own worker preserves foreign cache');
  ok(!f.state.messagesReads.includes('private-thread'),skin+' private bodies were never requested for download');
  const stored=await p.evaluate(async()=>{const r=indexedDB.open('wos-chats-flight-v1');return new Promise((res,rej)=>{r.onerror=rej;r.onsuccess=()=>{const q=r.result.transaction('rows').objectStore('rows').getAll();q.onsuccess=()=>res(q.result);};});});
  ok(stored.length===5&&stored.some(r=>r.title==='Recently opened older chat')&&!JSON.stringify(stored).includes('PRIVATE_BODY')&&!JSON.stringify(stored).includes('/wizard/attachments'),skin+' text-only keyed IDB contains no private bodies or media URLs');
  // Route-abort ALL requests, including service-worker-origin requests, plus a dead fixture.
  f.state.online=false;await context.route('**/*',r=>r.abort('internetdisconnected'));
  await p.reload({waitUntil:'load'});await p.waitForFunction(()=>window.__wos&&window.WosFlight);await p.evaluate(()=>WosFlight.connection(false));await openList(p);
  ok(await p.locator('[data-chopen]').count()>0,skin+' offline reload renders Chats snapshot');
  for(const id of ['flight-1','flight-2','flight-3']){
    await openThread(p,id);await p.locator('.wos-flight-saved').first().waitFor();
    ok(/Saved \d\d:\d\d · offline/.test(await p.locator('.wos-flight-saved').first().innerText()),skin+' '+id+' saved offline banner');
    ok((await p.locator('.ch-msgs').first().innerText()).includes('Saved answer for '+id),skin+' '+id+' saved messages render');
    if(id==='flight-1')await p.screenshot({path:path.join(out,skin+'-offline-thread.png')});
    await p.locator('[data-chback]').first().click();await p.locator('[data-flight-download]').first().waitFor();
  }
  ok(p.url().includes('/wizard-os-home/')&&!await p.evaluate(()=>__wos.back.exitArmed),skin+' nested Back stays in Wizard and returns to list');
  await openThread(p,'unsaved');await p.getByText('Not saved for offline',{exact:false}).first().waitFor();
  ok((await p.locator('.ch-msgs').first().innerText()).includes('Not saved for offline'),skin+' unsaved thread says not saved');
  await openThread(p,'flight-1');await p.locator('.wos-flight-saved').first().waitFor();
  await p.locator('[data-chats] textarea').first().fill('Typed flight reply');
  await p.locator('[data-chats] .ch-compose button[type=submit]').first().click();
  await p.waitForFunction(()=>WosOutbox.unsent().some(it=>it.text==='Typed flight reply'&&it.state==='held'));
  const ids=await p.evaluate(async()=>{const ids=[];for(const sid of ['flight-2','flight-3']){const it=await WosOutbox.enqueue({kind:'reply',sessionId:sid,model:'qa-model',provider:'qa-provider',audio:new Blob(['synthetic original recording'],{type:'audio/webm'})});ids.push(it.id);}return ids;});
  ok(await p.evaluate(()=>WosOutbox.unsent().filter(it=>it.offlineContext&&it.state==='held'&&it.durable).length===3),skin+' typed and two voice replies held durably');
  await p.reload({waitUntil:'load'});await p.waitForFunction(()=>window.__wos&&window.WosOutbox?.recoveryComplete);await p.evaluate(()=>WosFlight.connection(false));await openList(p);
  ok(await p.evaluate(()=>WosOutbox.unsent().filter(it=>it.offlineContext&&it.state==='held').length===3),skin+' three held replies survive offline reload');
  await openThread(p,'flight-4');
  await p.getByText('Needs a connection',{exact:true}).first().waitFor({timeout:1000});
  await p.locator('[data-chback]').first().click();
  const beforeApprove=f.state.posts.length;const approvalMs=await p.evaluate(async()=>{const t=performance.now();try{await WizLive.approve('qa-approval','approve');throw Error('Unexpected approval');}catch(e){if(e.message!=='Needs a connection')throw e;}return performance.now()-t;});
  ok(approvalMs<1000&&f.state.posts.length===beforeApprove,skin+' approvals refuse offline in under one second without POST');
  await context.unroute('**/*');f.state.online=true;await p.evaluate(()=>WizLive.refresh(true));await p.waitForFunction(()=>!WosFlight.offline());
  await p.getByText('3 replies recorded offline',{exact:true}).waitFor();
  await p.screenshot({path:path.join(out,skin+'-landing-tray.png')});
  const runBase=f.state.runs.length;
  // Remove the typed note; retain both original audio notes through the real Delete action.
  const typedId=await p.evaluate(()=>WosOutbox.unsent().find(it=>it.text==='Typed flight reply').id);
  await p.locator(`[data-flight-delete="${typedId}"]`).first().click();
  await p.getByText('2 replies recorded offline',{exact:true}).waitFor();
  await p.locator('[data-flight-send]').first().click();await p.waitForFunction(()=>!WosOutbox.unsent().some(it=>it.offlineContext));
  const admitted=f.state.runs.slice(runBase);ok(admitted.length===2&&new Set(admitted.map(r=>r.key)).size===2,skin+' Send all admits exactly two distinct submissions');
  ok(admitted.every(r=>r.body.offline_context?.recordedOfflineAt&&r.body.offline_context.lastSeenMessageId&&r.body.offline_context.lastSeenMessagePreview&&!r.body.input.includes('recordedOfflineAt')&&r.body.instructions.startsWith('[Wizard OS context]')),skin+' structured offline stamp travels beside frozen route, never in owner words');
  ok(f.state.maxInflight<=2,skin+' landing uploads capped at two');
  // Mid-upload process death: server admits headers/body, page dies before response.
  await p.evaluate(async()=>{WosFlight.connection(false);await WosOutbox.enqueue({kind:'reply',sessionId:'flight-1',text:'Interrupted landing reply',model:'qa-model',provider:'qa-provider'});WosFlight.connection(true);});
  await openList(p);f.state.holdNextRun=true;const interruptedBase=f.state.runs.length;
  await p.locator('[data-flight-send]').first().click();
  for(let n=0;n<100&&f.state.runs.length===interruptedBase;n++)await wait(30);
  ok(f.state.runs.length===interruptedBase+1,skin+' mid-upload server admission observed before app death');
  await p.close();p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await boot(p,origin);await p.waitForFunction(()=>WosOutbox.recoveryComplete);await openList(p);
  await p.waitForFunction(()=>WosOutbox.unsent().some(it=>it.text==='Interrupted landing reply'&&it.state==='unconfirmed'));
  await wait(1300);ok(f.state.runs.length===interruptedBase+1,skin+' ambiguous reply stays in tray and never auto-retries');
  await p.locator('[data-flight-send]').first().click();await p.waitForFunction(()=>!WosOutbox.unsent().some(it=>it.text==='Interrupted landing reply'));
  ok(f.state.runs.length===interruptedBase+1&&f.state.runs.at(-1).replays===1,skin+' explicit resend replays exact idempotency key without second run');
  ok(errors.length===0,skin+' no page errors: '+JSON.stringify(errors));
  await context.close();
 }
 console.log('PASS offline chats flight loop');
 }finally{await browser?.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
