// Synthetic-only browser acceptance for the exact queued/provider_access projection.
// No private data, service proxy, owner origin, credentials or real inference.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const ROOT=path.resolve(process.env.QA_WEB_DIR||__dirname),OUT=path.resolve(process.env.QA_OUT||'.qa-provider-wait');
const sid='wizard_synthetic_provider_wait',source='wizardq_synthetic_provider_wait';
const original={model:'claude-opus-5-5',provider:'anthropic'},chosen={model:'gpt-5.5',provider:'openai-codex'};
const text='Synthetic full retained request: '+ 'all original words '.repeat(60);
const receipts=[],types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
fs.mkdirSync(OUT,{recursive:true});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 // Static server is a second fence: intercepted fixture traffic is the ONLY API.
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(403);return res.end('No server writes');}
 const rel=u.pathname.replace(/^\/wizard-os-home\/?/,'')||'index.html',file=path.resolve(ROOT,'web',rel);
 if(!file.startsWith(path.join(ROOT,'web')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
  res.writeHead(404);return res.end('Missing fixture asset '+rel);
 }
 res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME});
 try{
 for(const shell of ['phone','desktop'])for(const skin of ['obsidian','landscapes']){
  const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1440,height:960},isMobile:shell==='phone',hasTouch:shell==='phone',serviceWorkers:'block'});
  let route={...original},status='queued',retryId=source,runId=source,modelFailure=false;
  // One captured clock and monotone revision per state change, not a new
  // request identity on every list/detail/message hydration.
  const at=Math.floor(Date.now()/1000); let revision=1;
  const writes=[],sends=[],errors=[],blocked=[];
  const row=()=>({id:sid,title:'Synthetic · provider could not start',source:'wizard-mobile',status,queue_reason:status==='queued'?'provider_access':'',model:route.model,provider:route.provider,archived:false,hidden:false,message_count:1,started_at:at-200,last_active:at-100,wizard_last_run_status:status,wizard_run_id:runId,wizard_retry_run_id:retryId,wizard_retry_input:text,wizard_safe_error:status==='queued'?'The selected provider could not start. Your request is saved.':'',wizard_last_request_at:at-100,preview:text.slice(0,100),preview_role:'user'});
  await ctx.addInitScript(s=>{localStorage.setItem('wos.skin',s);localStorage.setItem('wos.skin.composition.v1',JSON.stringify({version:1,extends:s}));for(const k of ['wos.coached','wos.tour.v1','wos.tour.done','wos.voiceTipSeen'])localStorage.setItem(k,'true');},skin);
  await ctx.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),p=u.pathname;
   const json=(value,code=200)=>r.fulfill({status:code,contentType:'application/json',body:JSON.stringify(value)});
   if(u.origin!==origin){blocked.push(u.href);return r.abort();}
   if(!['GET','HEAD'].includes(q.method())){
    const body=q.postDataJSON();writes.push({path:p,body});
    if(p===`/wizard/hermes/api/sessions/${sid}/model`){
     if(modelFailure==='http')return json({error:'Synthetic model save failure'},503);
     if(modelFailure==='ack')return json({runtime:{...original,model_lock:'accepted'}});
     route={model:body.model,provider:body.provider};revision++;return json({runtime:{...route,model_lock:'accepted',selection_version:Date.now()}});
    }
    if(p==='/wizard/hermes/v1/runs'){
     assert.equal(body.wizard_retry_run_id,source,'source identity travels through real outbox');
     assert.equal(body.model,chosen.model);assert.equal(body.provider,chosen.provider);assert.equal(body.require_model_lock,true);
     sends.push(body);status='running';retryId='';runId='wizardq_synthetic_child';revision++;return json({run_id:'wizardq_synthetic_child',status:'running',runtime:{...route,model_lock:'accepted'}},202);
    }
    if(/thread-seen|ui-preferences|thread-dispositions|title/.test(p))return json({state:{initializedAt:Date.now(),threads:{}},ok:true});
    return json({error:'Blocked non-fixture write'},403);
   }
   if(p==='/wizard/v1/bootstrap')return json({bootstrap:1,settings:{owner:{name:'Fixture owner'},agent:{name:'Fixture Wizard'},clock:{timezone:'UTC'},voice:{}},endpoints:{apps:'/wizard/v1/apps',sessions:'/wizard/hermes/api/sessions',runs:'/wizard/hermes/v1/runs'},capabilities:{files:true}});
   if(p==='/wizard/v1/apps')return json({apps:[]});
   if(p==='/wizard/hermes/api/sessions')return json({data:[row()],has_more:false,total:1,list_version:revision});
   if(p===`/wizard/hermes/api/sessions/${sid}`)return json({session:row()});
   if(p===`/wizard/hermes/api/sessions/${sid}/messages`)return json({data:[{id:1,role:'user',content:text,timestamp:at-100}],pagination:{returned:1,total:1},has_more:false});
   if(p==='/wizard/hermes/api/model/options')return json({model:original.model,provider:original.provider,options:[{value:original.model,provider:original.provider,name:'Original Opus',default:true},{value:chosen.model,provider:chosen.provider,name:'Chosen GPT'}]});
   if(p==='/wizard/thread-seen')return json({state:{initializedAt:Date.now(),threads:{}}});
   if(p==='/wizard/thread-dispositions')return json({state:{}});
   if(p.includes('ui-preferences'))return json({preferences:{}});
   if(p==='/wizard/agents')return json({agents:[]});
   if(p.startsWith('/wizard/'))return json({});
   if(p.endsWith('/ux-version.txt'))return r.fulfill({status:200,body:'synthetic-source'});
   if(p.endsWith('/ux-changes.json'))return json([]);
   if(p.endsWith('/data.js')||p.endsWith('/summaries.js'))return r.fulfill({status:200,contentType:'application/javascript',body:''});
   return r.continue();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{
   await page.goto(origin+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':'')+'?shell='+shell,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(id=>window.WizLive?.session(id)&&(window.__wos||window.__wux),sid,{timeout:30000});
   await page.evaluate(id=>window.__wos?__wos.openWizardThread(id):__wux.openThread(id),sid);
   await page.waitForSelector('[data-chretrymodel]',{timeout:20000});
  };
  const realClick=async selector=>{
   const target=page.locator(selector+':visible');assert.equal(await target.count(),1,'one visible action: '+selector);
   for(let n=0;;n++)try{await target.click({trial:true,timeout:3000});await target.click({timeout:3000});return;}
   catch(e){if(n===2)throw e;} // never force or dispatch a DOM click
  };
  const pick=async()=>{
   await realClick('[data-chretrymodel]');await page.waitForSelector('[data-mpick]');
   const index=await page.evaluate(model=>WosModels.visible(WizLive.session('wizard_synthetic_provider_wait').model,WizLive.session('wizard_synthetic_provider_wait').provider).findIndex(x=>x.value===model),chosen.model);
   assert(index>=0,'chosen route visible');return page.locator(`[data-mpick="${index}"]`).last();
  };
  try{
   await open();
   assert.equal(await page.evaluate(id=>WizLive.workGroups().errors.some(s=>s.id===id),sid),true);
   assert.equal(await page.evaluate(id=>WizLive.workGroups().working.some(s=>s.id===id),sid),false);
   assert.equal(await page.locator('[data-chstop],[data-steer]').count(),0,'no Stop or Steer for failed start');
   assert.equal(await page.locator('.ch-msgs details.steps.live').count(),0,'no running receipt');
   const button=page.locator('[data-chretrymodel]').last();assert.equal(await button.isEnabled(),true);await button.scrollIntoViewIfNeeded();
   const hit=await button.evaluate(e=>{const b=e.getBoundingClientRect();return {hit:e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),height:b.height}});assert(hit.hit,'model escape is hit-testable');assert(hit.height>=32);
   await page.screenshot({path:path.join(OUT,`${shell}-${skin}-error.png`)});
   await open(); // refresh must retain the visible error and usable controls
   const composer=page.locator('textarea').last();await composer.fill('Keep my unrelated unsent draft');
   for(const failure of ['http','ack']){
    modelFailure=failure;
    // Clear a previous toast by reloading, not by racing its async save.
    if(failure==='ack'){await open();await composer.fill('Keep my unrelated unsent draft');}
    await(await pick()).click();
    await page.waitForFunction(()=>/Couldn’t change the model/.test(document.body.innerText)&&!WosModels.pending.size);
    assert.equal(sends.length,0);assert.deepEqual(route,original);
    assert.equal(await composer.inputValue(),'Keep my unrelated unsent draft');
   }
   // A picker left open across automatic recovery cannot save or replay the stale request.
   modelFailure=false;const stale=await pick(),before=writes.filter(x=>x.path.endsWith('/model')).length;
   status='running';retryId='';runId='wizardq_auto_child';revision++;await stale.click();
   await page.waitForFunction(()=>/saved request has changed/i.test(document.body.innerText));
   assert.equal(writes.filter(x=>x.path.endsWith('/model')).length,before);assert.equal(sends.length,0);
   status='queued';retryId=source;runId=source;revision++;await page.evaluate(()=>WizLive.refresh());await open();
   await(await pick()).click();
   await page.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.runId==='wizardq_synthetic_child'),null,{timeout:20000});
   assert.equal(sends.length,1);assert.deepEqual(route,chosen);
   assert.equal(sends[0].input,text.trim(),'real outbox passes full preview; backend retention separately tested with files');
   await page.screenshot({path:path.join(OUT,`${shell}-${skin}-retried.png`)});
   assert.deepEqual(errors,[]);
   receipts.push({shell,skin,source:'synthetic queued/provider_access',model:route,requests:sends.length,modelSaveFailures:2,ackMismatchRefused:true,stalePickerRefused:true,refreshRetainedError:true,hit,errors,externalRequestsBlocked:blocked.length,writes});
  }catch(e){
   await page.screenshot({path:path.join(OUT,`${shell}-${skin}-failure.png`)}).catch(()=>{});
   const state=await page.evaluate(id=>({session:window.WizLive?.session(id),html:document.body.innerHTML,tour:window.__tourLog}),sid).catch(()=>null);
   fs.writeFileSync(path.join(OUT,`${shell}-${skin}-failure.json`),JSON.stringify({error:String(e),state,fixture:row(),writes,sends,errors,blocked},null,2));throw e;
  }finally{await ctx.close();}
 }
 }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({fixtureOnly:true,host:require('node:os').hostname(),source:process.env.QA_SHA,receipts},null,2));}
 assert.equal(receipts.length,4);console.log(JSON.stringify({pass:true,cases:receipts.length,out:OUT}));
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
