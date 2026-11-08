'use strict';
// Reuse the exact-live closed synthetic shell fence; never contact an owner origin or meeting API.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const fixture=require('./tools/qa-closed-shell.cjs');
const OUT=process.env.QA_OUT;assert(OUT);fs.mkdirSync(OUT,{recursive:true});
const results={source:process.env.QA_SOURCE_SHA,synthetic:true,cases:[],screenshots:[],transport:[]};
let browser,page,stage='boot';const evidenceSinks=[];const pass=name=>{results.cases.push(name);console.log('PASS',name)};
const recorderSource=process.env.QA_RECORDER_SOURCE;assert(recorderSource,'QA_RECORDER_SOURCE must pin the actual Recorder app source');
const recorderBytes=fs.readFileSync(recorderSource);results.recorder={sha:process.env.QA_RECORDER_SHA,appSha256:require('node:crypto').createHash('sha256').update(recorderBytes).digest('hex')};
const app=require('./tools/qa-recorder-controller.cjs').fixture(recorderBytes.toString());
const browserArgs=['--disable-background-networking','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'];
// Retain exact browser diagnostics for r5's URL rewrite, then exercise the same Blob
// directly at the owned origin below. This disposable page contains no product code.
async function diagnoseR5Transport(){
 const report={errors:[]},sink=await require('./tools/qa-recorder-stop-evidence.cjs').start({out:OUT,mode:'phone',report});
 const b=await chromium.launch({executablePath:process.env.QA_CHROME||undefined,args:[...browserArgs,'--unsafely-treat-insecure-origin-as-secure=http://wizard-qa.invalid']});
 const c=await b.newContext({serviceWorkers:'block'}),p=await c.newPage();
 const diagnostic={kind:'r5-rewrite',origin:'http://wizard-qa.invalid',sink:sink.url,events:[]};results.transport.push(diagnostic);
 const cdp=await c.newCDPSession(p);await cdp.send('Network.enable');
 cdp.on('Network.loadingFailed',e=>diagnostic.events.push({kind:'cdp-failed',...e}));
 p.on('console',m=>{if(m.type()==='error')diagnostic.events.push({kind:'console',text:m.text()})});
 p.on('requestfailed',q=>diagnostic.events.push({kind:'failed',url:q.url(),error:q.failure()}));
 p.on('response',r=>diagnostic.events.push({kind:'response',url:r.url(),status:r.status()}));
 try{
  await c.route('**/*',r=>{
   const u=new URL(r.request().url());
   if(u.origin===diagnostic.origin&&u.pathname==='/fixture-capture-evidence'&&u.search==='?id=preflight'&&r.request().method()==='POST')return r.continue({url:sink.url+u.pathname+u.search});
   if(u.href===diagnostic.origin+'/')return r.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic r5 transport diagnostic</title>'});
   return r.abort('blockedbyclient');
  });
  await p.goto(diagnostic.origin+'/');
  diagnostic.result=await p.evaluate(()=>{try{const x=new XMLHttpRequest();x.open('POST','/fixture-capture-evidence?id=preflight',false);x.send(new Blob([Uint8Array.of(0,255,128)]));return {status:x.status}}catch(e){return {error:String(e)}}});
 }finally{await b.close();await sink.close();diagnostic.sinkReport=report}
 fs.writeFileSync(path.join(OUT,'transport-diagnostics.json'),JSON.stringify(results.transport,null,2));
}
async function load(phone){
 let version='a'.repeat(40);
 const sink=await require('./tools/qa-recorder-stop-evidence.cjs').start({out:OUT,mode:phone?'phone':'desktop',report:fixture.report});evidenceSinks.push(sink);
 if(phone)await diagnoseR5Transport();
 const {c}=await fixture.boot(phone,async c=>{
   await c.addInitScript(()=>{if(window===top)sessionStorage.setItem('syntheticLoads',String(+(sessionStorage.getItem('syntheticLoads')||0)+1));});
   await c.route('**/wizard/v1/apps',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({apps:[{id:'mizel',name:'Synthetic Recorder',kind:'wizard',url:'/fixture-recorder/',source:'apps.json'}]})}));
   await c.route('**/fixture-recorder/**',r=>r.fulfill({contentType:'text/html',body:app}));
   await c.route('**/wizard-os-home/ux-version.txt',r=>r.fulfill({contentType:'text/plain',body:version}));
   // Evidence sink only, not an app/server API: retain the exact Stop blob outside the navigating page.
   // The synchronous synthetic POST finishes in the Stop callback's task, before deferred Reload unloads it.
   await c.route(u=>u.origin===sink.url&&/^\/fixture-capture-evidence\?id=(?:[a-f0-9-]+|preflight)$/.test(u.pathname+u.search),async r=>{
     const q=r.request();
     fixture.report.requests.push({method:q.method(),path:new URL(q.url()).pathname});
     assert.equal(q.method(),'POST');
     // Same-origin socket: do not rewrite URL/origin or reconstruct Chromium Blob bytes.
     // Only this exact POST escapes fulfillment; all other traffic stays closed.
     await r.continue();
   });
 },sink);
 page=fixture.getPage();await page.clock.resume();
 const transport={kind:'same-origin',mode:phone?'phone':'desktop',origin:sink.url,events:[]};results.transport.push(transport);
 const cdp=await c.newCDPSession(page);await cdp.send('Network.enable');
 cdp.on('Network.loadingFailed',e=>transport.events.push({kind:'cdp-failed',...e}));
 page.on('console',m=>{if(m.type()==='error')transport.events.push({kind:'console',text:m.text()})});
 page.on('requestfailed',q=>transport.events.push({kind:'failed',url:q.url(),error:q.failure()}));
 page.on('response',r=>{if(new URL(r.url()).pathname==='/fixture-capture-evidence')transport.events.push({kind:'response',url:r.url(),status:r.status()})});
 try{
  assert.equal(await page.evaluate(()=>{const xhr=new XMLHttpRequest();xhr.open('POST','/fixture-capture-evidence?id=preflight',false);xhr.send(new Blob([Uint8Array.of(0,255,128)]));return xhr.status}),204,'exact synthetic Blob wire transport preflight');
  assert.equal(await page.evaluate(()=>isSecureContext),true,'owned loopback is a secure context without security bypass flags');
 }finally{fs.writeFileSync(path.join(OUT,'transport-diagnostics.json'),JSON.stringify(results.transport,null,2))}
 await page.waitForFunction(()=>window.WizAppCapture&&window.WizWebUpdate&&window.WizAppServices);
 await page.evaluate(()=>WizOpenApp('mizel'));
 await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.contentWindow?.fixtureReady));
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('iframe')].find(f=>f.contentWindow?.fixtureReady)?.contentWindow.fixtureError||null),null,'production controller fixture must execute, not fail setup');
 await page.waitForFunction(()=>WizAppServices.inspect().some(f=>f.appId==='mizel'));
 await page.evaluate(()=>WizCore.deeplink.route(location.origin+'/wizard-os-home/?view=chats'));
 await fixture.settle(page);
 const frame=()=>page.frames().find(f=>f.url().includes('/fixture-recorder/'));
 return {c,frame,async stopped(){let timer;try{return await Promise.race([sink.received(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Stop evidence was not received before Reload')),15000)})])}finally{clearTimeout(timer)}},async update(){await page.evaluate(()=>WizWebUpdate.check(true));version='b'.repeat(40);await page.evaluate(()=>WizWebUpdate.check(true));await page.locator('#dvWeb [data-web="go"]').waitFor();}};
}
async function shot(name,skin){
 await fixture.settle(page);assert.equal(await page.evaluate(()=>WosSkin.current),skin);
 const button=page.locator('#dvWeb [data-web="go"]'),box=await button.boundingBox(),viewport=page.viewportSize();assert(box&&box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height);
 const file=path.join(OUT,name+'.png');await page.screenshot({path:file});results.screenshots.push({file,skin,box,shell:await page.evaluate(()=>document.documentElement.dataset.shell)});
}
(async()=>{try{
 browser=await chromium.launch({executablePath:process.env.QA_CHROME||undefined,args:browserArgs});fixture.setBrowser(browser);
 for(const phone of [true,false]){
  const mode=phone?'phone':'desktop';stage=mode+': failed Start';const {c,frame,update,stopped}=await load(phone);
  await page.waitForFunction(()=>WizAppCapture.getState().nativeRegistryReady===true);
  assert.equal(await page.evaluate(()=>WizAppServices.update.reloadPlan().ok),true,'REGRESSION_FAILED_START_HOLD_MUST_NOT_TRAP_RELOAD');pass(mode+': exact failed-start hold no longer traps Reload');
  await frame().evaluate(()=>window.notesHold=WizardApp.update.hold('Mizel unsaved notes'));
  assert.equal(await page.evaluate(()=>WizAppServices.update.reloadPlan().ok),false);await frame().evaluate(()=>notesHold.release());pass(mode+': unsaved notes remain protected');
  await update();
  for(const skin of ['nebula','sepia']){
   stage=mode+': '+skin+' check';await page.evaluate(s=>WosSkin.set(s),skin);await fixture.settle(page);
   await page.evaluate(()=>WizAppCapture.configureNativeBridge({start:()=>{throw Error('must not start')},stop:()=>{throw Error('must not stop')},status:()=>new Promise(r=>window.syntheticStatus=r)}));
   await page.locator('#dvWeb [data-web="go"]').click();
   await page.waitForFunction(()=>!!window.syntheticStatus);assert.equal(await page.locator('#dvWeb [data-web="go"]').textContent(),'Checking recorder…');
   await shot(mode+'-'+skin+'-checking',skin);
   // A bridge failure must leave this document/audio intact, then allow a normal retry.
   const before=await page.evaluate(()=>sessionStorage.getItem('syntheticLoads'));
   await page.evaluate(()=>{syntheticStatus(null);window.syntheticStatus=null});
   await page.waitForFunction(()=>!document.querySelector('#dvWeb [aria-busy="true"]'));
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('syntheticLoads')),before);
   assert.equal(await page.evaluate(()=>WizWebUpdate.armed),false,'REGRESSION_UNKNOWN_NATIVE_CHECK_MUST_NOT_ARM');
   assert.equal(await page.evaluate(()=>WizAppServices.update.reloadPlan().recording),false,'unknown custody is not a recording-end wait');
   pass(mode+': '+skin+' immediate checking/error stays recoverable and unarmed');
  }
  stage=mode+': real browser capture';
  const before=await page.evaluate(()=>sessionStorage.getItem('syntheticLoads'));
  await page.evaluate(async()=>{WizAppCapture.configureNativeBridge(null);await WizAppCapture.reconcileReload();window.syntheticSession=await WizAppCapture.start('mizel',{kind:'audio',chunkMs:100,meta:{meetingId:'synthetic-only'}});});
  assert.equal(await page.evaluate(()=>WizWebUpdate.armed),false,'a failed native check must not arm the fresh Start');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('syntheticLoads')),before,'fresh Start must not consume a failed Reload tap');
  assert.equal(await page.evaluate(()=>WizAppCapture.reloadCheck().safe),false);
  await page.locator('#dvWeb [data-web="go"]').click();assert.equal(await page.evaluate(()=>WizWebUpdate.armed),true);
  await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>sessionStorage.getItem('syntheticLoads')),before);pass(mode+': real MediaRecorder audio cannot be bypassed');
  stage=mode+': Stop and deferred Reload';
  // Do not await asynchronous blob hashing in a page that is REQUIRED to really reload at release.
  // Send its exact Stop result synchronously to the closed evidence route, hashing in Node instead.
  await page.evaluate(()=>{void syntheticSession.stop().then(out=>{
    sessionStorage.setItem('syntheticCapture',out.id);
    const xhr=new XMLHttpRequest();xhr.open('POST','/fixture-capture-evidence?id='+encodeURIComponent(out.id),false);
    xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.send(out.blob);
    if(xhr.status!==204)throw Error('Synthetic Stop evidence was not retained');
  });});
  const kept=await stopped();assert(kept.bytes>0);
  await page.waitForFunction(before=>sessionStorage.getItem('syntheticLoads')!==before,before,{timeout:15000});
  await page.waitForFunction(()=>window.WizAppCapture);
  const after=await page.evaluate(async()=>{const rows=await WizAppCapture.pending('mizel');const r=rows.find(r=>r.id===sessionStorage.getItem('syntheticCapture'));return r&&{id:r.id,bytes:r.blob.size,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await r.blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('')}});
  assert.deepEqual(after,kept);pass(mode+': Stop then Reload retains exact durable synthetic audio bytes');
  results[mode]={kept};await c.close();
 }
 assert.deepEqual(fixture.report.unknown,[],'no uncatalogued or owner network paths');assert.deepEqual(fixture.report.errors,[],'no page exceptions');assert.deepEqual(fixture.report.refusedWrites,[],'no unadmitted writes');pass('closed synthetic fence: no private content/API access');
}catch(e){results.failure={stage,error:String(e.stack)};await page?.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});process.exitCode=1;console.error(results.failure)}finally{fs.writeFileSync(path.join(OUT,'transport-diagnostics.json'),JSON.stringify(results.transport,null,2));fs.writeFileSync(path.join(OUT,'recorder-reload.json'),JSON.stringify(results,null,2));fs.writeFileSync(path.join(OUT,'fixture-requests.json'),JSON.stringify(fixture.report,null,2));await browser?.close();await Promise.all(evidenceSinks.map(sink=>sink.close()));}})();
