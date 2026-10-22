// Isolated regression: real service HTTP -> unchanged production UX -> real admission.
// SQLite and Hermes transport are explicit test fixtures; no live state or writes are used.
// WAS_ROOT=<backend checkout> PW_MODULE=<playwright-core> QA_OUT=<evidence> node this-file
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {pathToFileURL} = require('node:url');
const {chromium} = require('./tools/qa-playwright.cjs');
const WAS = path.resolve(process.env.WAS_ROOT || '../was-helper-status-release');
const WEB = path.resolve(process.env.QA_WEB_DIR || path.join(__dirname, 'web'));
const OUT = path.resolve(process.env.QA_OUT || '.qa-helper-delivered');
const types = {'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const {fixture,sid} = await import(pathToFileURL(path.join(WAS,'tests/fixtures/helper-backend.mjs')));
 const {createWizardServer,listen} = await import(pathToFileURL(path.join(WAS,'server/service.mjs')));
 const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const receipts=[];
 try {
  for(const shell of ['phone','desktop']) await fixture(async({db,path:dbPath,sec,message})=>{
   db.exec('ALTER TABLE messages ADD COLUMN finish_reason TEXT DEFAULT "stop";');
   const lockedRoute={model:'glm-5-3',provider:'custom:tinfoil-operator'};
   db.prepare('INSERT INTO sessions(id,started_at,model,model_config) VALUES(?,?,?,?)').run(sid,sec-2000,lockedRoute.model,JSON.stringify({browser_model_lock:{...lockedRoute,confirmed:true,updated_at:sec-2000}}));
   db.exec("UPDATE async_delegations SET delivery_state='delivered'");
   message('user','Steer before completion: keep the approved scope; never deploy',sec-400);
   message('user','[ASYNC DELEGATION BATCH COMPLETE — deleg_review] Saved findings',sec-250);
   message('assistant','Still verifying [WIZARD_STATUS_V1]{"state":"fyi","ask":"Helpers returned; still integrating"}[/WIZARD_STATUS_V1]',sec-200);
   const raw=()=>({id:sid,source:'wizard-mobile',title:'Delivered helper · explicit QA fixture',status:'completed',started_at:sec-2000,updated_at:sec-200,message_count:4,archived:false,hidden:false,latest_message:{role:'assistant',content:'Still verifying [WIZARD_STATUS_V1]{"state":"fyi","ask":"Helpers returned; still integrating"}[/WIZARD_STATUS_V1]',timestamp:sec-200},last_user_message:{role:'user',content:'Steer before completion: keep the approved scope; never deploy',timestamp:sec-400}});
   const admissions=[],unlockedDispatches=[];
   const service=createWizardServer({hermesStatePath:dbPath,sessionDbPath:dbPath,hermesKey:'explicit-fixture-only',requireAccess:false,joinedDelegation:'off',followThrough:false,archivedSessionReader:()=>[],fetchImpl:async(url,options)=>{
    const u=new URL(url),p=u.pathname;let payload={data:[]},status=200;
    if(p.endsWith('/v1/capabilities'))payload={};
    else if(p.endsWith('/v1/runs') && options?.method==='POST') {unlockedDispatches.push(url);throw new Error('Unexpected unlocked native admission');}
    else if(p==='/api/sessions/'+sid+'/chat/stream' && options?.method==='POST') {
     admissions.push({body:JSON.parse(options.body),key:options.headers.get('Idempotency-Key')});
     return new Response('event: run.started\ndata: '+JSON.stringify({run_id:'delivered_qa_run',runtime:{...lockedRoute,model_lock:'accepted'}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
    }
    else if(p.endsWith('/messages'))payload={object:'list',data:db.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY id').all(sid),pagination:{returned:4,limit:500,offset:0}};
    else if(p.endsWith('/api/sessions'))payload={object:'list',data:[raw()],pagination:{returned:1,limit:50,offset:0}};
    else if(p.endsWith('/api/sessions/'+sid))payload={session:raw()};
    return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
   }});
   await listen(service);const backend=`http://127.0.0.1:${service.address().port}`;
   // The static origin proxies only reads. Even an un-intercepted browser write cannot reach admission.
   const originServer=http.createServer(async(req,res)=>{
    try{
     const u=new URL(req.url,'http://localhost');
     if(u.pathname.startsWith('/wizard/')){
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(403,{'content-type':'application/json'});return res.end('{"error":"QA writes must be intercepted"}');}
      const r=await fetch(backend+req.url);res.writeHead(r.status,{'content-type':r.headers.get('content-type') || 'application/json'});return res.end(Buffer.from(await r.arrayBuffer()));
     }
     let rel=decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\/?/,'')) || 'index.html';
     const target=path.resolve(WEB,rel);if(!target.startsWith(WEB+path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()){res.writeHead(404);return res.end('Missing QA asset');}
     res.writeHead(200,{'content-type':types[path.extname(target)] || 'application/octet-stream'});fs.createReadStream(target).pipe(res);
    }catch(e){res.writeHead(500);res.end(String(e));}
   });await listen(originServer);const origin=`http://127.0.0.1:${originServer.address().port}`;
   const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1440,height:960},isMobile:shell==='phone',hasTouch:shell==='phone'});
   const errors=[],writes=[],continueResponses=[];const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');});
   await ctx.route('**/*',async route=>{
    const req=route.request();if(['GET','HEAD'].includes(req.method()))return route.continue();
    const u=new URL(req.url());writes.push({method:req.method(),path:u.pathname});
    if(u.pathname==='/wizard/helper-continue'){
     assert.equal(req.method(),'POST');assert.deepEqual(req.postDataJSON(),{session_id:sid});
     // Dispatch ONLY this intercepted fixture request to the actual HTTP admission endpoint.
     const r=await fetch(backend+'/wizard/helper-continue',{method:'POST',headers:{'content-type':'application/json'},body:req.postData()});
     continueResponses.push(r.status);return route.fulfill({status:r.status,contentType:'application/json',body:await r.text()});
    }
    return route.fulfill({status:403,contentType:'application/json',body:'{"error":"QA blocked non-fixture write"}'});
   });
   try{
    const listResponse=await fetch(backend+'/wizard/hermes/api/sessions?limit=50');assert.equal(listResponse.status,200);const row=(await listResponse.json()).data[0];
    assert.equal(row.wizard_helper_status.phase,'stalled');assert.equal(row.wizard_helper_status.resumeEligible,true);assert.equal(row.wizard_helper_status.returned,1);
    await page.goto(origin+'/wizard-os-home/?open=chats&session='+sid+'&shell='+shell,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(id=>window.WizLive?.session(id),sid,{timeout:30000});
    const group=await page.evaluate(id=>WizLive.workGroups().working.some(s=>s.id===id),sid);
    // Save the actual pre-fix render before asserting the broken Working lane.
    await page.screenshot({path:path.join(OUT,shell+'-delivered-before.png')});
    if(!group){
     const r=await fetch(backend+'/wizard/helper-continue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session_id:sid})});
     console.log('DELIVERED_UI_RED '+JSON.stringify({shell,listStatus:row.status,phase:row.wizard_helper_status.phase,working:group,continueButtons:await page.locator('[data-helper-continue]').count(),continueStatus:r.status,admissions:admissions.length}));
    }
    assert.equal(row.status,'running');assert.equal(group,true,'actual UX must put the HTTP row in Working');
    await page.waitForFunction(()=>document.querySelector('[data-wk] summary')?.textContent.includes('Stuck · helpers returned'),null,{timeout:15000});
    const summary=page.locator('[data-wk] summary').last();await summary.click();
    const button=page.locator('[data-helper-continue]');assert.equal(await button.isVisible(),true);assert.ok((await button.boundingBox()).height>=44);
    await page.screenshot({path:path.join(OUT,shell+'-delivered-continue.png')});
    await button.click();await page.waitForFunction(id=>WizLive.session(id)?.helperStatus?.phase==='integrating',sid,{timeout:15000});
    assert.deepEqual(continueResponses,[202]);assert.equal(admissions.length,1);assert.equal(unlockedDispatches.length,0);assert.equal(admissions[0].key,'wizard-helper-receipt-deleg_review');assert.ok(admissions[0].body.message.includes('Verified saved findings'));assert.ok(admissions[0].body.message.includes('latest user instructions'));
    assert.equal(admissions[0].body.model,lockedRoute.model);assert.equal(admissions[0].body.provider,lockedRoute.provider);assert.equal(admissions[0].body.require_model_lock,true);
    assert.equal(await page.locator('[data-helper-continue]').count(),0);
    const afterResponse=await fetch(backend+'/wizard/hermes/api/sessions?limit=50'),after=(await afterResponse.json()).data[0];
    assert.equal(after.status,'running');assert.equal(after.wizard_helper_status.phase,'integrating');assert.equal(after.wizard_helper_status.resumeEligible,false);
    assert.deepEqual(errors,[]);await page.screenshot({path:path.join(OUT,shell+'-delivered-integrating.png')});
    receipts.push({shell,listStatus:row.status,phase:row.wizard_helper_status.phase,working:group,continueStatus:continueResponses[0],nativeLockedDispatches:admissions.length,unlockedDispatches:unlockedDispatches.length,model:admissions[0].body.model,provider:admissions[0].body.provider,idempotencyKey:admissions[0].key,afterPhase:after.wizard_helper_status.phase,repeatContinueButtons:0,errors,writesIntercepted:writes});
    console.log('DELIVERED_UI_GREEN '+JSON.stringify(receipts.at(-1)));
   }finally{await ctx.close();await new Promise(r=>originServer.close(r));await new Promise(r=>service.close(r));}
  });
 }finally{await browser.close();}
 fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({host:require('node:os').hostname(),backend:WAS,web:WEB,fixtureOnly:true,receipts},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
