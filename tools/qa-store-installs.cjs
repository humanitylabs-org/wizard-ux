// Safe real-browser A/B: every write intercepted, service workers disabled.
// Usage: NODE_PATH=<playwright-core parent> node tools/qa-store-installs.cjs [origin] [candidate store.js]
const {chromium}=require('playwright-core');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
(async()=>{
 const origin=process.argv[2]||'http://127.0.0.1:8796';
 const candidate=process.argv[3];
 const output=process.env.QA_OUTPUT||path.join(process.env.TMPDIR||require('node:os').tmpdir(),'store-browser-evidence'); fs.mkdirSync(output,{recursive:true});
 const control=execFileSync('git',['show','1edfe29a07c352a86102cff79953d0e29103c36d:web/store/store.js'],{encoding:'utf8'});
 const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const results=[];
 try {
 for(const scenario of ['control-private','private-install','standard-install','alpha-install','private-update','alpha-switch','wrong-receipt','denied','unavailable']) {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}); const page=await context.newPage();
  const alpha=scenario.startsWith('alpha'); const standard=scenario.startsWith('standard');
  const a={id:'messenger',name:'Messenger',summary:'Safe intercepted browser fixture',repo:'example/messenger',version:'0.2.0',commit:'a'.repeat(40),source:alpha?'wizard-alpha':standard?'standard':'owner-private',source_name:alpha?'Wizard Alpha':standard?'Standard':'Private test',channel:alpha?'alpha':'standard',private:!standard,type:'view',uses:[],provides:[]};
  const old={...a,commit:'b'.repeat(40),version:'0.1.0',source:scenario==='alpha-switch'?'standard':a.source,channel:'standard',status:'running'};
  const operation=scenario==='private-update'?'update':scenario==='alpha-switch'?'switch':'install';
  let installed=operation==='install'?[]:[old], requests=[],unsafe=[];
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/store/store-status.js') && candidate) return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(path.dirname(candidate),'store-status.js'),'utf8')});
   if(url.pathname.endsWith('/store/store.js') && (scenario.startsWith('control')||candidate)) return route.fulfill({contentType:'text/javascript',body:scenario.startsWith('control')?control:fs.readFileSync(candidate,'utf8')});
   if(url.pathname.includes('/store-install/')) {
    if(req.method()==='POST') requests.push(req.postDataJSON());
    if(scenario==='unavailable') return route.fulfill({status:404,contentType:'text/html',body:'not found'});
    if(scenario==='denied') return route.fulfill({status:403,json:{error:'only the box owner can install from the Store'}});
    const selection={source:a.source,repo:a.repo,commit:a.commit,operation};
    if(scenario==='wrong-receipt') selection.commit='c'.repeat(40);
    installed=[{...a,status:'running'}];
    return route.fulfill({json:{app:a.id,state:'installed',selection}});
   }
   if(req.method()!=='GET') {unsafe.push(req.method()+' '+url.pathname);return route.abort();}
   if(url.pathname.includes('/store-data/')) {
    if(url.pathname.includes('/index/search')) return route.fulfill({json:{apps:[{...a,releases:operation==='switch'?[old,a]:[a]}],sources:[],next_offset:null}});
    if(url.pathname.endsWith('/api/apps/installed')) return route.fulfill({json:{installed:[]}});
    if(url.pathname.endsWith('/wizard/v1/installed-apps')) return route.fulfill({json:{wam:installed,shell:[],complete:true}});
    return route.fulfill({status:404,json:{error:'fixture_not_found'}});
   }
   return route.continue();
  });
  await page.goto(origin+'/wizard-os-home/store/index.html?app=messenger',{waitUntil:'load'});
  if(operation==='switch') await page.selectOption('#release-choice',a.source+':'+a.commit);
  await page.locator('#detail [data-get]').click();
  await page.waitForFunction(()=>!document.getElementById('toast').hidden);
  const toast=await page.locator('#toast').innerText();
  if(scenario.startsWith('control')) {assert.match(toast,/Ask your agent/);assert.equal(requests.length,0);}
  else {
   assert.deepEqual(requests,[{source:a.source,repo:a.repo,commit:a.commit,operation}]);
   assert.doesNotMatch(toast,/Ask your agent|Copy request/);
   if(scenario==='wrong-receipt') assert.match(toast,/different release/);
   else if(scenario==='denied') assert.match(toast,/only the box owner/);
   else if(scenario==='unavailable') assert.match(toast,/needs updating/);
   else assert.match(toast,/is ready/);
  }
  assert.deepEqual(unsafe,[]);
  await page.screenshot({path:path.join(output,scenario+'.png'),fullPage:true});
  results.push({scenario,requests,toast,unsafeWrites:unsafe.length}); await context.close();
 }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({origin,candidate:!!candidate,results},null,2));
 console.log(JSON.stringify({origin,passed:results.length,results},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
