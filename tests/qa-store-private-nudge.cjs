// Install sheet recommends private AI (wizard-ux issue 1802; on for everyone, its switch was removed): fixture-only browser proof.
// This tree's web/ is served from disk; the host page stands in for the shell (a WosModels stand-in says the owner's standard AI is Claude, a WosPrivacy stand-in records the switch-over it is
// asked to open) and a fake box answers the Store's reads plus the two writes this flow makes: the install and the
// app's agents (PUT /wizard/v1/apps/<id>/agents). Every other write is refused.
//   node tests/qa-store-private-nudge.cjs                    every case below
//   QA_WEB=<other tree>/web                                  serve another tree (main) for the before shots
// Env: QA_OUT=<dir> (default <tmp>/store-private-nudge), QA_SKINS=nebula,obsidian-light, QA_WIDTH=412.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const WEB=process.env.QA_WEB || path.resolve(__dirname,'..','web'), OUT=process.env.QA_OUT || path.join(os.tmpdir(),'store-private-nudge');
const origin='https://store-nudge.test', C='c'.repeat(40), W=Number(process.env.QA_WIDTH||412);
const SKINS=(process.env.QA_SKINS||'nebula,obsidian-light').split(',').map(id=>({id,css:id.startsWith('obsidian')?'/wizard-os-home/skins/obsidian/skin.css':''}));
const listing=(id,name,summary)=>({id,name,summary,repo:'humanitylabs-org/'+id,version:'1.0.0',commit:C,source:'standard',source_name:'Standard',channel:'standard',type:'view',category:'app',tags:['work'],publisher:'humanitylabs-org',uses:[],provides:[]});
// Messenger here declares personal data (privacy: private), as the issue's acceptance assumes; Tracker declares nothing.
const APPS=[listing('messenger','Messenger','Your chats in one place.'),listing('wizard-mail','Mail','One inbox for your accounts.'),listing('wizard-notes','Notes','A private Markdown vault.'),listing('wizardos-tracker','WizardOS Tracker','Goals, bugs and features.')];
const PERSONAL=new Set(['messenger','wizard-notes']);
// Mail declares personal data with the label only (wizard-os#929: `personal_data: reads your email`): it stays a
// standard app, so it starts on the main agent like any app, and the card names what it reads.
const LABELLED=new Map([['wizard-mail','reads your email']]);
const MAIN={id:'hermes',label:'Wizard',privacy:'standard',is_default:true}, PRIV={id:'private',label:'Private',privacy:'private',is_default:false};
const CASES=[
 {name:'standard',app:'messenger',agents:[MAIN],tap:'standard'},        // Use Claude for now -> on the standard agent
 {name:'private',app:'messenger',agents:[MAIN],tap:'setup'},            // Set up private AI -> switch-over -> on the private agent
 {name:'no-declaration',app:'wizardos-tracker',agents:[MAIN]},           // not personal: no card
 {name:'has-private',app:'wizard-notes',agents:[MAIN,PRIV]},             // a private agent already: no card
 {name:'label-standard',app:'wizard-mail',agents:[MAIN],tap:'standard'},  // label only: card with its line; keep on Claude
 {name:'label-private',app:'wizard-mail',agents:[MAIN],tap:'setup'},      // label only: switch-over moves it to private
 {name:'label-has-private',app:'wizard-mail',agents:[MAIN,PRIV]},        // label only, a private agent already: no card
];
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}); const results=[];
 try { for(const skin of SKINS) for(const c of CASES) {
  const tag=`${skin.id}-${c.name}`;
  const context=await browser.newContext({viewport:{width:W,height:900},hasTouch:true,isMobile:true,serviceWorkers:'block'});
  const errors=[], unsafe=[], puts=[];
  // The fake box: which apps are installed and which agents can use each.
  const box={installed:new Set(), agents:c.agents.map(a=>({...a})), grants:new Map()};
  const view=id=>{const priv=PERSONAL.has(id), has=box.agents.some(a=>a.privacy==='private');
   if(!box.grants.has(id)) box.grants.set(id,new Set(box.agents.filter(a=>priv?a.privacy==='private':a.id==='hermes').map(a=>a.id)));
   const lab=LABELLED.has(id)?{personal_data:true,personal_data_reads:LABELLED.get(id)}:{};
   return {app_id:id,kind:'wizard_apps',privacy:priv?'private':'standard',...(priv?{needs_private_agent:!has}:{}),...lab,agents:box.agents.map(a=>({...a,enabled:box.grants.get(id).has(a.id)}))};};
  await context.exposeBinding('qaSwitchOver',()=>{ // what the real switch-over ends with: a private agent that has the app
   if(!box.agents.some(a=>a.privacy==='private')) box.agents.push({...PRIV});
   for(const id of PERSONAL) if(box.grants.has(id)) box.grants.get(id).add('private');
   for(const id of LABELLED.keys()) if(box.grants.has(id)) { box.grants.get(id).delete('hermes'); box.grants.get(id).add('private'); }
  });
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),p=u.pathname,m=req.method();
   const ag=/^\/wizard\/v1\/apps\/([a-z0-9-]+)\/agents$/.exec(p);
   if(ag) {
    if(!box.installed.has(ag[1])) return route.fulfill({status:404,json:{error:'app_not_found',check:'app.id'}});
    if(m==='PUT') { const body=JSON.parse(req.postData()||'{}'); puts.push({app:ag[1],agents:body.agents}); box.grants.set(ag[1],new Set(body.agents)); }
    else if(m!=='GET') { unsafe.push(m+' '+p); return route.abort(); }
    return route.fulfill({json:view(ag[1])});
   }
   const inst=/\/store-install\/([a-z0-9-]+)$/.exec(p);
   if(inst && m==='POST') { const sel=JSON.parse(req.postData()||'{}'); box.installed.add(inst[1]); return route.fulfill({json:{state:'installed',selection:sel}}); }
   if(inst) return route.fulfill({status:404,json:{error:'no_job'}});
   if(p.includes('/store-data/')) {
    if(m!=='GET') { unsafe.push(m+' '+p); return route.abort(); }
    if(p.includes('/index/search')) return route.fulfill({json:{apps:APPS.map(a=>({...a,releases:[{...a}]})),sources:[{id:'standard',name:'Standard',stale:false}],next_offset:null}});
    const mine=APPS.filter(a=>box.installed.has(a.id));
    if(p.endsWith('/api/apps/installed')) return route.fulfill({json:{installed:mine.map(a=>({info:{id:a.id,urn:a.id+':wizardapps'},app:{status:'running'}}))}});
    if(p.endsWith('/wizard/v1/installed-apps')) return route.fulfill({json:{architecture:'amd64',complete:true,unavailable:[],wam:mine.map(a=>({id:a.id,repo:a.repo,commit:C,version:a.version,status:'running',source:'standard',type:a.type})),shell:[]}});
    if(p.includes('/router/v1/')) return route.fulfill({json:{models:[],services:[],providers:[]}});
    return route.fulfill({status:404,json:{error:'fixture_only'}});
   }
   if(m!=='GET') { unsafe.push(m+' '+p); return route.abort(); }
   if(p==='/host') return route.fulfill({contentType:'text/html',body:`<!doctype html><html data-skin="${skin.id}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/wizard-os-home/core/base.css">${skin.css?`<link rel="stylesheet" href="${skin.css}">`:''}<style>html,body{margin:0;width:100%;height:100%;background:var(--bg)}.win{width:100%;height:100%;background:var(--sk-win,var(--bg))}iframe{border:0;width:100%;height:100%;display:block}</style><script>localStorage.setItem('wos.skin','${skin.id}');window.routes=[];window.privacy=[];
addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='wizard:app-route')window.routes.push(e.data);});
window.WosModels={ready:true,load:async()=>[],defaultOption:()=>({value:'claude-opus-4-6',provider:'anthropic',isGlobalDefault:true})};
window.WosPrivacy={on:()=>true,open:async at=>{window.privacy.push(at);if(at==='setup')setTimeout(()=>window.qaSwitchOver(),1500);return true;}};</script><script src="/wizard-os-home/core/skins.js"></script><script>
window.WizCore={apps:()=>({APPS:[{url:'/wizard-os-home/store/'}]}),refreshApps:async()=>true};window.WizCanOpen=()=>true;</script><script src="/wizard-os-home/core/appearance-host.js"></script><body><div class="win"><iframe src="/wizard-os-home/store/index.html"></iframe></div></body></html>`});
   if(p.startsWith('/wizard-os-home/')) {
    const file=path.join(WEB,decodeURIComponent(p.slice('/wizard-os-home/'.length)));
    if(file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream',body:fs.readFileSync(file)});
   }
   return route.fulfill({status:404,body:''});
  });
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/host');
  const f=page.frames().find(x=>x.url().includes('/store/index.html')); assert.ok(f,'store frame');
  await f.waitForFunction(()=>window.__store?.state().loaded && document.documentElement.dataset.skin);
  const shot=async name=>{await page.waitForTimeout(300);const file=path.join(OUT,`${tag}-${name}.png`);await page.screenshot({path:file,animations:'disabled'});return file;};
  const name=APPS.find(a=>a.id===c.app).name;
  await f.fill('#q',name.split(' ')[0]); await f.locator(`.row[data-app^="${c.app}|"]`).waitFor();
  await f.locator(`.row[data-app^="${c.app}|"] [data-get]`).tap();
  // The install ends in the sheet (personal data, nobody can use it yet) or in a toast.
  await f.waitForFunction(()=>!window.__store.state().busy,null,{timeout:20000});
  await page.waitForTimeout(400);
  const out={tag,case:c.name,layers:await f.evaluate(()=>window.__store.state().layers)};
  const sheetOpen=out.layers.at(-1)==='sheet';
  out.card=sheetOpen ? await f.locator('#sheet [data-pn-card]').count() : 0;
  out.oldCard=sheetOpen ? await f.locator('#sheet .pv-card:not([data-pn-card])').count() : 0;
  if(sheetOpen) { out.sheet=(await f.locator('#sheet').innerText()).replace(/\s+/g,' ').trim(); fs.writeFileSync(path.join(OUT,`${tag}-sheet.html`),await f.locator('#sheet').innerHTML()); }
  out.shotInstall=await shot('install');
  const personalNoPrivate=(PERSONAL.has(c.app)||LABELLED.has(c.app)) && !c.agents.some(a=>a.privacy==='private');
  if(personalNoPrivate) {
   assert.equal(out.card,1,'the card shows');
   assert.match(out.sheet,new RegExp(`${name} ${LABELLED.get(c.app)||'holds personal data'}\\. We recommend private AI for apps like this, so no AI company sees it\\.`));
   assert.match(out.sheet,/Set up private AI/); assert.match(out.sheet,/Use Claude for now/); assert.match(out.sheet,/Why it matters/);
   assert.equal(out.oldCard,0,'one card only');
   // The card sits above everything else in the sheet.
   const order=await f.evaluate(()=>{const s=document.getElementById('sheet');const card=s.querySelector('[data-pn-card]');return [...s.querySelectorAll('.mc-list,[data-pn-card]')].indexOf(card);});
   assert.ok(order<=0);
   if(c.tap==='standard') {
    await f.locator('#sheet [data-pn-standard]').tap();
    await f.locator('#sheet [data-pn-done="standard"]').waitFor({timeout:10000});
    assert.deepEqual(puts,[{app:c.app,agents:['hermes']}],'installs on the standard agent');
    out.done=(await f.locator('#sheet [data-pn-done]').innerText()).trim();
    assert.match(out.done,new RegExp(`${name} is on Wizard with Claude for now`));
    assert.equal(await f.locator('#sheet [data-pn-card]').count(),0,'card gone after the choice');
    await f.locator(`#sheet [data-open="${c.app}"]`).waitFor();   // the sheet goes on as for any app: Open
    out.shotAfter=await shot('after');
   } else {
    await f.locator('#sheet [data-pn-setup]').tap();
    await page.waitForFunction(()=>window.privacy.includes('setup'));
    assert.deepEqual(await page.evaluate(()=>window.routes),[],'the switch-over opens directly, no app-route fallback');
    await f.locator('#sheet .pn-note').waitFor();
    out.shotWaiting=await shot('waiting');
    // The switch-over ends (stand-in: 1.5 s later the box has a private agent with the app): the sheet follows by itself.
    await f.locator('#sheet [data-pn-done="private"]').waitFor({timeout:15000});
    out.done=(await f.locator('#sheet [data-pn-done]').innerText()).trim();
    assert.match(out.done,new RegExp(`${name} is on Private, your private agent`));
    assert.deepEqual(puts,[],'no agents write from the sheet: the switch-over moved it');
    out.shotAfter=await shot('after');
   }
  } else {
   assert.equal(out.card,0,'no card');
  }
  out.errors=errors; assert.deepEqual(errors,[]); assert.deepEqual(unsafe,[]);
  results.push(out); await context.close();
 }
 // Why it matters: tap it on a fresh box and the page opens; with no such page (WosPrivacy off) the link is not drawn.
 for(const why of [true,false]) {
  const context=await browser.newContext({viewport:{width:W,height:900},hasTouch:true,isMobile:true,serviceWorkers:'block'});
  const installed=new Set();
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),p=u.pathname,m=req.method();
   const ag=/^\/wizard\/v1\/apps\/([a-z0-9-]+)\/agents$/.exec(p);
   if(ag) return route.fulfill({json:{app_id:ag[1],kind:'wizard_apps',privacy:'private',needs_private_agent:true,agents:[{...MAIN,enabled:false}]}});
   const inst=/\/store-install\/([a-z0-9-]+)$/.exec(p);
   if(inst && m==='POST') { installed.add(inst[1]); return route.fulfill({json:{state:'installed',selection:JSON.parse(req.postData()||'{}')}}); }
   if(inst) return route.fulfill({status:404,json:{}});
   if(p.includes('/store-data/')) {
    if(p.includes('/index/search')) return route.fulfill({json:{apps:APPS.map(a=>({...a,releases:[{...a}]})),sources:[],next_offset:null}});
    const mine=APPS.filter(a=>installed.has(a.id));
    if(p.endsWith('/api/apps/installed')) return route.fulfill({json:{installed:mine.map(a=>({info:{id:a.id,urn:a.id+':wizardapps'},app:{status:'running'}}))}});
    if(p.endsWith('/wizard/v1/installed-apps')) return route.fulfill({json:{architecture:'amd64',complete:true,unavailable:[],wam:mine.map(a=>({id:a.id,repo:a.repo,commit:C,version:a.version,status:'running',source:'standard',type:a.type})),shell:[]}});
    if(p.includes('/router/v1/')) return route.fulfill({json:{models:[],services:[],providers:[]}});
    return route.fulfill({status:404,json:{}});
   }
   if(p==='/host') return route.fulfill({contentType:'text/html',body:`<!doctype html><html><script>window.privacy=[];window.WosModels={ready:true,load:async()=>[],defaultOption:()=>({value:'gpt-5',provider:'openai-codex',isGlobalDefault:true})};${why?`window.WosPrivacy={on:()=>true,open:async at=>{window.privacy.push(at);return true;}};`:''}window.WizCore={apps:()=>({APPS:[]}),refreshApps:async()=>true};</script><body><iframe style="width:100%;height:900px;border:0" src="/wizard-os-home/store/index.html"></iframe></body></html>`});
   if(p.startsWith('/wizard-os-home/')) { const file=path.join(WEB,decodeURIComponent(p.slice('/wizard-os-home/'.length)));
    if(file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream',body:fs.readFileSync(file)}); }
   return route.fulfill({status:404,body:''});
  });
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/host');
  const f=page.frames().find(x=>x.url().includes('/store/index.html'));
  await f.waitForFunction(()=>window.__store?.state().loaded);
  await f.fill('#q','Notes'); await f.locator('.row[data-app^="wizard-notes|"] [data-get]').tap();
  await f.locator('#sheet [data-pn-card]').waitFor({timeout:20000});
  const text=(await f.locator('#sheet [data-pn-card]').innerText()).replace(/\s+/g,' ');
  assert.match(text,/Use ChatGPT for now/,'names the standard provider');
  assert.equal(await f.locator('#sheet [data-pn-why]').count(),why?1:0,'Why it matters only while the page exists');
  if(why) { await f.locator('#sheet [data-pn-why]').tap(); await page.waitForFunction(()=>window.privacy.includes('why')); }
  assert.deepEqual(errors,[]);
  results.push({tag:`on-why-${why}`,text}); await context.close();
 }
 } finally { await browser.close(); }
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(results.map(({shotInstall,shotAfter,shotWaiting,...r})=>r),null,1));
 console.log(JSON.stringify(results.map(r=>({tag:r.tag,card:r.card,oldCard:r.oldCard,done:r.done})),null,0));
 console.log('ok',results.length,'cases');
})().catch(e=>{console.error(e);process.exit(1);});
