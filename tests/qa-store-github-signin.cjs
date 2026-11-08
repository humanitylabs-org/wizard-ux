// Fixture-only browser proof for Apps → Sources → Sign in to GitHub. Every write is intercepted; only the three
// documented _github calls (and no install, no /v1/runs) are allowed. The GitHub account, code and catalog are mocked
// exactly per the App Manager contract; no real credential exists anywhere in this test.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const ROOT=process.env.QA_ROOT || path.resolve(__dirname,'..'), OUT=process.env.QA_OUTPUT || path.join(process.env.TMPDIR || '/tmp','store-github-signin');
const HOLD=Number(process.env.QA_HOLD_MS || 5000);   // the delayed backend that proves a tap paints before the answer
const C='a'.repeat(40), origin='https://github-signin.test', DECOY='gho_TESTONLYdecoy', DEVICE='DEVICE-CODE-SECRET';
const catalog=[{id:'public-notes',name:'Public Notes',summary:'Notes from the public App Index.',repo:'example/public-notes',source:'standard',type:'view',commit:C}];
const beta={id:'beta-journal',name:'Friend Journal',summary:'A private app a friend shared on GitHub.',repo:'friend/journal',source:'beta',source_name:'Beta',channel:'standard',private:true,type:'view',commit:'b'.repeat(40),publisher:'friend'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const host=(skin)=>`<!doctype html><html data-skin="${skin}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/wizard-os-home/core/base.css"><link rel="stylesheet" href="/wizard-os-home/skins/sepia/skin.css"><style>html,body{margin:0;width:100%;height:100%;background:var(--bg)}.win{width:100%;height:100%;background:var(--sk-win,var(--bg))}iframe{border:0;width:100%;height:100%;display:block}</style><script>localStorage.setItem('wos.skin','${skin}');</script><script src="/wizard-os-home/core/skins.js"></script><script>window.WizCore={apps:()=>({APPS:[{url:'/wizard-os-home/store/'}]})};window.WosChat={sharePayload:async data=>{window.shared=data;return 'shared'}};</script><script src="/wizard-os-home/core/appearance-host.js"></script><body><div class="win"><iframe src="/wizard-os-home/store/index.html"></iframe></div></body></html>`;
const alpha=c=>{const m=/rgba?\(([^)]+)\)/.exec(c);if(!m)return 1;const p=m[1].split(/[ ,/]+/).filter(Boolean);return p.length>3?Number(p[3]):1;};
(async()=>{
 fs.mkdirSync(OUT,{recursive:true}); const browser=await chromium.launch({headless:true,args:['--no-sandbox']}); const results=[];
 try {for(const skin of ['nebula','sepia'])for(const viewport of [{width:390,height:844},{width:1280,height:800}]){
  const phone=viewport.width===390, tag=`${skin}-${viewport.width}`;
  const context=await browser.newContext({viewport,hasTouch:phone,isMobile:phone,serviceWorkers:'block',permissions:['clipboard-read','clipboard-write']});
  const gh={state:'signed_out',source:'file',login:'friend-tester',failSignout:false}, delay={get:0,start:0,signout:0};
  const log={get:0,start:[],signout:0,search:[],unsafe:[],runs:[],errors:[],gate:[]};
  const status=()=>({state:gh.state,login:gh.state==='signed_in'?gh.login:'',source:gh.source,access_token:DECOY,device_code:DEVICE,
   ...(gh.state==='pending'?{user_code:'WDJB-MJHT',verification_uri:'https://github.com/login/device',expires_in:899,interval:5}:{})});
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.pathname.includes('/v1/runs')){log.runs.push(req.url());return route.abort();}
   if(u.pathname.startsWith('/wizard-os-home/store-install/_github')){
    const sub=u.pathname.slice('/wizard-os-home/store-install/_github'.length);
    if(req.method()==='GET'&&sub===''){log.get++;await sleep(delay.get);return route.fulfill({json:status()});}
    if(req.method()==='POST'&&['/start','/signout'].includes(sub)){
     const h=req.headers();log.gate.push({sub,store:h['x-wizard-store'],type:h['content-type'],body:req.postData()});
     if(sub==='/start'){log.start.push(Date.now());await sleep(delay.start);if(gh.state==='not_configured')return route.fulfill({status:409,json:status()});if(gh.state!=='signed_in')gh.state='pending';return route.fulfill({json:status()});}
     log.signout++;await sleep(delay.signout);if(gh.failSignout)return route.fulfill({status:500,json:{error:'nope'}});gh.state='signed_out';return route.fulfill({json:status()});
    }
   }
   if(!['GET','HEAD'].includes(req.method())){log.unsafe.push(req.method()+' '+u.pathname);return route.abort();}
   if(u.pathname.includes('/store-data/')){
    if(u.pathname.includes('/index/search')){log.search.push(u.search);return route.fulfill({json:{apps:[...catalog,...(gh.state==='signed_in'?[beta]:[])],sources:[],next_offset:null}});}
    if(u.pathname.endsWith('/api/apps/installed'))return route.fulfill({json:{installed:[]}});
    if(u.pathname.endsWith('/wizard/v1/installed-apps'))return route.fulfill({json:{complete:true,wam:[],shell:[]}});
    if(u.pathname.includes('/router/v1/'))return route.fulfill({json:{models:[],connections:[]}});
    return route.fulfill({status:404,json:{error:'Fixture only'}});
   }
   if(u.pathname==='/host')return route.fulfill({contentType:'text/html',body:host(skin)});
   if(u.pathname.startsWith('/wizard-os-home/')){
    const file=path.join(ROOT,'web',decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)));
    if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream',body:fs.readFileSync(file)});
   }
   return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>log.errors.push(e.message));await page.goto(origin+'/host');
  const f=page.frames().find(f=>f.url().includes('/store/index.html'));assert.ok(f);
  await f.waitForFunction(()=>window.__store?.state().loaded&&document.documentElement.dataset.skin);
  assert.equal(await f.evaluate(()=>document.documentElement.dataset.skin),skin);
  const shot=async name=>page.screenshot({path:path.join(OUT,`${tag}-${name}.png`),animations:'disabled'});
  const sheet=()=>f.evaluate(()=>document.getElementById('sheet').innerText);
  const state=()=>f.evaluate(()=>window.__store.state());
  const tap=async sel=>phone?f.locator(sel).tap():f.locator(sel).click();
  const twoFrames=()=>f.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  // First-paint probe: time from the real tap's click dispatch to the sheet's first DOM change.
  const probe=()=>f.evaluate(()=>{window.__p={t0:0,t1:0,text:''};addEventListener('click',()=>{window.__p.t0=performance.now();},{capture:true,once:true});
   new MutationObserver((m,o)=>{if(!window.__p.t1){window.__p.t1=performance.now();window.__p.text=document.getElementById('sheet').innerText;o.disconnect();}}).observe(document.getElementById('sheet'),{childList:true,subtree:true});});
  const painted=async()=>{await f.waitForFunction(()=>window.__p.t1>0);return f.evaluate(()=>({ms:window.__p.t1-window.__p.t0,text:window.__p.text}));};

  // ---- Sources entry: one control next to Refresh, a real touch target
  const box=await f.locator('#sources').boundingBox();assert.ok(box.height>=44,'Sources is a 44px target');
  assert.equal(await f.locator('.top-row #sources').count(),1);assert.equal(await f.locator('.top-row #refresh').count(),1);
  assert.equal(await f.locator('#sheet').isHidden(),true);

  // ---- 1. first open with a 5 s status read: the sheet paints on the tap's own frame
  delay.get=HOLD;await probe();const t0=Date.now();await tap('#sources');
  let p=await painted();assert.ok(p.ms<100,'sheet painted '+p.ms+'ms after the tap');assert.match(p.text,/Checking GitHub sign-in/);
  assert.equal(await f.locator('#sheet').isVisible(),true);assert.ok(Date.now()-t0<HOLD,'painted before the held backend answered');
  await f.waitForFunction(()=>/Sign in to GitHub/.test(document.getElementById('sheet').innerText),null,{timeout:HOLD+4000});delay.get=0;
  assert.match(await sheet(),/appear in Apps under Beta/);assert.match(await sheet(),/all-or-nothing access to private repositories/);
  await shot('signed-out');

  // ---- 2. Sign in with a 5 s backend: pending view on the same frame, then the code
  delay.start=HOLD;const gets0=log.get;await probe();await tap('[data-gh-start]');p=await painted();
  assert.ok(p.ms<100,'pending painted '+p.ms+'ms after the tap');assert.match(p.text,/Getting your code…/);
  assert.equal(await f.locator('[data-gh-start]').isDisabled(),true);assert.equal(await f.locator('.gh-go[aria-busy="true"]').count(),1);
  await f.locator('[data-gh-start]').click({force:true,trial:true}).catch(()=>{});await twoFrames();
  assert.equal(log.start.length,1,'a second tap while pending does not post again');
  await f.locator('[data-gh-code]').waitFor({timeout:HOLD+4000});delay.start=0;
  assert.equal((await f.locator('[data-gh-code]').innerText()).trim(),'WDJB-MJHT');
  const link=f.locator('[data-gh-open]');assert.equal(await link.getAttribute('href'),'https://github.com/login/device');assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);
  assert.deepEqual(log.gate.filter(g=>g.sub==='/start').map(g=>[g.store,g.type,g.body]),[['1','application/json','{}']]);
  const html=await f.evaluate(()=>document.documentElement.outerHTML);assert.ok(!html.includes(DECOY)&&!html.includes(DEVICE),'no token or device code reaches the page');
  await shot('pending');
  // Copy: label changes on the tap, clipboard holds the code
  await tap('[data-gh-copy]');assert.match(await f.locator('[data-gh-copy]').innerText(),/Copied/);
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'WDJB-MJHT');

  // ---- 3. polling: ~2 s cadence, silent while hidden, immediate on return, stops with the sheet
  let g1=log.get;await sleep(4300);const polled=log.get-g1;assert.ok(polled>=1&&polled<=3,'polls in 4.3 s: '+polled);
  await f.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await sleep(300);g1=log.get;await sleep(4300);assert.equal(log.get,g1,'no polling while hidden');
  await f.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await f.waitForFunction(n=>true,0);await sleep(250);assert.ok(log.get>g1,'reads again as soon as the page is visible');
  assert.equal((await state()).github.polling,true);

  // ---- 4. live skin change while the sheet is open (real host → Appearance v1)
  const other=skin==='nebula'?'sepia':'nebula';
  const look=()=>f.evaluate(()=>{const p=document.querySelector('.gh-panel'),c=getComputedStyle(p);return {skin:document.documentElement.dataset.skin,bg:c.backgroundColor,img:c.backgroundImage,ink:getComputedStyle(document.querySelector('.gh-panel h3')).color,raised:getComputedStyle(document.documentElement).getPropertyValue('--wz-surface-raised').trim()};});
  const before=await look();assert.equal(alpha(before.bg),1,'panel is opaque');
  await page.evaluate(id=>WosSkin.set(id),other);await f.waitForFunction(s=>document.documentElement.dataset.skin===s,other);await twoFrames();
  const after=await look();assert.equal(after.skin,other);assert.equal(alpha(after.bg),1,'still opaque after the skin change');
  assert.notDeepEqual([before.bg,before.img,before.raised],[after.bg,after.img,after.raised],'panel follows the live skin');
  assert.match(await f.locator('[data-gh-code]').innerText(),/WDJB-MJHT/);await shot('pending-live-'+other);
  await page.evaluate(id=>WosSkin.set(id),skin);await f.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);

  // ---- 5. approval on GitHub: the poll sees signed_in, Store refreshes with refresh=1, Beta app appears with no reload
  const marker=await f.evaluate(()=>window.__qaDocument=String(Math.random()));
  const searches0=log.search.length;gh.state='signed_in';
  await f.waitForFunction(()=>/Signed in as/.test(document.getElementById('sheet').innerText),null,{timeout:6000});
  assert.match(await f.locator('[data-gh-who]').innerText(),/^Signed in as friend-tester$/);
  assert.equal(await f.locator('[data-gh-code]').count(),0);
  await f.waitForFunction(n=>true,0);await sleep(400);
  assert.ok(log.search.slice(searches0).some(s=>/refresh=1/.test(s)),'catalog refreshed with refresh=1');
  assert.equal(await f.evaluate(()=>window.__qaDocument),marker,'no reload');
  assert.ok(!(await sheet()).match(/gho_|token/i));
  await shot('signed-in');
  g1=log.get;await sleep(3000);assert.equal(log.get,g1,'polling stops once signed in');
  // Back pops exactly the sheet; the list shows the Beta app
  assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true);assert.equal(await f.locator('#sheet').isHidden(),true);
  await f.locator('[data-kind="apps"]').click();await f.locator('#results .row').nth(1).waitFor();
  assert.match(await f.locator('#results').innerText(),/Friend Journal/);assert.equal(await f.locator('#results [data-app^="beta-journal|"] [data-source="beta"]').count(),1);
  await shot('beta-list');

  // ---- 6. nested Back: list → Sources → Back → list → Back → root → Back consumed by the shell
  await tap('#sources');await f.locator('[data-gh-out]').waitFor();assert.deepEqual((await state()).layers,['list','sheet']);
  assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true);assert.deepEqual((await state()).layers,['list']);assert.equal(await f.locator('#results').isVisible(),true);
  assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true);assert.deepEqual((await state()).layers,[]);
  assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),false);assert.equal(await f.locator('#discover').isVisible(),true);
  // Escape closes it; a tap inside the panel keeps it; a tap outside (blank sheet area / header) closes it like Back.
  await tap('#sources');await f.locator('[data-gh-out]').waitFor();await f.keyboard.press('Escape');assert.deepEqual((await state()).layers,[]);
  await tap('#sources');await f.locator('[data-gh-out]').waitFor();await tap('.gh-panel h3');assert.deepEqual((await state()).layers,['sheet']);
  const pb=await f.locator('.gh-panel').boundingBox();
  const outside=phone?[8,Math.min(viewport.height-20,pb.y+pb.height+80)]:[viewport.width-20,viewport.height-40];
  if(phone)await page.touchscreen.tap(...outside);else await page.mouse.click(...outside);
  await f.waitForFunction(()=>window.__store.state().layers.length===0);
  await tap('#sources');await f.locator('[data-gh-out]').waitFor();
  await tap('.top-row h1');await f.waitForFunction(()=>window.__store.state().layers.length===0);
  await tap('#sources');await f.locator('[data-gh-out]').waitFor();await tap('#sources');assert.deepEqual((await state()).layers,['sheet'],'Sources while open does not stack a second sheet');

  // ---- 7. Sign out: paints signed-out on the tap with a 5 s backend; failure rolls back with a toast; success refreshes
  gh.failSignout=true;delay.signout=HOLD;await probe();const s0=log.search.length;await tap('[data-gh-out]');p=await painted();
  assert.ok(p.ms<100,'sign-out painted '+p.ms+'ms after the tap');assert.match(p.text,/Sign in to GitHub/);assert.doesNotMatch(p.text,/Signed in as/);
  await f.waitForFunction(()=>/Signed in as/.test(document.getElementById('sheet').innerText),null,{timeout:HOLD+4000});
  assert.match(await f.locator('#toast').innerText(),/Couldn’t sign out/);assert.equal(log.search.length,s0,'a failed sign-out does not refresh');
  gh.failSignout=false;await probe();await tap('[data-gh-out]');p=await painted();assert.match(p.text,/Sign in to GitHub/);
  await f.waitForFunction(()=>window.__store.state().github.busy==='',null,{timeout:HOLD+4000});delay.signout=0;
  await f.waitForFunction(n=>true,0);await sleep(500);assert.ok(log.search.slice(s0).some(s=>/refresh=1/.test(s)),'sign-out refreshes the catalog');
  assert.match(await sheet(),/Sign in to GitHub/);
  assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true);await f.locator('[data-kind="apps"]').click();await f.locator('#results .row').first().waitFor();
  assert.doesNotMatch(await f.locator('#results').innerText(),/Friend Journal/);await f.evaluate(()=>window.__wizardCloseOverlay());

  // ---- 8. other states: env sign-in, not configured, expired/denied/error, old App Manager
  gh.state='signed_in';gh.source='env';await tap('#sources');await f.locator('[data-gh-who]').waitFor();
  assert.equal(await f.locator('[data-gh-out]').count(),0);assert.match(await sheet(),/can’t be removed here/);await f.evaluate(()=>window.__wizardCloseOverlay());
  gh.source='file';gh.state='not_configured';await tap('#sources');await f.waitForFunction(()=>/isn’t set up on this WizardOS yet/.test(document.getElementById('sheet').innerText));
  assert.equal(await f.locator('#sheet button.get, #sheet [data-gh-start]').count(),0);await shot('not-configured');await f.evaluate(()=>window.__wizardCloseOverlay());
  for(const [st,re] of [['expired',/code expired/],['denied',/cancelled/],['error',/couldn’t reach GitHub/]]){
   gh.state=st;await tap('#sources');await f.waitForFunction(r=>new RegExp(r).test(document.getElementById('sheet').innerText),re.source);
   assert.equal(await f.locator('[data-gh-start]').innerText(),'Try again');
   if(st==='expired'){gh.state='signed_out';await tap('[data-gh-start]');await f.locator('[data-gh-code]').waitFor();gh.state='signed_out';}
   await f.evaluate(()=>window.__wizardCloseOverlay());
  }
  assert.equal(log.start.length,2);
  // ---- 9. nothing else happened
  assert.deepEqual(log.unsafe,[]);assert.deepEqual(log.runs,[]);assert.deepEqual(log.errors,[]);
  for(const g of log.gate)assert.deepEqual([g.store,g.type,g.body],['1','application/json','{}']);
  assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  results.push({skin,viewport,starts:log.start.length,signouts:log.signout,polls:log.get,unsafeWrites:log.unsafe.length,runs:log.runs.length,pageErrors:log.errors});
  await context.close();
 }
 // Standalone Store (no host): dark fallbacks, opaque panel.
 {const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:'block'});
  await context.route('**/*',async route=>{const u=new URL(route.request().url());
   if(u.pathname.startsWith('/wizard-os-home/store-install/_github'))return route.fulfill({json:{state:'signed_in',login:'friend-tester',source:'file'}});
   if(u.pathname.includes('/store-data/')){if(u.pathname.includes('/index/search'))return route.fulfill({json:{apps:catalog,sources:[],next_offset:null}});if(u.pathname.endsWith('/api/apps/installed'))return route.fulfill({json:{installed:[]}});if(u.pathname.endsWith('/wizard/v1/installed-apps'))return route.fulfill({json:{complete:true,wam:[],shell:[]}});return route.fulfill({status:404,json:{}});}
   if(u.pathname.startsWith('/wizard-os-home/')){const file=path.join(ROOT,'web',decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)));if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(file)});}
   return route.abort();});
  const page=await context.newPage();await page.goto(origin+'/wizard-os-home/store/index.html');await page.waitForFunction(()=>window.__store?.state().loaded);
  await page.locator('#sources').tap();await page.locator('[data-gh-out]').waitFor();
  const c=await page.evaluate(()=>{const p=getComputedStyle(document.querySelector('.gh-panel'));return {bg:p.backgroundColor,ink:p.color};});
  assert.equal(alpha(c.bg),1);assert.notEqual(c.bg,c.ink);await page.screenshot({path:path.join(OUT,'standalone-390-signed-in.png'),animations:'disabled'});
  results.push({standalone:true,bg:c.bg,ink:c.ink});await context.close();}
 }finally{await browser.close();}
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:results.length,results},null,2));console.log(JSON.stringify({passed:results.length,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
