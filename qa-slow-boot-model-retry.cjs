// Synthetic-only browser acceptance for a slow Agent Service: shell boot and model retry feedback.
// No private data, owner origin, credentials or real inference. Every API is a fixture route.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const ROOT=path.resolve(process.env.QA_WEB_DIR||__dirname),OUT=path.resolve(process.env.QA_OUT||'.qa-slow-boot-model-retry');
const sid='wizard_synthetic_slow_retry',source='wizardq_synthetic_slow_retry',text='Synthetic retained request for a slow server';
const original={model:'claude-opus-5-5',provider:'anthropic'},chosen={model:'gpt-5.5',provider:'openai-codex'};
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),receipts=[];fs.mkdirSync(OUT,{recursive:true});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');if(!['GET','HEAD'].includes(req.method)){res.writeHead(403);return res.end('No server writes');}
 const rel=u.pathname.replace(/^\/wizard-os-home\/?/,'')||'index.html',file=path.resolve(ROOT,'web',rel);
 if(!file.startsWith(path.join(ROOT,'web')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Missing '+rel);}
 res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME});
 try{for(const shell of ['phone','desktop'])for(const skin of ['obsidian','landscapes']){
  const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1440,height:960},isMobile:shell==='phone',hasTouch:shell==='phone',serviceWorkers:'block'});
  let route={...original},status='failed',retryId=source,runId=source,revision=1,detailDelay=0,bootDelay=7000,detailReads=0;
  const at=Math.floor(Date.now()/1000),sends=[],writes=[],errors=[],blocked=[];
  const row=()=>({id:sid,title:'Synthetic · needs retry',source:'wizard-mobile',status,model:route.model,provider:route.provider,archived:false,hidden:false,message_count:1,started_at:at-200,last_active:at-100,wizard_last_run_status:status,wizard_run_id:runId,wizard_retry_run_id:retryId,wizard_retry_input:text,wizard_last_request_at:at-100,preview:text,preview_role:'user'});
  await ctx.addInitScript(s=>{localStorage.setItem('wos.skin',s);localStorage.setItem('wos.skin.composition.v1',JSON.stringify({version:1,extends:s}));for(const k of ['wos.coached','wos.tour.v1','wos.tour.done','wos.voiceTipSeen'])localStorage.setItem(k,'true');},skin);
  await ctx.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),p=u.pathname,json=(v,code=200)=>r.fulfill({status:code,contentType:'application/json',body:JSON.stringify(v)});
   if(u.origin!==origin){blocked.push(u.href);return r.abort();}
   if(!['GET','HEAD'].includes(q.method())){
    const body=q.postDataJSON();writes.push({path:p,at:Date.now()});
    if(p===`/wizard/hermes/api/sessions/${sid}/model`){await sleep(detailDelay);route={model:body.model,provider:body.provider};revision++;return json({runtime:{...route,model_lock:'accepted',selection_version:Date.now()}});}
    if(p==='/wizard/hermes/v1/runs'){assert.equal(body.wizard_retry_run_id,source);assert.equal(body.model,chosen.model);sends.push({at:Date.now()});status='running';retryId='';runId='wizardq_synthetic_child';revision++;return json({run_id:runId,status:'running',runtime:{...route,model_lock:'accepted'}},202);}
    if(/thread-seen|ui-preferences|thread-dispositions|title/.test(p))return json({state:{initializedAt:Date.now(),threads:{}},ok:true,preferences:{migrations:{'launcher-seed-v1':'x'}}});
    return json({error:'Blocked non-fixture write'},403);
   }
   if(p==='/wizard/v1/bootstrap'){await sleep(bootDelay);return json({bootstrap:1,settings:{owner:{name:'Fixture owner'},agent:{name:'Fixture Wizard'},clock:{timezone:'UTC'},voice:{}},endpoints:{apps:'/wizard/v1/apps',sessions:'/wizard/hermes/api/sessions',runs:'/wizard/hermes/v1/runs'},capabilities:{files:true}});}
   if(p==='/wizard/v1/apps')return json({apps:[]});
   if(p==='/wizard/hermes/api/sessions')return json({data:[row()],has_more:false,total:1,list_version:revision});
   if(p===`/wizard/hermes/api/sessions/${sid}`){detailReads++;await sleep(detailDelay);return json({session:row()});}
   if(p===`/wizard/hermes/api/sessions/${sid}/messages`)return json({data:[{id:1,role:'user',content:text,timestamp:at-100}],pagination:{returned:1,total:1},has_more:false});
   if(p==='/wizard/hermes/api/model/options')return json({model:original.model,provider:original.provider,options:[{value:original.model,provider:original.provider,name:'Original Opus',default:true},{value:chosen.model,provider:chosen.provider,name:'Chosen GPT'}]});
   if(p.includes('ui-preferences')){await sleep(bootDelay);return json({migrations:{'launcher-seed-v1':'x'},launcher:{}});}
   if(p==='/wizard/thread-seen')return json({state:{initializedAt:Date.now(),threads:{}}});
   if(p==='/wizard/thread-dispositions')return json({state:{}});
   if(p==='/wizard/agents')return json({agents:[]});
   if(p.startsWith('/wizard/'))return json({});
   if(p.endsWith('/ux-version.txt'))return r.fulfill({status:200,body:'synthetic-source'});
   if(p.endsWith('/ux-changes.json'))return json([]);
   if(p.endsWith('/data.js')||p.endsWith('/summaries.js'))return r.fulfill({status:200,contentType:'application/javascript',body:''});
   return r.continue();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  const tag=`${shell}-${skin}`;
  try{
   // 1. Reload against a 7 s bootstrap/preferences answer: no fatal card, shell exists by ~1 s after load.
   const t0=Date.now();await page.goto(origin+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':'')+'?shell='+shell,{waitUntil:'load'});const loaded=Date.now();
   await page.waitForFunction(()=>!!(window.__wos||window.__wux),null,{timeout:5000});const shellAt=Date.now()-loaded;
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.shell),shell);
   await page.waitForTimeout(Math.max(0,4000-(Date.now()-loaded)));
   const fatalAt4=await page.evaluate(()=>{const e=document.getElementById('wxFatal');return !!e&&!e.hidden;});assert.equal(fatalAt4,false,'no fatal card while bootstrap is slow');
   await page.screenshot({path:path.join(OUT,`${tag}-slow-boot-4s.png`)});
   await page.waitForFunction(id=>window.WizLive?.session(id),sid,{timeout:20000});
   const fatalAfter=await page.evaluate(()=>{const e=document.getElementById('wxFatal');return !!e&&!e.hidden;});assert.equal(fatalAfter,false);
   // 2. Choose another model with a 4 s session detail + model save: busy state must appear at once.
   bootDelay=0;await page.evaluate(id=>window.__wos?__wos.openWizardThread(id):__wux.openThread(id),sid);
   await page.waitForSelector('[data-chretrymodel]:visible',{timeout:20000});
   // The phone desk slide can still be moving the thread in; click only a settled, hit-testable control.
   await page.waitForFunction(()=>{const e=[...document.querySelectorAll('[data-chretrymodel]')].find(x=>x.getClientRects().length);if(!e)return false;const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;return x>0&&y>0&&x<innerWidth&&y<innerHeight&&e.contains(document.elementFromPoint(x,y));},null,{timeout:10000});
   await page.waitForTimeout(400);
   await page.locator('[data-chretrymodel]:visible').click();await page.waitForSelector('[data-mpick]');
   const index=await page.evaluate(m=>WosModels.visible(WizLive.session('wizard_synthetic_slow_retry').model,WizLive.session('wizard_synthetic_slow_retry').provider).findIndex(x=>x.value===m),chosen.model);assert(index>=0);
   detailDelay=4000;const reads0=detailReads,tap=Date.now();await page.locator(`[data-mpick="${index}"]`).last().click();
   await page.waitForFunction(()=>[...document.querySelectorAll('.ch-fail[aria-busy="true"]')].some(e=>e.getClientRects().length&&/Retrying on Chosen GPT…/.test(e.innerText)),null,{timeout:1500});
   const busyMs=Date.now()-tap;
   const panel=await page.evaluate(()=>{const e=[...document.querySelectorAll('.ch-fail[aria-busy="true"]')].find(x=>x.getClientRects().length);const b=e.getBoundingClientRect();return {text:e.innerText,enabled:[...e.querySelectorAll('button')].filter(x=>!x.disabled).length,sheetOpen:!!document.querySelector('.ch-sheet [data-mpick]'),visible:b.width>0&&b.height>0}});
   assert.equal(panel.enabled,0);assert.equal(panel.sheetOpen,false);assert.equal(sends.length,0,'busy before network returns');
   await page.locator('.ch-fail[aria-busy="true"]:visible').scrollIntoViewIfNeeded();await page.waitForTimeout(350);
   await page.screenshot({path:path.join(OUT,`${tag}-retry-busy.png`)});
   await page.waitForFunction(id=>WizLive.session(id)?.runId==='wizardq_synthetic_child',sid,{timeout:25000});
   assert.equal(sends.length,1);assert.deepEqual(route,chosen);
   const extraReads=detailReads-reads0;
   assert.deepEqual(errors,[]);
   receipts.push({shell,skin,shellReadyAfterLoadMs:shellAt,bootstrapDelayMs:7000,fatalAt4s:fatalAt4,fatalAfterBoot:fatalAfter,busyVisibleMs:busyMs,panel,detailReadsDuringRetry:extraReads,sends:sends.length,modelSaved:route,externalRequestsBlocked:blocked.length,errors});
  }catch(e){
   await page.screenshot({path:path.join(OUT,`${tag}-failure.png`)}).catch(()=>{});
   fs.writeFileSync(path.join(OUT,`${tag}-failure.json`),JSON.stringify({error:String(e.stack||e),errors,writes,sends,blocked,html:await page.content().catch(()=>'')},null,2));throw e;
  }finally{await ctx.close();}
 }}finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({fixtureOnly:true,host:require('node:os').hostname(),source:process.env.QA_SHA,receipts},null,2));}
 assert.equal(receipts.length,4);console.log(JSON.stringify({pass:true,receipts},null,1));
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
