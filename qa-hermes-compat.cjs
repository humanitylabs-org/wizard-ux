// Phone-sized real shell; all transport is synthetic and intercepted (no live account).
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = __dirname, out = process.env.QA_OUT || path.join(root, 'qa-evidence'); fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:412,height:892},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const now=Date.now()/1000, writes=[], checks=[], errors=[];
 const session={id:'qa_compat',source:'wizard-mobile',title:'Compatibility fixture',status:'unknown',wizard_run_id:'wizardq_0123456789abcdef0123456789abcdef',message_count:1,started_at:now-90,last_active:now,wizard_last_user_at:now-60};
 let run={run_id:session.wizard_run_id,status:'unknown',admission_id:'adm_fixture',execution_generation:7}, conflict=false, hold=null, recoverySupported=true;
 const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('PASS',label)};
 await context.route('**/*',async route=>{
   const req=route.request(), u=new URL(req.url()); const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(u.pathname.startsWith('/wizard-os-home/')) { const name=u.pathname.slice('/wizard-os-home/'.length)||'index.html', f=path.resolve(root,'web',name); if(f.startsWith(path.join(root,'web')+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':f.endsWith('.js')?'application/javascript':'application/octet-stream',body:fs.readFileSync(f)}); }
    if(req.resourceType()==='script')return route.fulfill({contentType:'application/javascript',body:'/* optional external script omitted in isolated fixture */'});
   if(req.method()!=='GET'){writes.push({path:u.pathname,body:req.postDataJSON()}); if(/\/(approval|clarify|resolve-unknown|stop)$/.test(u.pathname)) {if(hold)await new Promise(resolve=>hold.resolve=resolve); if(conflict)return json({error:{code:'stale_generation'}},409); run.status='completed';session.status='completed';return json({status:'resolved',outcome:'interrupted'});} return json({ok:true});}
   if(u.pathname.endsWith('/v1/capabilities'))return json({features:{run_unknown_resolution:recoverySupported}});
   if(u.pathname.endsWith('/api/sessions'))return json({data:[session],pagination:{total:1,returned:1,limit:500,offset:0}});
   if(u.pathname.endsWith('/qa_compat/messages'))return json({data:[{id:1,role:'user',content:'Synthetic compatibility check',timestamp:now-60}],pagination:{returned:1}});
   if(u.pathname.endsWith('/qa_compat'))return json({session});
   if(u.pathname.includes('/v1/runs/'))return json(run);
   if(u.pathname.endsWith('/config'))return json({});
   return json({data:[],apps:[],agents:[]});
 });
 const page=await context.newPage();page.on('pageerror',e=>{errors.push(String(e));console.error('PAGEERROR',String(e),e.stack)});page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.rvCoached','true')});
 const current=()=>page.evaluate(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats');return {wid:w?.id,thread:w?.thread,ap:w&&__wos.chatState(w.id).approval}});
 const refresh=async()=>{await page.evaluate(async()=>{await __wos.live.refresh();const w=Object.values(__wos.wins).find(w=>w.app==='chats');if(w){const c=__wos.chatState(w.id);if(c.approval)c.approval.at=0;await __wos.chats.loadThread(w,true)}})};
 try {
  await page.goto('http://compat.test/wizard-os-home/'); await page.waitForFunction(()=>window.__wos?.live?.session('qa_compat'));
  await page.evaluate(()=>__wos.openWizardThread('qa_compat')); await page.locator('[data-approve="resolve"]').waitFor();
  check((await page.locator('.appr').innerText()).includes('Needs recovery'),'unknown is labelled Needs recovery');
  await page.locator('.ch-compose textarea').fill('Keep my unsent draft');
  await page.waitForTimeout(600); const box=await page.locator('.appr').boundingBox();check(box.x>=0&&box.x+box.width<=412,'recovery controls fit the settled phone viewport');
  await page.screenshot({path:path.join(out,'unknown-phone.png'),fullPage:true});
  // Remote generation changes after render: the click must carry 7, never current 8.
  run.execution_generation=8;conflict=true; await page.locator('[data-approve="resolve"]').click();
  await page.waitForFunction(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats');return __wos.chatState(w.id).approval?.generation===8});
  check(writes.find(x=>x.path.endsWith('/resolve-unknown')).body.execution_generation===7,'stale recovery click preserves displayed generation');
  check(await page.locator('.ch-compose textarea').inputValue()==='Keep my unsent draft','draft survives stale recovery');
  conflict=false; await page.locator('[data-approve="resolve"]').click(); await page.waitForTimeout(150);
  check(writes.filter(x=>x.path.endsWith('/resolve-unknown')).length===2,'stale recovery does not automatically resubmit');
  // Canonical approval identity and changed prompt while POST is outstanding.
  session.status='waiting_for_approval';run={status:session.status,pending_controls:[{kind:'approval',prompt_id:'prompt-a',execution_generation:9,command:'owned fixture action',choices:['once','deny']}]};await refresh();await page.locator('[data-approve="deny"]').waitFor();
  const second=await context.newPage();await second.goto('http://compat.test/wizard-os-home/');await second.waitForFunction(()=>window.__wos?.live?.session('qa_compat'));await second.evaluate(()=>__wos.openWizardThread('qa_compat'));await second.locator('[data-approve="deny"]').waitFor();
  hold={}; await page.locator('[data-approve="deny"]').click(); await page.waitForTimeout(80);
  const first=writes.find(x=>x.path.endsWith('/approval')); check(JSON.stringify(first.body)===JSON.stringify({choice:'deny',request_id:'prompt-a',execution_generation:9}),'canonical approval exact body');
  conflict=true;run.pending_controls=[{kind:'approval',prompt_id:'prompt-b',execution_generation:10,command:'different action',choices:['once','deny']}];hold.resolve();hold=null;
  await page.waitForFunction(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats');return __wos.chatState(w.id).approval?.requestId==='prompt-b'});
  check(!(await current()).ap.resolved,'stale approval refresh is not reported as answered');
  await second.locator('[data-approve="deny"]').click();await second.waitForFunction(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats');return __wos.chatState(w.id).approval?.requestId==='prompt-b'});
  check(writes.filter(x=>x.path.endsWith('/approval')).at(-1).body.request_id==='prompt-a','second-view stale click never adopts the next prompt');await second.close();
  conflict=false;run={status:'running',pending_controls:[{kind:'clarify',prompt_id:'question-a',execution_generation:11,question:'Which colour?',choices:['BLUE','GREEN']}]};session.status='running';await refresh();await page.locator('[data-clarify-answer]').waitFor();await page.locator('[data-clarify-answer]').fill('A custom colour');await page.locator('[data-approve="__answer"]').click();
  const answer=writes.find(x=>x.path.endsWith('/clarify'));check(JSON.stringify(answer.body)===JSON.stringify({request_id:'question-a',execution_generation:11,answer:'A custom colour'}),'clarification goes to clarify, not a new inference turn');
  session.status='waiting_for_approval';run={status:session.status,approval:{request_id:'old-prompt',command:'legacy action',choices:['once','deny']}};await refresh();await page.locator('[data-approve="deny"]').waitFor();await page.locator('[data-approve="deny"]').click();
  const legacy=writes.filter(x=>x.path.endsWith('/approval')).at(-1);check(!('execution_generation' in legacy.body)&&legacy.body.request_id==='old-prompt','legacy approval format unchanged');
  // An answered control never comes back, even while the runtime snapshot still lists it (James, 23 Oct: Deny looped).
  const stuck=()=>{session.status='waiting_for_approval';run={status:session.status,approval:{request_id:'stuck-prompt',command:'stuck action',choices:['once','session','always','deny']}}};
  stuck();await refresh();await page.locator('[data-approve="deny"]').waitFor();await page.locator('[data-approve="deny"]').click();await page.waitForTimeout(150);
  stuck();await refresh();await page.waitForTimeout(100);
  check(await page.locator('[data-approve="deny"]').count()===0&&(await page.locator('.appr.done').innerText()).includes('Denied'),'stale snapshot after Deny keeps the Denied receipt, no buttons');
  const toasts=()=>page.evaluate(()=>{const t=document.getElementById('toast');return t&&/This control changed/.test(t.textContent)&&+getComputedStyle(t).opacity>0?1:0});
  session.status='waiting_for_approval';run={status:session.status,approval:{request_id:'gone-prompt',command:'gone action',choices:['once','deny']}};conflict=true;await refresh();await page.locator('[data-approve="deny"]').waitFor();await page.waitForTimeout(3200);
  await page.locator('[data-approve="deny"]').click();await page.waitForTimeout(200);await refresh();await page.waitForTimeout(100);
  check(await page.locator('[data-approve="deny"]').count()===0&&(await page.locator('.appr.done').innerText()).includes('No longer waiting'),'409 on the displayed control retires it instead of re-offering it');
  check(await toasts()===0,'retired control raises no "control changed" toast');
  check(writes.filter(x=>x.path.endsWith('/approval')&&x.body.request_id==='gone-prompt').length===1,'retired control is answered once, no loop');
  run.approval={request_id:'new-prompt',command:'new action',choices:['once','deny']};await refresh();await page.locator('[data-approve="deny"]').waitFor();
  check(true,'a genuinely new prompt still appears after a retired one');conflict=false;
  // 409 stop never paints stopping and never invokes resolution.
  session.status='unknown';run={status:'unknown',admission_id:'adm_fixture',execution_generation:12};conflict=true;await refresh();await page.evaluate(()=>__wos.live.stop('wizardq_0123456789abcdef0123456789abcdef').catch(()=>{}));await page.waitForTimeout(100);
  check(await page.evaluate(()=>__wos.live.session('qa_compat').status)==='unknown','stop 409 preserves unknown state');
  recoverySupported=false;await refresh();check(await page.locator('[data-approve="resolve"]').count()===0,'runtime without advertised recovery has no recovery button');
  await page.evaluate(()=>__wosNativeBack());await page.waitForTimeout(100);check((await current()).thread===null,'Back leaves thread for list');await page.evaluate(()=>__wosNativeBack());check(await page.evaluate(()=>document.visibilityState==='visible'&&!!__wos),'Back keeps app open');
  check(!writes.some(x=>/\/v1\/runs$/.test(x.path)),'controls never send a new inference turn');check(errors.length===0,'zero browser page errors');
  fs.writeFileSync(path.join(out,'browser-receipt.json'),JSON.stringify({scope:'phone real shell, synthetic intercepted transport',checks,writes,errors},null,2));
 } finally {if(hold?.resolve)hold.resolve();await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
