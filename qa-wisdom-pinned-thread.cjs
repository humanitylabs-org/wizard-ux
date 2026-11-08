'use strict';
// Canonical installed registry + exact candidate shell implementations. No replacement
// client/services, late attachment or capability overrides. All private APIs synthetic.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const ROOT=process.env.QA_SOURCE,OUT=process.env.QA_OUT,SHELL=process.env.QA_SHELL;
const LIVE=process.env.QA_LIVE==='1';
if(process.env.QA_ORIGIN!=='https://wizard.test'||LIVE)throw Error('Only sealed synthetic origin is admitted');
const BASE=new URL('/wizard-os-home/?app-session=wisdom',process.env.QA_ORIGIN);
const fixture=JSON.parse(fs.readFileSync(process.env.QA_FIXTURE)),manifest=JSON.parse(fs.readFileSync(process.env.QA_SOURCE_MANIFEST));
const allowed=new Set(JSON.parse(fs.readFileSync(process.env.QA_SHELL_ALLOWLIST)));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),DID='f'.repeat(32),SID='wizard_qa_wisdom_canonical_only';
const words='  Synthetic question — kept exactly\nwith a second line  ';
const json=(r,x,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(x)}).catch(e=>{if(/Target.*closed|context.*closed|Invalid InterceptionId|Invalid interception/.test(e.message))return;throw e;});
const mime=f=>({'.js':'application/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'}[path.extname(f)]||'application/octet-stream');
fs.mkdirSync(OUT,{recursive:true});
const result={status:'running',scope:LIVE?'INSTALLED live unmodified shell/app assets; synthetic private APIs; no provider calls':'CANDIDATE exact shell source + pinned Wisdom bytes; synthetic registry; synthetic private APIs; no provider calls',revision:manifest.revision,shellRevision:manifest.shell_revision,cases:[]};
function save(){fs.writeFileSync(path.join(OUT,'hosted-route.json'),JSON.stringify(result,null,2)+'\n')}
function reportFailure(c,e){console.error('FAIL wisdom-pinned-thread', JSON.stringify({width:c?.width,skin:c?.skin,action:c?.action,message:String(e.message),stack:String(e.stack)}));}
function sourceError(e){return {name:e.name,sourceStack:[...String(e.stack||'').matchAll(/https?:\/\/[^\s)]+:\d+:\d+/g)].map(x=>x[0].replace(BASE.origin,''))};}
(async()=>{const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});try{
for(const width of (process.env.QA_BASELINE==='1'?[390]:[390,1280]))for(const skin of (process.env.QA_BASELINE==='1'?['nebula']:['nebula','signal']))for(const action of ['selection-ask-ai','selection-open-discussion']){
 const c={width,skin,action,status:'running',requests:[],assets:{},failures:[]};result.cases.push(c);save();
 const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'allow',hasTouch:width===390,isMobile:width===390});
 const data=structuredClone(fixture),entry=data.entries[0],quote='attention',start=entry.body.indexOf(quote);assert(start>=0);
 let frame,thread,armed=false;const pending=new Set(),net={create:5500,bind:5500,failCreate:false,failBind:false};
 const makeThread=b=>({id:DID,entry_id:b.entry_id||entry.id,chapter_title:entry.title,quote:b.quote||b.text||quote,body_sha256:b.body_sha256||entry.body_sha256,start:b.start??start,end:b.end??start+quote.length,scope:b.scope||'passage',messages:[],active:false,detached:false,configured:true,model:'claude-fable-5-1'});
 if(action==='selection-open-discussion'){
  data.highlights=[{id:8001,entry_id:entry.id,body_sha256:entry.body_sha256,start,end:start+quote.length,text:quote,note:'',created_at:'synthetic'}];
  thread={...makeThread({}),highlight_id:8001,messages:[{id:'qa-history',role:'assistant',content:'Synthetic saved discussion history.',state:'complete',sources:[]}],message_count:1};
 }
 try{
  await ctx.addInitScript(require('./tools/qa-no-service-workers.cjs').blockServiceWorkerRegistration);
  await ctx.routeWebSocket('**/*',ws=>{c.requests.push({method:'WEBSOCKET',path:new URL(ws.url()).pathname,decision:'blocked'});ws.close()});
  await ctx.addInitScript(s=>{if(location.pathname.startsWith('/wizard-os-home/')){localStorage.setItem('wos.skin',s);localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true')}},skin);
  await ctx.route('**/*',async r=>{
   const req=r.request(),u=new URL(req.url()),p=u.pathname,m=req.method();
   const log=decision=>c.requests.push({method:m,path:p,decision});
   if(u.origin!==BASE.origin){log('blocked-external');return r.abort()}
   if(req.resourceType()==='eventsource'||/\/(?:events|stream)(?:\/|$)/.test(p)){log('blocked-stream');return r.abort()}
   if(p.startsWith('/wisdom/api/')){
    log('synthetic-private-api');const q=p.slice('/wisdom/api/'.length);let b={};try{b=req.postDataJSON()||{}}catch{}
    if(q==='wisdom'||q==='wisdom/reaction'||q==='wisdom/highlight')return json(r,data);
    if(q==='discussions'&&m==='GET')return json(r,{threads:thread?[thread]:[]});
    if((q==='discussions'&&m==='POST')||q==='discussions/'+DID){
     if(armed){const token={path:p};pending.add(token);await delay(net.create);pending.delete(token)}
     if(net.failCreate)return json(r,{error:'Synthetic admission failure'},503);
     if(m==='POST')thread=makeThread(b);
     return json(r,thread||makeThread({}));
    }
    if(q==='discussions/'+DID+'/thread'){
     if(armed){const token={path:p};pending.add(token);await delay(net.bind);pending.delete(token)}
     if(net.failBind)return json(r,{error:'Synthetic binding failure'},503);
     return json(r,{session_id:SID,agent:'philosopher',reply:{key:'wisdom:'+DID,title:entry.title,message:'Synthetic canonical route QA passage only.'}});
    }
    if(q==='library')return json(r,{bundles:[],source:[]});
    return json(r,{error:'Synthetic unspecified Wisdom API'},404);
   }
   if(m!=='GET'&&m!=='HEAD'){log('blocked-write');return json(r,{})}
   if(p==='/wizard/v1/bootstrap')return json(r,{bootstrap:1,settings:{agent:{name:'Wizard'},owner:{name:''},clock:{timezone:'UTC',day_starts_at:'00:00'}},endpoints:{apps:'/wizard/v1/apps'}});
   if(p==='/wizard/v1/agents')return json(r,{agents:[{id:'hermes',is_default:true,label:'Synthetic main',harness:'hermes',privacy:'standard',status:'running',model:{provider:'anthropic',model:'claude-fable-5-1'}},{id:'philosopher',label:'Synthetic route identity',harness:'hermes',privacy:'standard',status:'running',model:{provider:'anthropic',model:'claude-fable-5-1'},appearance:{glyph:'hat',hue:200}}]});
   if(p==='/wizard/v1/agent-options')return json(r,{harnesses:[],providers:[],presets:[],wizard_apps:[],agent_apps:[],outside_tools:[]});
   if(p==='/wizard/v1/app-bindings')return json(r,{bindings:[]});
   if(p==='/wizard/v1/ui-preferences')return json(r,{version:1,migrations:{'launcher-seed-v1':true},spaces:[],pinnedChats:[]});
   if(p==='/wizard/v1/skins')return json(r,{version:1,skins:[],active:null,migrated:true});
   if(p==='/wizard/v1/my-skin')return r.fulfill({contentType:'text/css',body:''});
   if(p==='/wizard/v1/my-skin/info')return json(r,{exists:false,bytes:0,script:{exists:false,bytes:0}});
   if(p==='/wizard/v1/schedules')return json(r,{schedules:[]});
   if(p==='/wizard/thread-seen'||p==='/wizard/thread-dispositions')return json(r,{state:{}});
   if(p==='/wizard/hermes/api/sessions')return json(r,{sessions:[],data:[],has_more:false,pagination:{returned:0,total:0}});
   if(p.startsWith('/wizard/hermes/api/sessions/'+SID)){
    const history=action==='selection-open-discussion'?[{id:'qa-native-history',role:'assistant',content:'Synthetic saved discussion history.',timestamp:'2026-10-29T00:00:00Z'}]:[];
    return json(r,p.endsWith('/messages')?{messages:history,data:history,has_more:false,pagination:{returned:history.length,total:history.length}}:{session:{id:SID,title:'Synthetic Wisdom route QA',agent:{id:'philosopher'},model:'claude-fable-5-1',provider:'anthropic',wizard_retry_input:'',message_count:history.length,messages:history}});
   }
   // Pinned app source, synthetic registry; no owner registry or network fallback.
   if(p==='/wizard/v1/apps'){log('sealed-synthetic-registry');return json(r,{apps:[require('./tools/qa-proof-fixture.cjs').app('wisdom')]})}
   if(p==='/wisdom/'||p.startsWith('/wisdom/')){
    if(LIVE){log('installed-live-static');return r.continue()}
    const f=p.slice('/wisdom/'.length)||'index.html';
    if(!Object.hasOwn(manifest.files,'static/'+f)){log('blocked-nonstatic-wisdom');return r.abort()}
    const b=fs.readFileSync(path.join(ROOT,'static',f));assert.equal(digest(b),manifest.files['static/'+f]);c.assets[f]=digest(b);return r.fulfill({contentType:mime(f),body:b});
   }
   if(p==='/wizard-os-home/'||allowed.has(p)){
    if(LIVE){log('installed-live-static');return r.continue()}
    const f=p.slice('/wizard-os-home/'.length)||'index.html',b=fs.readFileSync(path.join(SHELL,'web',f));
    assert.equal(digest(b),manifest.shell_files['web/'+f],f);c.assets[p]=digest(b);log('pinned-candidate-shell-static');return r.fulfill({contentType:mime(f),body:b});
   }
   // Unrelated default windows are inert documents, not private owner pages.
   if(['/mizel-live/','/usuals/','/wizard-topics-preview/'].includes(p))return r.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic unrelated app</title>'});
   log('blocked-private-or-unknown-get');return json(r,{error:'QA privacy barrier'},404);
  });
  const page=await ctx.newPage();const staticReads=[];page.on('response',r=>{const u=new URL(r.url());if(LIVE&&u.origin===BASE.origin&&(u.pathname.startsWith('/wizard-os-home/')||u.pathname.startsWith('/wisdom/'))&&!u.pathname.includes('/api/'))staticReads.push(r.body().then(b=>{c.assets[u.pathname]=digest(b)}).catch(()=>{}))});page.on('pageerror',e=>{c.failures.push({kind:'pageerror',...sourceError(e)})});
  const url=new URL(BASE);url.searchParams.set('shell',width===390?'phone':'desktop');
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>new URL(f.src,location.href).pathname.startsWith('/wisdom/')&&f.contentWindow?.WizardApp?.hosted===true),null,{timeout:30000});
  frame=page.frames().find(f=>new URL(f.url(),BASE).pathname.startsWith('/wisdom/'));assert(frame);
  await frame.locator('.wb-home').waitFor({timeout:20000});
  if(false){
   // Borderless mode deliberately hides title-bar buttons. Inspect real geometry;
   // use the supported desktop key when needed, never spoof layout/capabilities.
   c.desktopMode={before:await frame.evaluate(()=>innerWidth),control:'already-exact'};
   if(c.desktopMode.before!==width){
    const full=page.locator('.win:has(iframe[src*="/wisdom/"]) [data-wact="mono"]');
    if(await full.isVisible()){c.desktopMode.control='visible-button';await full.click()}
    else{c.desktopMode.control='Alt+F';await page.locator('body').press('Alt+f')}
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>new URL(f.src,location.href).pathname.startsWith('/wisdom/')&&f.contentWindow?.innerWidth===1280));
   }
   c.desktopMode.after=await frame.evaluate(()=>innerWidth);
   c.desktopMode.state=await page.evaluate(()=>({shell:document.documentElement.dataset.shell,frame:document.documentElement.dataset.skinFrame,fullscreen:document.body.classList.contains('desktop-fullscreen')}));
  }
  c.natural=await frame.evaluate(()=>({hosted:WizardApp.hosted,visible:WizardApp.view.isVisible(),threadAgents:WizardApp.nav.threadAgents,threadDrafts:WizardApp.nav.threadDrafts,openThreadType:typeof WizardApp.nav.openThread}));
  c.registration=await page.evaluate(()=>{const f=[...document.querySelectorAll('iframe')].find(f=>new URL(f.src,location.href).pathname.startsWith('/wisdom/'));return{authorized:WizAppServices.authorized(f),registeredApp:(WizCore.apps().APPS||[]).find(a=>a.id==='wisdom')?.id,framePath:new URL(f.src,location.href).pathname}});
  assert(c.registration.authorized&&c.registration.registeredApp==='wisdom');assert.equal(c.natural.hosted,true);assert.equal(c.natural.threadAgents,true);assert.equal(c.natural.threadDrafts,true);
  await frame.evaluate(id=>Wisdom.navigate('/read/'+id),entry.id);await frame.locator('.wb-reader').waitFor();await frame.evaluate(()=>document.fonts.ready);await delay(450);
  c.reader=await frame.evaluate(()=>({width:innerWidth,body:document.querySelector('.wb-reader')?.textContent.length,track:document.querySelector('.wb-track')?.style.transform,skin:document.documentElement.dataset.skin}));
  assert.equal(c.reader.width,width,'Actual iframe width');assert(c.reader.body>100);assert.equal(c.reader.skin,skin);
  const cd=await ctx.newCDPSession(page);await cd.send('Emulation.setCPUThrottlingRate',{rate:4});
  if(action==='selection-ask-ai'){
   let w;for(let i=0;i<10&&!w;i++){
    w=await frame.evaluate(()=>{const f=document.querySelector('.wb-flow'),walk=document.createTreeWalker(f,NodeFilter.SHOW_TEXT);let n;while(n=walk.nextNode()){if(n.parentElement.closest('mark.wb-hl,.wb-gloss,a,button'))continue;for(const m of n.data.matchAll(/[A-Za-z]{6,}/g)){const r=document.createRange();r.setStart(n,m.index);r.setEnd(n,m.index+m[0].length);const b=r.getBoundingClientRect();if(b.width&&b.left>25&&b.right<innerWidth-25&&b.top>110&&b.bottom<innerHeight-170)return{x:b.x+b.width/2,y:b.y+b.height/2,text:m[0]}}}return null});
    if(!w){await frame.evaluate(()=>dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));await delay(350)}
   }
   assert(w,'Visible synthetic word');const box=await(await frame.frameElement()).boundingBox();assert(box);c.selection=w.text;
   if(width===390){await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+w.x,y:box.y+w.y}]});await delay(650);await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}else await page.mouse.dblclick(box.x+w.x,box.y+w.y);
  }else await frame.locator('.wb-hl[data-discussed]').first().click();
  const ask=frame.locator('[data-hl-act="ask"]:visible');await ask.waitFor();assert.equal(await ask.textContent(),action==='selection-ask-ai'?'Ask AI':'Open discussion');
  await frame.evaluate(()=>{window.__qaReaderDocument=document;window.__qaTrack=document.querySelector('.wb-track')?.style.transform;window.__qaPaint={clicked:0,paint:null};document.querySelector('[data-hl-act="ask"]').addEventListener('click',()=>{window.__qaPaint.clicked=performance.now();const tick=()=>{const t=document.querySelector('.wd-composer textarea');if(t&&!document.querySelector('.wd-overlay').hidden&&!t.disabled&&document.activeElement===t){window.__qaPaint.paint=performance.now()-window.__qaPaint.clicked;return}if(performance.now()-window.__qaPaint.clicked<14000)requestAnimationFrame(tick)};requestAnimationFrame(tick)},{once:true,capture:true})});
  armed=true;if(width===390)await ask.tap();else await ask.click();await delay(300);
  c.at300ms=await frame.evaluate(()=>({paint:window.__qaPaint.paint,readerSame:document===window.__qaReaderDocument,trackSame:document.querySelector('.wb-track')?.style.transform===window.__qaTrack,sheetOpen:!document.querySelector('.wd-overlay').hidden,focused:document.activeElement?.matches('.wd-composer textarea')===true,quote:document.querySelector('.wd-quote blockquote')?.textContent,background:getComputedStyle(document.querySelector('.wd-panel')).backgroundColor}));
  assert(c.at300ms.paint!==null&&c.at300ms.paint<=150,'focused editable paint <=150ms');assert(c.at300ms.readerSame&&c.at300ms.trackSame&&c.at300ms.sheetOpen&&c.at300ms.focused);assert(c.at300ms.quote?.length);assert(!c.at300ms.background.includes('rgba')||c.at300ms.background.endsWith(', 1)'),'opaque panel');
  await frame.locator('.wd-composer textarea').fill(words);await frame.locator('.wd-composer textarea').evaluate(e=>e.setSelectionRange(3,12));
  await page.screenshot({path:path.join(OUT,`${width}-${skin}-${action}-pending.png`)});
  const native=page.locator('.hosted-thread .ch-compose textarea');await native.waitFor({timeout:14000});assert.equal(await native.inputValue(),words);
  if(action==='selection-open-discussion')await page.locator('.hosted-thread .bub').filter({hasText:'Synthetic saved discussion history.'}).waitFor();
  assert.equal(await page.locator('.hosted-thread .ch-reply').count(),1);assert(await page.locator('.hosted-thread .ch-attach').isVisible());
  c.handoff=await page.evaluate(sid=>({draft:WosChat.drafts.get('direct:'+sid).text,reply:WosChat.drafts.get('direct:'+sid).reply?.key,agent:WizLive.agentOf(sid)}),SID);
  assert.equal(c.handoff.draft,words);assert.equal(c.handoff.agent,'philosopher');assert.equal(c.handoff.reply,'wisdom:'+DID);
  assert.equal(await frame.locator('.wd-overlay').evaluate(e=>e.hidden),true);
  assert.equal(await frame.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('wisdom.discussions.v1:/wisdom/')||'{}')).filter(x=>x?.text).length),0);
  await page.screenshot({path:path.join(OUT,`${width}-${skin}-${action}-native.png`)});
  // Native Back uses the real shell handler, not a fabricated app callback.
  const shellBack=()=>page.evaluate(()=>window.__wosNativeBack?__wosNativeBack():__wux.escStep());
  assert.equal(await page.locator('.hosted-thread [data-chmic]').count(),1,'Shared native reply microphone is mounted (typed text normally hides it)');
  if(width===390 && action==='selection-ask-ai'){
   await native.fill('');
   assert(await page.locator('.hosted-thread [data-chmic]').isVisible());
   await ctx.grantPermissions(['microphone']);
   await page.locator('.hosted-thread [data-chmic]').click();
   await page.waitForFunction(()=>WizAppCapture.getState().phase==='recording');
   assert.equal(await page.locator('.hosted-thread [data-chmic]').getAttribute('aria-pressed'),'true');
   await page.screenshot({path:path.join(OUT,`${width}-${skin}-${action}-microphone.png`)});
   await delay(1200);assert.equal(await shellBack(),'recording');
   await page.waitForFunction(()=>!WizAppCapture.getState().active);
   c.microphone=await page.evaluate(async sid=>{
    const rows=await WizAppCapture.pending('wizard-chats'),r=rows.find(r=>r.meta?.sessionId===sid);
    if(!r||!r.blob.size||r.meta.appId!=='wisdom')throw Error('Synthetic recording not retained for exact thread');
    const report={bytes:r.blob.size,sessionId:r.meta.sessionId,appId:r.meta.appId,providerRuns:0,backKeptWithoutSend:true};
    await WizAppCapture.ack('wizard-chats',r.id);return report;
   },SID);
  }
  await native.evaluate(e=>e.blur());await shellBack();await page.waitForFunction(()=>!document.querySelector('.hosted-thread'));
  assert(await frame.locator('.wb-reader').isVisible());
  await page.evaluate(sid=>WosChat.drafts.clear('direct:'+sid),SID);
  net.create=300;net.bind=300;
  const fault=['create-failure','bind-failure','timeout','offline','back','outside','chapter','existing-draft'][result.cases.length-1];c.fault={kind:fault};
  if(fault==='create-failure')net.failCreate=true;
  if(fault==='bind-failure')net.failBind=true;
  if(fault==='timeout')net.bind=20000;
  if(['back','outside','chapter'].includes(fault))net.bind=1800;
  if(fault==='offline')await ctx.setOffline(true);
  if(fault==='existing-draft')await page.evaluate(sid=>{WosChat.drafts.set('direct:'+sid,'Existing native owner draft',[]);WosChat.drafts.setReply('direct:'+sid,{key:'wisdom:existing',title:'Existing context',message:'Do not replace'});},SID);
  // Happy entry above is always the real selection button. Faults reuse that
  // admitted discussion id, exercising the exact same product operation.
  await frame.evaluate(id=>{void WisdomDiscussion.open({id});},DID);await frame.locator('.wd-overlay:not([hidden])').waitFor();await frame.locator('.wd-composer textarea').fill('Synthetic fault question kept');
  if(['back','outside','chapter'].includes(fault)){
   if(fault==='back'){
    await frame.locator('.wd-composer textarea').evaluate(e=>e.blur());
    const first=await shellBack();c.fault.firstBack=first;
    // Desktop Back first leaves fullscreen, preserving the underlying app.
    // Only the next real Back reaches the app's existing shared handler.
    if(first==='mono'){assert.equal(await frame.locator('.wd-overlay').evaluate(e=>e.hidden),false);c.fault.secondBack=await shellBack();}
   }
   else if(fault==='outside'){
    // Desktop has no scrim: press visible reader space outside the side panel.
    const point=await frame.evaluate(()=>{const p={x:8,y:Math.floor(innerHeight/2)};if(document.querySelector('.wd-panel').contains(document.elementFromPoint(p.x,p.y)))throw Error('Outside target covered by panel');return p});
    const box=await frame.frameElement().then(e=>e.boundingBox());assert(box);await page.mouse.click(box.x+point.x,box.y+point.y);
   }
   else await frame.evaluate(()=>Wisdom.navigate('/'));
   await delay(2400);assert.equal(await page.locator('.hosted-thread').count(),0);assert.equal(await frame.locator('.wd-overlay').evaluate(e=>e.hidden),true);
   if(fault==='chapter'){await frame.evaluate(id=>Wisdom.navigate('/read/'+id),entry.id);await frame.locator('.wb-reader').waitFor();}
   net.bind=0;
   await frame.evaluate(id=>{void WisdomDiscussion.open({id});},DID);await native.waitFor();assert.equal(await native.inputValue(),'Synthetic fault question kept');
  }else{
   await frame.locator('.wd-notice button').filter({hasText:'Try again'}).waitFor({timeout:14500});
   assert.equal(await frame.locator('.wd-composer textarea').inputValue(),'Synthetic fault question kept');assert.equal(await page.locator('.hosted-thread').count(),0);assert(await frame.locator('.wd-send').isDisabled());
   if(fault==='existing-draft'){assert.equal(await page.evaluate(sid=>WosChat.drafts.get('direct:'+sid).text,SID),'Existing native owner draft');assert.equal(await page.evaluate(sid=>WosChat.drafts.get('direct:'+sid).reply.key,SID),'wisdom:existing');await page.evaluate(sid=>WosChat.drafts.clear('direct:'+sid),SID);}
   await ctx.setOffline(false);net.failCreate=false;net.failBind=false;net.bind=0;
   await frame.locator('.wd-notice button').filter({hasText:'Try again'}).click();await native.waitFor();assert.equal(await native.inputValue(),'Synthetic fault question kept');
  }
  c.fault.status='pass';
  if(width===1280&&skin==='nebula'&&action==='selection-ask-ai'){
   c.additionalFaults=[];
   for(const kind of ['storage','close']){
    const extra={kind,status:'running'};c.additionalFaults.push(extra);save();
    await native.evaluate(e=>e.blur());await shellBack();await page.waitForFunction(()=>!document.querySelector('.hosted-thread'));
    await page.evaluate(sid=>WosChat.drafts.clear('direct:'+sid),SID);net.create=300;net.bind=1800;
    if(kind==='storage')await page.evaluate(()=>{window.__qaStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='wos.chat.drafts.v1')throw new DOMException('Synthetic quota refusal','QuotaExceededError');return window.__qaStorageSet.call(this,k,v)}});
    await frame.evaluate(id=>{void WisdomDiscussion.open({id});},DID);await frame.locator('.wd-overlay:not([hidden])').waitFor();
    const kept='Synthetic '+kind+' question kept';await frame.locator('.wd-composer textarea').fill(kept);
    if(kind==='close'){
     await frame.locator('.wd-close').click();await delay(2400);
     assert.equal(await page.locator('.hosted-thread').count(),0);assert.equal(await frame.locator('.wd-overlay').evaluate(e=>e.hidden),true);
     net.bind=0;await frame.evaluate(id=>{void WisdomDiscussion.open({id});},DID);
    }else{
     await frame.locator('.wd-notice button').filter({hasText:'Try again'}).waitFor({timeout:14500});
     assert.equal(await frame.locator('.wd-composer textarea').inputValue(),kept);assert.equal(await page.locator('.hosted-thread').count(),0);
     assert.equal(await page.evaluate(sid=>WosChat.drafts.get('direct:'+sid).text,SID),'');
     await page.evaluate(()=>{Storage.prototype.setItem=window.__qaStorageSet;delete window.__qaStorageSet});net.bind=0;
     await frame.locator('.wd-notice button').filter({hasText:'Try again'}).click();
    }
    await native.waitFor();assert.equal(await native.inputValue(),kept);extra.status='pass';
   }
  }
  // Verify the app's complete pinned static inventory, not legacy live-only filenames.
  for(const f of Object.keys(manifest.files).filter(f=>f.startsWith('static/')).map(f=>f.slice(7))){
   const h=await frame.evaluate(async f=>{const r=await fetch(f,{cache:'no-store'});if(!r.ok)throw Error('Asset unavailable');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')},f);
   assert.equal(h,manifest.files['static/'+f],f);c.assets[f]=h;
  }
  await Promise.all(staticReads);
  for(const f of ['core/app-client.js','core/app-services.js','core/chat-kit.js','core/chats.js'])assert.equal(c.assets['/wizard-os-home/'+f],manifest.shell_files['web/'+f],f);
  c.admissions={discussionIds:thread?[thread.id]:[],sessionIds:[SID],providerRuns:0};
  assert(!c.requests.some(r=>r.path.includes('/runs')||r.path.endsWith('/ask')),'No send or provider request');
  assert.equal(c.failures.length,0,'No source pageerrors');c.status='pass';
 }catch(e){reportFailure(c,e);c.status='fail';const failedFrame=ctx.pages()[0]?.frames().find(f=>new URL(f.url(),BASE).pathname.startsWith('/wisdom/'));c.errorText=await failedFrame?.locator('.wd-notice').textContent().catch(()=>'');await ctx.pages()[0]?.screenshot({path:path.join(OUT,`${width}-${skin}-${action}-failure.png`)}).catch(()=>{});c.failures.push({kind:'assertion',message:String(e.message).slice(0,600),...sourceError(e)})}finally{await ctx.close();save()}
}
result.status=result.cases.length===(process.env.QA_BASELINE==='1'?2:8)&&result.cases.every(c=>c.status==='pass')?'pass':'fail';save();console.log('wisdom-pinned-thread',result.status,JSON.stringify(result.cases.map(({width,skin,action,status,failures})=>({width,skin,action,status,failures}))));if(result.status!=='pass')process.exitCode=1;
}finally{await browser.close()}})().catch(e=>{reportFailure(null,e);result.status='blocked';result.error={message:String(e.message).slice(0,600),...sourceError(e)};save();process.exitCode=1});