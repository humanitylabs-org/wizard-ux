// Fixture-only browser proof. All writes are intercepted; only the exact link install is permitted.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const ROOT=process.env.QA_ROOT || path.resolve(__dirname,'..'), OUT=process.env.QA_OUTPUT || path.join(process.env.TMPDIR,'store-sources');
const C='a'.repeat(40), origin='https://sources.test';
const catalog=[{id:'public-notes',name:'Public Notes',summary:'Notes from the public App Index.',repo:'example/public-notes',source:'standard',type:'view',commit:C},{id:'beta-reader',name:'Beta Reader',summary:'An early release shared by its publisher.',repo:'example/beta-reader',source:'owner-private',private:true,publisher:'Jane',type:'view',commit:C}];
const registry=[{id:'airlock',name:'Airlock',summary:'A local app on this Wizard.',repo:'local/airlock',source:'local',type:'view',status:'running'},{id:'linked-app',name:'Shared Library',summary:'Installed from a share link.',repo:'example/linked-app',source:'link',type:'view',commit:C,status:'running'}];
const preview={id:'shared-tool',name:'Shared Journal',summary:'A private journal shared directly with you.',repo:'example/shared-tool',type:'view',version:'1.0.0',commit:C,source:'link',publisher:'Jane'};
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});const browser=await chromium.launch({headless:true,args:['--no-sandbox']}); const results=[];
 try {for(const skin of ['nebula','sepia'])for(const viewport of [{width:390,height:844},{width:1280,height:800}]){
  const context=await browser.newContext({viewport,hasTouch:viewport.width===390,isMobile:viewport.width===390,serviceWorkers:'block'});
  let posts=[],unsafe=[],runs=[],errors=[],installed=[],fail='';
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.pathname.includes('/v1/runs')){runs.push(req.url());return route.abort();}
   if(!['GET','HEAD'].includes(req.method())){
    if(u.pathname==='/wizard-os-home/store-install/shared-tool' && req.method()==='POST'){
     const body=req.postDataJSON(), expected={source:'link',repo:preview.repo,commit:C,operation:'install'};assert.deepEqual(body,expected);posts.push(body);
     if(fail==='denied')return route.fulfill({status:403,json:{error:'Only the owner can install this app.'}});
     if(fail==='receipt')return route.fulfill({json:{app:preview.id,state:'installed',selection:{...expected,commit:'b'.repeat(40)}}});
     installed=[{...preview,status:'running'}];return route.fulfill({json:{app:preview.id,state:'installed',selection:expected}});
    }
    unsafe.push(req.method()+' '+u.pathname);return route.abort();
   }
   if(u.pathname.includes('/store-data/')){
    if(u.pathname.includes('/index/search'))return route.fulfill({json:{apps:catalog,sources:[],next_offset:null}});
    if(u.pathname.endsWith('/api/apps/installed'))return route.fulfill({json:{installed:[]}});
    if(u.pathname.endsWith('/wizard/v1/installed-apps'))return route.fulfill({json:{complete:true,wam:[...registry,...installed],shell:[]}});
    if(u.pathname.endsWith('/wizard/v1/architecture'))return route.fulfill({json:{architecture:'amd64'}});
    if(u.pathname.endsWith('/wizard/v1/link'))return route.fulfill({json:preview});
    if(u.pathname.includes('/router/v1/'))return route.fulfill({json:{models:[],connections:[]}});
    return route.fulfill({status:404,json:{error:'Fixture only'}});
   }
   if(u.pathname==='/host')return route.fulfill({contentType:'text/html',body:`<!doctype html><html data-skin="${skin}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/wizard-os-home/core/base.css">${skin==='sepia'?'<link rel="stylesheet" href="/wizard-os-home/skins/sepia/skin.css">':''}<style>html,body{margin:0;width:100%;height:100%;background:var(--bg)}.win{width:100%;height:100%;background:var(--sk-win,var(--bg))}iframe{border:0;width:100%;height:100%;display:block}</style><script>localStorage.setItem('wos.skin','${skin}');</script><script src="/wizard-os-home/core/skins.js"></script><script>window.WizCore={apps:()=>({APPS:[{url:'/wizard-os-home/store/'}]})};window.WosChat={sharePayload:async data=>{window.shared=data;return 'shared'}};</script><script src="/wizard-os-home/core/appearance-host.js"></script><body><div class="win"><iframe src="/wizard-os-home/store/index.html"></iframe></div></body></html>`});
   if(u.pathname.startsWith('/wizard-os-home/')){
    const file=path.join(ROOT,'web',decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)));
    if(fs.existsSync(file) && fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream',body:fs.readFileSync(file)});
   }
   return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/host');
  const f=page.frames().find(f=>f.url().includes('/store/index.html')); assert.ok(f);
  await f.waitForFunction(()=>window.__store?.state().loaded && document.documentElement.dataset.skin).catch(async e=>{console.error({errors,body:await f.locator('body').innerText(),appearance:await page.evaluate(()=>window.WizAppearance?.inspect())});throw e;});
  assert.equal(await f.evaluate(()=>document.documentElement.dataset.skin),skin);
  await f.locator('[data-kind="apps"]').click();await f.locator('.row').last().waitFor();
  for(const label of ['Public','Beta','Local','Link'])assert.ok((await f.locator('#results').innerText()).includes(label),label);
  const shot=async name=>{await page.screenshot({path:path.join(OUT,`${skin}-${viewport.width}-${name}.png`),animations:'disabled'});};
  await shot('sources');
  await f.locator('#q').fill('airlock');await f.locator('#results [data-source="local"]').waitFor();await f.locator('#results [data-back]').click();
  await f.locator('#results [data-app^="beta-reader|"]').click();await f.locator('[data-share]').click();
  assert.equal((await page.evaluate(()=>window.shared)).text,'wizard://install?repo=github.com%2Fexample%2Fbeta-reader&commit='+C);
  const url='wizard://install?repo=example/shared-tool&commit='+C+'&from=Jane';
  await f.evaluate(url=>window.__store.openInstallLink(url),url);await f.locator('[data-link-install]').waitFor();
  await shot('link-sheet');assert.match(await f.locator('#sheet').innerText(),/Not in the catalog.*Shared with you by Jane/);
  await f.locator('#sheet [data-back]').click();assert.equal(await f.locator('#detail h2').innerText(),'Beta Reader');
  await f.locator('#detail [data-back]').click();await f.locator('#results [data-back]').click();
  assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true);assert.equal(await f.locator('#discover').isVisible(),true);
  await f.evaluate(url=>window.__store.openInstallLink(url),url);await f.locator('[data-link-install]').waitFor();await f.locator('#sheet [data-back]').click();assert.equal(await f.locator('#discover').isVisible(),true);
  await f.evaluate(()=>window.__store.openInstallLink('wizard://unknown?repo=example/shared-tool'));await f.locator('.link-error').waitFor();assert.match(await f.locator('.link-error').innerText(),/This install link isn't valid:/);await shot('bad-link');await f.locator('#sheet [data-back]').click();
  // Failure/receipt paths must leave the review in place; no optimistic installed state.
  await f.evaluate(url=>window.__store.openInstallLink(url),url);
  for(const mode of ['denied','receipt','success']){
   fail=mode;await f.locator('[data-link-install]').click();
   await f.waitForFunction(()=>window.__store.state().busy===0);
   if(mode==='denied')assert.match(await f.locator('.link-error').innerText(),/Only the owner/);
   else if(mode==='receipt')assert.match(await f.locator('.link-error').innerText(),/different release/);
   else {assert.match(await f.locator('#toast').innerText(),/is ready/);assert.equal(await f.locator('#sheet [data-link-install]').count(),0);assert.equal(await f.locator('.link-error').count(),0);}
  }
  await f.locator('#sheet [data-back]').click();
  assert.equal(posts.length,3);assert.deepEqual(unsafe,[]);assert.deepEqual(runs,[]);assert.deepEqual(errors,[]);
  assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  results.push({skin,viewport,installPosts:posts.length,unsafeWrites:unsafe.length,runs:runs.length,pageErrors:errors});await context.close();
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:results.length,results},null,2));console.log(JSON.stringify({passed:results.length,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
