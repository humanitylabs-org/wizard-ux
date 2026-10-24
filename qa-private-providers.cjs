// Isolated, synthetic API QA of the real shell + Agents; never reaches an installed box.
// node qa-private-providers.cjs [output-directory]
const {chromium}=require('./tools/qa-playwright.cjs'), http=require('node:http'), fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const OUT=path.resolve(process.argv[2]||'qa-private-providers-out');fs.mkdirSync(OUT,{recursive:true});
const providers=[{id:'wizard-tinfoil',label:'Tinfoil',kind:'attested-relay',confidential:true,available:true,models:[{id:'relay-model',label:'Relay model'}]}, {id:'wizard-local-model',label:'Local model',kind:'local',confidential:true,available:true,models:[{id:'owned-model',label:'Owned model'}]}, {id:'another-relay',label:'Another relay',kind:'attested-relay',confidential:true,available:false,models:[]}];
const agent=(id,label,provider,model,privacy='private')=>({id,label,privacy,harness:'hermes',status:'running',is_default:id==='hermes',model:{provider,model,allowed_models:[model],fallback:privacy!=='private'},permissions:{preset:privacy,outside_tools:[],files:'own',wizard_apps:[],agent_apps:[],other_agents:'none'}});
const agents=[agent('hermes','Atlas','anthropic','claude-opus-5-5','standard'),agent('sealed','Relay agent','tinfoil','relay-model'),agent('owned','Owned agent','wizard-local-model','owned-model')];
const checks=[],errors=[],screens=[],writes=[];let scenario='installed';
const fixtureAgents=()=>scenario==='empty'?agents.slice(0,1):['legacy','tinfoil','unavailable'].includes(scenario)?agents.slice(0,2):agents;
const fixtureProviders=()=>['empty','legacy'].includes(scenario)?[]:scenario==='tinfoil'?[providers[0]]:scenario==='unavailable'?[{...providers[0],available:false}]:providers;
const json=(res,data)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://qa'),p=u.pathname.replace(/^\/wizard-os-home\/store-data(?=\/wizard\/)/,'');
 if(!['GET','HEAD'].includes(req.method)){writes.push(req.method+' '+p);res.writeHead(403);return res.end('{}');}
 if(p==='/wizard/v1/agents')return json(res,{agents:fixtureAgents()});
 if(p==='/wizard/v1/agent-options')return json(res,{providers:fixtureProviders(),harnesses:[{id:'hermes',label:'Hermes'}]});
 if(p==='/wizard/v1/bootstrap')return json(res,{bootstrap:1,settings:{agent:{name:'Atlas'}},capabilities:{voice:false,files:false,router:false},endpoints:{sessions:'/wizard/hermes/api/sessions',runs:'/wizard/hermes/v1/runs'}});
 if(p==='/wizard/hermes/api/model/options')return json(res,{provider:'anthropic',model:'claude-opus-5-5',providers:[{slug:'anthropic',authenticated:true,models:['claude-opus-5-5']},{slug:'openai-codex',authenticated:true,models:['gpt-6-astra','gpt-6.1-sol']},{slug:'wizard-tinfoil',is_user_defined:true,authenticated:true,models:['host-only-model']}]});
 if(p==='/wizard/v1/index/search')return json(res,{apps:[{id:'wizard-local-model',name:'Local model',summary:'Private inference on your own machine',tags:['private'],provides:['private-inference'],publisher:'Wizard',releases:[]}],total:1});
 if(p.startsWith('/wizard/'))return json(res,{apps:[],bindings:[],data:[],has_more:false,state:{},presets:[]});
 let rel=p.replace(/^\/wizard-os-home\//,'')||'index.html';if(rel.endsWith('/'))rel+='index.html';
 if(rel.includes('..')||rel==='sw.js'){res.writeHead(404);return res.end();}
 const file=path.join(__dirname,'web',rel);if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 const type={'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
 res.writeHead(200,{'content-type':type,'content-security-policy':CSP,'cache-control':'no-store'});res.end(fs.readFileSync(file));
});
let browser,lastPage,lastFrame;
async function check(name,fn){await fn();checks.push(name);console.log('PASS',name);}
async function shot(page,name){const p=path.join(OUT,'pp-ux-'+name+'.png');await page.screenshot({path:p});screens.push(p);console.log('SHOT',p);}
async function selectSkin(p,f,mobile,skin){
 // Real Settings → Skin control, not token injection.
 if(mobile)await p.evaluate(()=>__wos.openSheet('settings'));else await p.locator('#settingsBtn').click();
 await p.locator(`[data-skinpick="${skin}"]`).last().click();
 if(mobile)await p.evaluate(()=>__wos.closeSheets(true));else await p.keyboard.press('Escape');
 await f.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/wizard-os-home/`;
 browser=await chromium.launch({...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{}),args:['--no-sandbox']});
 for(const mobile of [true,false]){
 const mode=mobile?'phone':'desktop';const ctx=await browser.newContext(mobile?{viewport:{width:412,height:892},isMobile:true,hasTouch:true,deviceScaleFactor:2,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'}:{viewport:{width:1440,height:900}});
 await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1');window.__qaDoc=Math.random();});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.fulfill({status:204,body:''}));
 const p=await ctx.newPage();lastPage=p;p.on('pageerror',e=>errors.push(mode+': '+String(e)));
 await p.goto(base+(mobile?'':'desktop.html')+'?open=agents');
 await p.waitForFunction(()=>typeof window.WizOpenApp==='function');await p.evaluate(()=>WizOpenApp('agents'));
 const handle=await p.waitForSelector('iframe[title="Agents"]');const f=await handle.contentFrame();lastFrame=f;await f.waitForSelector('[data-open="owned"]');
 await f.locator('[data-new]').click();await f.locator('#agName').fill('Unsent name');await f.locator('[data-next]').click();
 await check(mode+' installed provider names and three choices',async()=>{assert.equal(await f.locator('[data-pick="provider"]').count(),3);assert.match(await f.locator('#app').innerText(),/Another relay/);});
 const identity=await f.evaluate(()=>window.__qaDoc);
 for(const skin of ['nebula','signal']){
 await selectSkin(p,f,mobile,skin);
 await check(`${mode} ${skin} Appearance acknowledged; draft/document preserved`,async()=>{
  assert.equal(await f.evaluate(()=>window.__qaDoc),identity);assert.equal(await f.evaluate(()=>window.__agents.state().draft.label),'Unsent name');
  assert.equal(await f.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.ok(await p.locator('.win.wz-themed iframe[title="Agents"]').count());
 });
 await f.locator('[data-v="wizard-local-model"][data-pick="provider"]').click();
 await shot(p,mode+'-'+skin+'-providers');
 }
 await check(mode+' nested Back stays inside Agents and preserves draft',async()=>{
  if(mobile)await p.evaluate(()=>__wosNativeBack());else await f.locator('[data-back]').first().click();
  assert.equal(await f.locator('#agName').inputValue(),'Unsent name');
  if(mobile)await p.evaluate(()=>__wosNativeBack());else await f.locator('[data-back]').first().click();
  assert.equal(await f.locator('.ag-list').count(),1);assert.ok(p.url().includes('/wizard-os-home/'));
 });
 for(const id of ['sealed','owned']){await f.locator(`[data-open="${id}"]`).click();await check(mode+' '+id+' honest detail wording',async()=>assert.equal(await f.locator('[data-privacy-promise]').innerText(),id==='sealed'?'Encrypted on this box; Tinfoil can’t read it':'Runs on a machine you own'));await shot(p,mode+'-signal-'+id);await f.locator('[data-back]').first().click();}
 await check(mode+' private picker choices have agent identity and API model labels',async()=>{
  const v=await p.evaluate(async()=>{await WosModels.load();await WosAgents.loadOptions();const priv=WosModels.privateOptions();return {priv,html:WosModels.popHtml({mode:'new',priv}).html,sheet:WosModels.sheetHtml({mode:'new',all:true,priv}).html};});
  assert.deepEqual(v.priv.map(o=>o.agent).sort(),['owned','sealed']);assert.match(v.html,/Relay model/);assert.match(v.html,/Owned model/);assert.doesNotMatch(v.html+v.sheet,/host-only-model|Set up Tinfoil/);
 });
 // Render the actual picker through the real Chats controls.
 await p.evaluate(()=>WizCore.deeplink.route(location.pathname+'?open=wizard'));await p.locator('[data-chfab]').filter({visible:true}).first().click();
 const model=p.locator('[data-chmodel]').filter({visible:true}).first();await model.click();await p.waitForTimeout(250);await shot(p,mode+'-signal-chat-picker');await p.keyboard.press('Escape');
 await model.click();await p.locator('[data-mprivate="owned"]').filter({visible:true}).first().click();
 await check(mode+' selecting a private model binds the new chat to its agent',async()=>{await p.locator('[data-chmodel].private').filter({visible:true}).first().waitFor();assert.match(await p.locator('[data-chmodel].private').filter({visible:true}).first().innerText(),/Owned model/);});
 // Empty installed-provider state, same document reopened; no fake lifecycle records.
 await p.evaluate(()=>WizOpenApp('agents'));scenario='empty';await f.goto(base+'agents/index.html?new=1');await f.locator('#agName').fill('Empty');await f.locator('[data-next]').click();
 await check(mode+' empty state Store search link',async()=>{assert.equal(await f.locator('a.ag-link').getAttribute('href'),'../store/index.html?q=private');});await shot(p,mode+'-signal-empty');
 await f.locator('a.ag-link').click();const store=await(await p.waitForSelector('iframe[title="App Store"]')).contentFrame();await store.waitForFunction(()=>document.querySelector('#q')?.value==='private');
 await check(mode+' Store search opens in its own themed window and keeps Agents draft',async()=>{assert.equal(await store.locator('#q').inputValue(),'private');assert.equal(await f.evaluate(()=>__agents.state().draft.label),'Empty');});await shot(p,mode+'-signal-store-search');
 await check(mode+' Store nested Back remains in shell',async()=>{if(mobile)await p.evaluate(()=>__wosNativeBack());else await store.locator('[data-back]').first().click();assert.equal(await store.locator('#q').inputValue(),'');assert.ok(p.url().includes('/wizard-os-home/'));assert.equal(await f.evaluate(()=>__agents.state().draft.label),'Empty');});
 // Required launch matrix, isolated fixtures: no app + existing legacy, installed, installed/unavailable.
 await p.evaluate(()=>WizOpenApp('agents'));
 for(const state of ['legacy','tinfoil','unavailable']){
  scenario=state;
  for(const skin of ['nebula','signal']){
   await f.goto(base+'agents/index.html?agent=sealed');await f.locator('[data-provider-line]').waitFor();
   await selectSkin(p,f,mobile,skin);
   await check(`${mode} ${skin} ${state} existing Private availability and model route`,async()=>{
    assert.match(await f.locator('.ag-hero').innerText(),/Running/);
    assert.equal(await f.locator('[data-provider-unavailable]').count(),state==='unavailable'?1:0);
    const opts=await f.evaluate(()=>WosAgents.modelOptions(WosAgents.get('sealed')));
    assert.equal(opts.length,state==='unavailable'?0:1);
    if(opts.length)assert.deepEqual({agent:opts[0].agent,provider:opts[0].provider,value:opts[0].value},{agent:'sealed',provider:'tinfoil',value:'relay-model'});
    assert.equal(await f.locator('[data-store]').count(),0);
   });
   await shot(p,`${mode}-${skin}-${state}-detail`);
   await f.locator('[data-back]').first().click();await f.locator('[data-new]').click();await f.locator('#agName').fill('Preserved draft');await f.locator('[data-next]').click();
   await check(`${mode} ${skin} ${state} provider discovery does not nag`,async()=>{
    assert.equal(await f.locator('[data-store]').count(),0);
    assert.equal(await f.locator('[data-pick="provider"]').count(),state==='legacy'?0:1);
    if(state==='unavailable')assert.match(await f.locator('#app').innerText(),/Unavailable/);
   });
   await shot(p,`${mode}-${skin}-${state}-providers`);
   if(mobile)await p.evaluate(()=>__wosNativeBack());else await f.locator('[data-back]').first().click();
   assert.equal(await f.locator('#agName').inputValue(),'Preserved draft');
   await f.locator('[data-back]').first().click();assert.equal(await f.locator('.ag-list').count(),1);
  }
 }
 await check(mode+' root browser Back never exits the shell',async()=>{
  await p.goBack();assert.ok(p.url().includes('/wizard-os-home/'));assert.ok(await p.locator('body').count());
 });
 scenario='installed';await ctx.close();
 }
 const standalone=await browser.newPage({viewport:{width:412,height:892}});await standalone.goto(base+'agents/index.html');await standalone.waitForSelector('[data-open="owned"]');
 await check('standalone Agents has dark fallback',async()=>{assert.equal(await standalone.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');assert.notEqual(await standalone.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');});await shot(standalone,'standalone-dark');await standalone.close();
 console.log('RESULT',JSON.stringify({checks:checks.length,errors,writes,screens},null,2));assert.equal(errors.length,0);
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({checks,errors,writes,screens},null,2));
 fs.rmSync(path.join(OUT,'failure.json'),{force:true});
})().catch(async e=>{console.error(e);process.exitCode=1;console.log('FRAME STATE',await lastFrame?.evaluate(()=>({state:window.__agents?.state(),text:document.body.innerText})).catch(()=>null));await lastPage?.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(OUT,'failure.json'),JSON.stringify({error:String(e),checks,errors},null,2));}).finally(async()=>{if(browser)await browser.close();server.close();});
