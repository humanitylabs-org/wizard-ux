// Store "Remove app" and one-row source conflicts: fixture-only browser proof. Nothing reaches a real Wizard:
// this tree's web/ is served from disk, every Store read is a fixture, every write is intercepted, and the only
// write let through is the fixture's own `store-install/_remove/ledger` POST.
//   node tests/qa-store-remove.cjs              candidate assertions + screenshots
//   QA_MODE=baseline node tests/qa-store-remove.cjs   same fixtures on a tree without the change (before shots)
// Env: QA_ROOT=<tree> (default: this checkout), QA_OUTPUT=<dir> (default: <tmp>/store-remove-qa).
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const ROOT=process.env.QA_ROOT || path.resolve(__dirname,'..'), OUT=process.env.QA_OUTPUT || path.join(os.tmpdir(),'store-remove-qa');
const BASELINE=process.env.QA_MODE==='baseline', origin='https://store-remove.test';
const C='a'.repeat(40), D='d'.repeat(40), E='e'.repeat(40), F='f'.repeat(40);
const rel=a=>({...a,releases:[{...a}]});
const ledger=rel({id:'ledger',name:'Ledger',summary:'Review transactions, set categories and see spending over your bank connection.',repo:'example/ledger',version:'0.10.0',commit:C,source:'standard',source_name:'Standard',channel:'standard',type:'view',category:'app',tags:['finance'],publisher:'example',uses:[],provides:['ledger']});
const cardsA=rel({id:'cards',name:'Cards',summary:'Your profile card. Add friends by ID and share your look.',repo:'origin-team/cards',version:'0.5.2',commit:D,source:'standard',source_name:'Standard',channel:'standard',type:'view',category:'app',tags:['social'],publisher:'origin-team',uses:[],provides:['cards'],conflict:true});
const cardsB=rel({...cardsA,repo:'fork-team/cards',version:'0.5.1',commit:E,publisher:'fork-team'});
const helper=rel({id:'helper',name:'Helper',summary:'A built-in helper that Wizard keeps installed.',repo:'example/helper',version:'1.0.0',commit:C,source:'standard',source_name:'Standard',channel:'standard',type:'view',category:'app',tags:['system'],publisher:'example',uses:[],provides:['helper']});
const catalog=[ledger,cardsA,cardsB,helper];
const plan=(over={})=>({app:'ledger',name:'Ledger',installed:true,removable:true,protected:false,reason:'',identity:{repo:'example/ledger',commit:C,source:'standard'},dependents:[{id:'reports',name:'Reports'}],empties:[],backups:1,...over});
const ident={repo:'example/ledger',commit:C};
const expectedBody={repo:'example/ledger',commit:C,dependents:['reports'],empties:[]};
const VIEWPORTS=[{width:390,height:844,touch:true},{width:1280,height:800,touch:false}];
const SKINS=[{id:'nebula',css:''},{id:'obsidian-light',css:'/wizard-os-home/skins/obsidian/skin.css'}];
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}); const results=[];
 try { for(const skin of SKINS) for(const vp of VIEWPORTS) {
  const tag=`${BASELINE?'before':'after'}-${skin.id}-${vp.width}`;
  const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},hasTouch:vp.touch,isMobile:vp.touch,serviceWorkers:'block'});
  const st={installed:new Set(['ledger','cards','helper']),mode:'success',posts:[],unsafe:[],planReads:0,polls:0};
  const errors=[];
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;
   if(p==='/wizard-os-home/store-install/_remove/ledger/plan' && req.method()==='GET') {
    st.planReads++;
    if(st.mode==='old-wam') return route.fulfill({status:404,contentType:'text/html',body:'not found'});
    if(st.mode==='required') return route.fulfill({json:plan({removable:false,reason:'Wizard needs Bank connection. Install another app that provides it first.'})});
    if(st.mode==='plan-mismatch') return route.fulfill({json:plan({identity:{repo:'example/ledger',commit:F,source:'standard'}})});
    return route.fulfill({json:st.installed.has('ledger')?plan():plan({installed:false,removable:false,reason:'Ledger isn’t installed on this Wizard.'})});
   }
   if(p==='/wizard-os-home/store-install/_remove/ledger' && req.method()==='POST') {
    const body=req.postDataJSON(); st.posts.push({mode:st.mode,body,headers:req.headers()});
    if(st.mode==='refused') return route.fulfill({status:409,json:{error:'Ledger changed since you opened it. Refresh and try again; nothing was removed.'}});
    st.job={app:'ledger',state:'removing',identity:ident};
    return route.fulfill({status:202,json:st.job});
   }
   if(p==='/wizard-os-home/store-install/_remove/ledger' && req.method()==='GET') {
    st.polls++;
    const final={failed:{state:'failed',error:'Not removed: the App Manager is busy (409). Ledger is still installed.'},unknown:{state:'unknown',error:'Removing Ledger hasn’t finished yet. Refresh to check.'},mismatch:{state:'removed',identity:{repo:'example/ledger',commit:F}},stale:{state:'removed'},success:{state:'removed'}}[st.mode];
    if(st.mode==='success') st.installed.delete('ledger');
    return route.fulfill({json:{app:'ledger',identity:ident,...final}});
   }
   if(!['GET','HEAD'].includes(req.method())) { st.unsafe.push(req.method()+' '+p); return route.abort(); }
   if(p.includes('/store-data/')) {
    if(p.includes('/index/search')) return route.fulfill({json:{apps:catalog,sources:[{id:'standard',name:'Standard',stale:false}],next_offset:null}});
    if(p.endsWith('/api/apps/installed')) return route.fulfill({json:{installed:[...st.installed].map(id=>({info:{id,urn:id+':wizardapps'},app:{status:'running'}}))}});
    if(p.endsWith('/wizard/v1/installed-apps')) return route.fulfill({json:{architecture:'amd64',complete:true,unavailable:[],
      wam:[{id:'ledger',repo:'example/ledger',commit:C,version:'0.10.0',status:'running',source:'standard',type:'view'},{id:'cards',repo:'origin-team/cards',commit:F,version:'0.5.1',status:'running',source:'standard',type:'view'},{id:'helper',repo:'example/helper',commit:C,version:'1.0.0',status:'running',source:'standard',type:'view',system:true}].filter(a=>st.installed.has(a.id)),
      shell:[{id:'ledger',url:'/ledger/'},{id:'cards',url:'/cards/'},{id:'helper',url:'/helper/',system:true}].filter(a=>st.installed.has(a.id))}});
    if(p.includes('/router/v1/')) return route.fulfill({json:{models:[],services:[],providers:[]}});
    return route.fulfill({status:404,json:{error:'fixture_only'}});
   }
   if(p==='/host') return route.fulfill({contentType:'text/html',body:`<!doctype html><html data-skin="${skin.id}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/wizard-os-home/core/base.css">${skin.css?`<link rel="stylesheet" href="${skin.css}">`:''}<style>html,body{margin:0;width:100%;height:100%;background:var(--bg)}.win{width:100%;height:100%;background:var(--sk-win,var(--bg))}iframe{border:0;width:100%;height:100%;display:block}</style><script>localStorage.setItem('wos.skin','${skin.id}');window.changed=[];window.opened=[];addEventListener('message',e=>{if(e.origin!==location.origin)return;if(e.data?.type==='wizard:apps-changed')window.changed.push(e.data.id);if(e.data?.type==='wizard:open-app')window.opened.push(e.data.id);});</script><script src="/wizard-os-home/core/skins.js"></script><script>window.WizCore={apps:()=>({APPS:[{url:'/wizard-os-home/store/'}]})};window.WizCanOpen=id=>['ledger','cards','helper'].includes(id);</script><script src="/wizard-os-home/core/appearance-host.js"></script><body><div class="win"><iframe src="/wizard-os-home/store/index.html"></iframe></div></body></html>`});
   if(p.startsWith('/wizard-os-home/')) {
    const file=path.join(ROOT,'web',decodeURIComponent(p.slice('/wizard-os-home/'.length)));
    if(file.startsWith(path.join(ROOT,'web')) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream',body:fs.readFileSync(file)});
   }
   return route.abort();
  });
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/host');
  const f=page.frames().find(x=>x.url().includes('/store/index.html')); assert.ok(f,'store frame');
  await f.waitForFunction(()=>window.__store?.state().loaded && document.documentElement.dataset.skin);
  const tap=async loc=>vp.touch?loc.tap():loc.click();
  const shot=async name=>{await page.waitForTimeout(350);await page.screenshot({path:path.join(OUT,`${tag}-${name}.png`),animations:'disabled'});};
  const noOverflow=async where=>assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow at '+where);
  const scheme=await f.evaluate(()=>document.documentElement.dataset.colorScheme || getComputedStyle(document.documentElement).colorScheme);
  await tap(f.locator('[data-kind="apps"]')); await f.locator('.row').first().waitFor();
  const cardsRows=await f.locator('.row[data-app^="cards|"]').count();
  const listText=await f.locator('#results').innerText();
  await shot('apps-list'); await noOverflow('list');
  const out={tag,skin:skin.id,width:vp.width,scheme,cardsRows};
  if(BASELINE) {
   // Expected RED on untouched main: duplicate same-ID rows, the inert imperative, no way to remove an app.
   assert.equal(cardsRows,2); assert.match(listText,/Resolve conflict/);
   assert.equal(await f.locator('.row[data-app^="cards|"] [data-open]').count(),0);
   assert.equal(await f.locator('.row[data-app^="cards|"] button').count(),0,'Resolve conflict is not a button');
   await tap(f.locator('.row[data-app^="cards|"] .tx').first()); await f.locator('#detail h2').waitFor(); await shot('cards-detail'); await tap(f.locator('#detail [data-back]'));
   await tap(f.locator('.row[data-app^="ledger|"] .tx')); await f.locator('#detail [data-open="ledger"]').waitFor();
   out.removeActions=await f.locator('#detail [data-remove]').count(); assert.equal(out.removeActions,0);
   await shot('ledger-detail');
  } else {
   // One entry per app ID; the installed copy still opens; the conflict is a status, never a button.
   assert.equal(cardsRows,1); assert.doesNotMatch(listText,/Resolve/);
   const cards=f.locator('.row[data-app^="cards|"]');
   assert.equal(await cards.locator('.conflict-badge').innerText(),'Source conflict');
   assert.equal(await cards.locator('[data-open="cards"]').count(),1); assert.equal(await cards.locator('[data-get]').count(),0);
   await tap(cards.locator('.tx')); await f.locator('#detail h2').waitFor();
   const sources=await f.locator('#detail .src-list').innerText();
   assert.match(sources,/origin-team\/cards\s+Installed/); assert.match(sources,/fork-team\/cards\s+Version 0\.5\.1/);
   assert.match(await f.locator('#detail').innerText(),/Wizard keeps the installed one/);
   assert.equal(await f.locator('#detail [data-open="cards"]').count(),1); assert.equal(await f.locator('#detail [data-get]').count(),0);
   await shot('cards-detail'); await noOverflow('cards detail'); await tap(f.locator('#detail [data-back]'));
   // Wizard's own apps never offer removal.
   await tap(f.locator('.row[data-app^="helper|"] .tx')); await f.locator('#detail [data-open="helper"]').waitFor();
   assert.equal(await f.locator('#detail [data-remove]').count(),0); await tap(f.locator('#detail [data-back]'));
   // Ledger: Open stays primary; Remove app is a quiet secondary action.
   await tap(f.locator('.row[data-app^="ledger|"] .tx')); await f.locator('#detail [data-open="ledger"]').waitFor();
   const looks=await f.evaluate(()=>{const o=document.querySelector('#detail [data-open]'),r=document.querySelector('#detail [data-remove]'),cs=e=>getComputedStyle(e);
    return {open:{bg:cs(o).backgroundColor,box:o.getBoundingClientRect().toJSON()},remove:{bg:cs(r).backgroundColor,color:cs(r).color,text:r.textContent,box:r.getBoundingClientRect().toJSON()}};});
   assert.equal(looks.remove.text,'Remove app'); assert.match(looks.remove.bg,/rgba\(0, 0, 0, 0\)|transparent/);
   assert.ok(looks.remove.box.height>=44,'Remove app is a 44px target');
   out.looks=looks;
   await shot('ledger-detail'); await noOverflow('ledger detail');
   const openReview=async()=>{await tap(f.locator('#detail [data-remove]')); await f.locator('#sheet').waitFor({state:'visible'}); await f.waitForFunction(()=>!document.querySelector('#sheet [role="status"]'));};
   // Escape and Cancel leave everything untouched and return to the app page.
   st.mode='success'; await openReview(); await f.locator('#sheet [data-remove-confirm]').waitFor();
   const review=await f.locator('#sheet').innerText();
   assert.match(review,/Remove Ledger\?/); assert.match(review,/Ledger and its app data on this Wizard will be deleted/);
   assert.match(review,/Reports uses Ledger and may stop working/); assert.match(review,/1 earlier backup is kept/);
   assert.equal(await f.evaluate(()=>document.activeElement?.className),'rm-cancel','focus starts on Cancel');
   await shot('remove-review'); await noOverflow('review');
   await page.keyboard.press('Escape'); await f.locator('#detail [data-open="ledger"]').waitFor();
   assert.equal(await f.locator('#sheet').isHidden(),true);
   assert.equal(await f.evaluate(()=>document.activeElement?.dataset.remove || ''),'ledger|example/ledger','focus returns to Remove app');
   await openReview(); await tap(f.locator('#sheet .rm-cancel')); await f.locator('#detail [data-open="ledger"]').waitFor();
   assert.equal(st.posts.length,0,'cancel posts nothing');
   // Plan-level refusals: no destructive button, a plain reason, Back returns.
   for(const [mode,why] of [['required',/Wizard needs Bank connection/],['old-wam',/needs updating/],['plan-mismatch',/changed since this page loaded/]]) {
    st.mode=mode; await openReview();
    assert.match(await f.locator('#sheet [role="alert"]').innerText(),why,mode); assert.equal(await f.locator('#sheet [data-remove-confirm]').count(),0,mode);
    if(mode==='required') await shot('remove-refused');
    await tap(f.locator('#sheet .rm-cancel')); await f.locator('#detail [data-open="ledger"]').waitFor();
   }
   assert.equal(st.posts.length,0);
   // Request-level refusals, failures and unknown outcomes keep the review and the app; nothing claims removal.
   for(const [mode,why] of [['refused',/changed since you opened it/],['failed',/still installed/],['unknown',/Refresh to check/],['mismatch',/different app/],['stale',/still lists Ledger/]]) {
    st.mode=mode; await openReview(); await tap(f.locator('#sheet [data-remove-confirm]'));
    await f.waitForFunction(()=>window.__store.state().removing===0 && document.querySelector('#sheet [role="alert"]'),null,{timeout:15000});
    assert.match(await f.locator('#sheet [role="alert"]').innerText(),why,mode);
    assert.equal(await f.locator('#sheet').isVisible(),true,mode+' keeps the review');
    if(mode==='failed') await shot('remove-failed');
    await tap(f.locator('#sheet .rm-cancel')); await f.locator('#detail [data-open="ledger"]').waitFor();
    assert.ok(st.installed.has('ledger'),mode);
   }
   assert.equal(await page.evaluate(()=>window.changed.filter(x=>x==='ledger').length),3,'unknown/mismatch/stale refresh the app list; refusals do not');
   // Success: a double tap posts once, the registry is read back, the shell refreshes and the owner lands on the list.
   st.mode='success'; const before=st.posts.length; await openReview();
   const go=f.locator('#sheet [data-remove-confirm]');
   if(vp.touch) { await go.tap(); await go.tap({force:true}).catch(()=>{}); } else await go.dblclick();
   assert.equal(await f.locator('#sheet [data-remove-confirm]').innerText(),'Removing…');
   await shot('remove-busy');
   await f.locator('#results').waitFor({state:'visible',timeout:15000}); await f.locator('#toast.on').waitFor();
   assert.equal(st.posts.length-before,1,'one removal request');
   assert.equal(await f.locator('#detail').isHidden(),true); assert.equal(await f.locator('#sheet').isHidden(),true);
   assert.match(await f.locator('#toast').innerText(),/Ledger removed/);
   assert.equal(await f.locator('.row[data-app^="ledger|"] [data-get]').innerText(),'Get');
   assert.ok((await page.evaluate(()=>window.changed)).includes('ledger'));
   await shot('after-remove-list'); await noOverflow('after remove');
   // Refresh keeps one conflicted row and the removed app stays Get.
   await tap(f.locator('#refresh')); await f.locator('#refresh:not([disabled])').waitFor();
   assert.equal(await f.locator('.row[data-app^="cards|"]').count(),1);
   assert.equal(await f.locator('.row[data-app^="ledger|"] [data-get]').innerText(),'Get');
   // Canonical hosted Back: list → Store root, then hands Back to the shell; the Store stays mounted.
   assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true); assert.equal(await f.locator('#discover').isVisible(),true);
   assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),false);
   for(const p of st.posts) { assert.deepEqual(p.body,expectedBody); assert.equal(p.headers['x-wizard-store'],'1'); assert.match(p.headers['content-type'],/application\/json/); }
   out.posts=st.posts.map(p=>p.mode); out.planReads=st.planReads; out.polls=st.polls;
  }
  assert.deepEqual(st.unsafe,[],'no other writes'); assert.deepEqual(errors,[],'no page errors');
  results.push({...out,unsafeWrites:st.unsafe.length,pageErrors:errors.length}); await context.close();
 }} finally { await browser.close(); }
 fs.writeFileSync(path.join(OUT,`${BASELINE?'before':'after'}-results.json`),JSON.stringify({mode:BASELINE?'baseline':'candidate',passed:results.length,results},null,2));
 console.log(JSON.stringify({mode:BASELINE?'baseline':'candidate',passed:results.length,results:results.map(r=>({tag:r.tag,scheme:r.scheme,cardsRows:r.cardsRows,posts:r.posts,unsafeWrites:r.unsafeWrites,pageErrors:r.pageErrors}))},null,1));
})().catch(e=>{console.error(e);process.exitCode=1;});
