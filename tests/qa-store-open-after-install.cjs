// Store Open right after an install (issue 1652): fixture-only browser proof. This tree's web/ is served from disk,
// every Store read is a fixture and every write is refused. The host page stands in for the shell: its app list
// learns the new app's address only a few seconds after the Store loaded (the registry lag James hit), and only when
// someone asks it again (WizCore.refreshApps), the way core/apps.js loadRemote works.
//   node tests/qa-store-open-after-install.cjs                 candidate: Starting… turns into Open by itself
//   QA_MODE=baseline QA_ROOT=<main tree> node tests/qa-store-open-after-install.cjs   before shots (passive pill)
// Env: QA_OUTPUT=<dir> (default: <tmp>/store-open-qa).
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const ROOT=process.env.QA_ROOT || path.resolve(__dirname,'..'), OUT=process.env.QA_OUTPUT || path.join(os.tmpdir(),'store-open-qa');
const BASELINE=process.env.QA_MODE==='baseline', origin='https://store-open.test', C='c'.repeat(40);
const tracker={id:'wizardos-tracker',name:'WizardOS Tracker',summary:'Goals, bugs and features of WizardOS in one place.',repo:'humanitylabs-org/wizardos-tracker',version:'0.39.2',commit:C,source:'standard',source_name:'Standard',channel:'standard',type:'view',category:'app',tags:['work'],publisher:'humanitylabs-org',uses:[],provides:[]};
const helperBg={id:'quiet-helper',name:'Quiet Helper',summary:'Works in the background for your agent.',repo:'example/quiet-helper',version:'1.0.0',commit:C,source:'standard',source_name:'Standard',channel:'standard',type:'service',category:'tool',tags:['work'],publisher:'example',uses:[],provides:[]};
const catalog=[tracker,helperBg].map(a=>({...a,releases:[{...a}]}));
const READY_MS=5000;
const VIEWPORTS=[{width:390,height:844,touch:true},{width:1280,height:800,touch:false}];
const SKINS=[{id:'nebula',css:''},{id:'obsidian-light',css:'/wizard-os-home/skins/obsidian/skin.css'}];
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}); const results=[];
 try { for(const skin of SKINS) for(const vp of VIEWPORTS) {
  const tag=`${BASELINE?'before':'after'}-${skin.id}-${vp.width}`;
  const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},hasTouch:vp.touch,isMobile:vp.touch,serviceWorkers:'block'});
  const errors=[], unsafe=[];
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;
   if(!['GET','HEAD'].includes(req.method())) { unsafe.push(req.method()+' '+p); return route.abort(); }
   if(p.includes('/store-data/')) {
    if(p.includes('/index/search')) return route.fulfill({json:{apps:catalog,sources:[{id:'standard',name:'Standard',stale:false}],next_offset:null}});
    if(p.endsWith('/api/apps/installed')) return route.fulfill({json:{installed:catalog.map(a=>({info:{id:a.id,urn:a.id+':wizardapps'},app:{status:'running'}}))}});
    // The Store's own snapshot was taken while the app was still starting: no address for it yet.
    if(p.endsWith('/wizard/v1/installed-apps')) return route.fulfill({json:{architecture:'amd64',complete:true,unavailable:[],
      wam:catalog.map(a=>({id:a.id,repo:a.repo,commit:C,version:a.version,status:'running',source:'standard',type:a.type})),shell:[]}});
    if(p.includes('/router/v1/')) return route.fulfill({json:{models:[],services:[],providers:[]}});
    return route.fulfill({status:404,json:{error:'fixture_only'}});
   }
   if(p==='/host') return route.fulfill({contentType:'text/html',body:`<!doctype html><html data-skin="${skin.id}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/wizard-os-home/core/base.css">${skin.css?`<link rel="stylesheet" href="${skin.css}">`:''}<style>html,body{margin:0;width:100%;height:100%;background:var(--bg)}.win{width:100%;height:100%;background:var(--sk-win,var(--bg))}iframe{border:0;width:100%;height:100%;display:block}</style><script>localStorage.setItem('wos.skin','${skin.id}');window.opened=[];window.refreshes=0;window.readyAt=Date.now()+${READY_MS};window.ready=false;
addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='wizard:open-app')window.opened.push(e.data.id);});</script><script src="/wizard-os-home/core/skins.js"></script><script>
window.WizCore={apps:()=>({APPS:[{url:'/wizard-os-home/store/'}]}),refreshApps:async()=>{window.refreshes++;if(!window.ready&&Date.now()>=window.readyAt){window.ready=true;dispatchEvent(new CustomEvent('wizard:apps'));}return true;}};
window.WizCanOpen=id=>window.ready&&id==='wizardos-tracker';</script><script src="/wizard-os-home/core/appearance-host.js"></script><body><div class="win"><iframe src="/wizard-os-home/store/index.html"></iframe></div></body></html>`});
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
  const label=sel=>f.locator(sel).first().innerText();
  // Search row, then the detail page, while the shell has no address for the app yet.
  await f.fill('#q','Wizardos'); await f.locator('.row[data-app^="wizardos-tracker|"]').waitFor();
  const rowEarly=await label('.row[data-app^="wizardos-tracker|"] .get');
  await shot('search-early');
  await tap(f.locator('.row[data-app^="wizardos-tracker|"] .tx')); await f.locator('#detail .d-hero').waitFor();
  const detailEarly=await label('#detail .d-hero .get');
  await shot('detail-early');
  const out={tag,rowEarly,detailEarly};
  if(BASELINE) {
   // Expected on untouched main: the passive pill, and it stays after the shell could open the app.
   assert.match(rowEarly,/Installed/); assert.match(detailEarly,/Installed/);
   await page.waitForTimeout(READY_MS+4000);
   out.detailLater=await label('#detail .d-hero .get'); assert.match(out.detailLater,/Installed/);
   assert.equal(await f.locator('#detail [data-open]').count(),0);
   await shot('detail-later');
  } else {
   assert.equal(rowEarly,'Starting…'); assert.equal(detailEarly,'Starting…');
   assert.doesNotMatch(await f.locator('#detail .d-hero').innerText(),/✓ Installed/);
   // No reload, no focus change: the Store asks the shell again and Starting… becomes Open by itself.
   await f.locator('#detail .d-hero [data-open="wizardos-tracker"]').waitFor({timeout:READY_MS+15000});
   out.detailLater=await label('#detail .d-hero .get'); assert.equal(out.detailLater,'Open');
   out.refreshes=await page.evaluate(()=>window.refreshes); assert.ok(out.refreshes>=1 && out.refreshes<=8,'backoff, not a busy loop: '+out.refreshes);
   const look=await f.evaluate(()=>{const o=document.querySelector('#detail .d-hero [data-open]'),cs=getComputedStyle(o);return {bg:cs.backgroundColor,w:o.getBoundingClientRect().width};});
   assert.notEqual(look.bg,'rgba(0, 0, 0, 0)','Open is a filled button'); out.look=look;
   await shot('detail-later');
   await tap(f.locator('#detail .d-hero [data-open="wizardos-tracker"]'));
   await page.waitForFunction(()=>window.opened.includes('wizardos-tracker'));
   await tap(f.locator('#detail [data-back]')); await f.locator('.row[data-app^="wizardos-tracker|"] [data-open]').waitFor();
   out.rowLater=await label('.row[data-app^="wizardos-tracker|"] .get'); assert.equal(out.rowLater,'Open');
   // A screenless agent app has nothing to open: it keeps the quiet Installed pill, never Starting….
   await f.fill('#q','Quiet'); await f.locator('.row[data-app^="quiet-helper|"]').waitFor();
   out.background=await label('.row[data-app^="quiet-helper|"] .get'); assert.match(out.background,/Installed/);
   await f.fill('#q','Wizardos'); await f.locator('.row[data-app^="wizardos-tracker|"] [data-open]').waitFor();
   await shot('search-later');
  }
  assert.deepEqual(errors,[]); assert.deepEqual(unsafe,[]);
  results.push(out); await context.close();
 } } finally { await browser.close(); }
 fs.writeFileSync(path.join(OUT,`${BASELINE?'before':'after'}.json`),JSON.stringify(results,null,1));
 console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1);});
