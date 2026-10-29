import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { initialize,openList,rowFor,actionable,input,expandList,backToList,diagnostics,armPaint,verifyServingBytes } from './browser-preparation.mjs';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [service, ux, out, label]=process.argv.slice(2).map((s,i)=>i<3?resolve(s):s);
const own=resolve(fileURLToPath(new URL('.',import.meta.url)));
mkdirSync(out,{recursive:true});const fixtureRoot=join(out,'fixture');mkdirSync(fixtureRoot);
const log=openSync(join(out,'fixture.log'),'w');
const child=spawn(process.execPath,['--cpu-prof',`--cpu-prof-dir=${out}`,join(own,'fixture.mjs'),service,ux,fixtureRoot],{stdio:['ignore',log,log,'ipc']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results={label,source:{service,ux},network:'loopback, no network throttle; phone-sized touch emulation, not physical-device proof',api:[],browser:[],failures:[]};
const save=()=>writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));
const stats=values=>{const s=[...values].sort((a,b)=>a-b);return {n:s.length,p50:s[Math.ceil(s.length*.5)-1],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)}};
let origin, pumping=false,pump;
try {
 for(let i=0;i<150&&!existsSync(join(fixtureRoot,'ready.json'));i++){if(child.exitCode!==null)throw Error(`fixture exited ${child.exitCode}`);await sleep(100)}
 const ready=JSON.parse(readFileSync(join(fixtureRoot,'ready.json')));origin=ready.origin;results.fixture=ready;
 results.served_assets=await verifyServingBytes(origin,ux);
 const get=async p=>{const r=await fetch(origin+p,{signal:AbortSignal.timeout(30000)});const body=await r.text();assert.equal(r.status,200,`${p}: ${r.status} ${body.slice(0,120)}`);return body};
 await get('/wizard/hermes/api/sessions?limit=100&view=list');
 pumping=true;pump=(async()=>{while(pumping){const start=performance.now();try{await get('/wizard/hermes/api/sessions?limit=100&view=list');appendFileSync(join(out,'list-overlap.jsonl'),JSON.stringify({at:start,ms:performance.now()-start})+'\n')}catch(e){results.failures.push(String(e));}await sleep(30)}})();
 for(const [name,path,budget] of [['health','/wizard/health',100],['detail','/wizard/hermes/api/sessions/wizard_speed_1?view=detail',200],['history','/wizard/hermes/api/sessions/wizard_speed_1/messages?order=oldest&limit=500&include_compacted=true&view=wizard',200]]){
  const samples=[];for(let i=0;i<50;i++){const at=performance.now(),body=await get(path),ms=performance.now()-at;samples.push(ms);appendFileSync(join(out,'api.jsonl'),JSON.stringify({name,i,at,ms,bytes:body.length})+'\n');await sleep(25)}
  const item={name,...stats(samples),budget_ms:budget};item.pass=item.p95<budget;results.api.push(item);save();
 }
 results.listCache=JSON.parse(await get('/wizard/list-cache'));
 const require=createRequire(import.meta.url),{chromium}=require(process.env.QA_PLAYWRIGHT);
 const browser=await chromium.launch({executablePath:process.env.QA_CHROME});
 try {
 for(const shell of ['phone','desktop'])for(const skin of ['nebula','signal']){
  const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1280,height:900},isMobile:shell==='phone',hasTouch:shell==='phone',serviceWorkers:'block'});
  const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];let releasePendingSend;page.on('pageerror',e=>errors.push(String(e)));
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.fulfill({status:403,body:'Synthetic fixture blocks external requests'}));
  await initialize(ctx,skin);
  await ctx.addInitScript(()=>{
   const base=window.fetch;window.__speedRequests=[];
   window.fetch=async(...args)=>{const url=String(args[0]),at=performance.now();const r=await base(...args);if(url.includes('/messages?')||url.includes('view=detail'))window.__speedRequests.push({url,request:at,response:performance.now()});return r};
  });
  try {
   const wid=await openList(page,origin,shell);
   await page.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
   await expandList(page,wid,shell);
   for(const state of ['current','empty','stale']){
    const samples=[];
    for(let n=1;n<=30;n++){
     const id=`wizard_speed_${n}`;
     const history=JSON.parse(await get(`/wizard/hermes/api/sessions/${id}/messages?order=oldest&limit=500&include_compacted=true&view=wizard`));
     const marker=(history.data||history.messages).at(-1).content.split('\n')[0];
     const navigation=n>1||state!=='current'?await backToList(page,wid,shell):{contract:'initial-owned-list'};
     await expandList(page,wid,shell);
     await page.evaluate(async({id,state})=>{if(state==='empty')await WizLive.forgetMessages(id)}, {id,state});
     if(state!=='empty')await page.evaluate(async id=>{await WizLive.sessionInfo(id);await WizLive.messages(id)},id);
     let expected=marker;
     if(state==='stale'){
      const oldKey=await page.evaluate(id=>WizLive.contentKey(WizLive.session(id)),id);
      const stamp=Date.now()/1000;
      // Mutate only this process's disposable canonical fixture via IPC.
      expected=`SYNTHETIC_CURRENT_ANSWER_${n}_v${Math.trunc(stamp*1e6)}`;
      await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('fixture revision ack timeout')),10000);const fn=m=>{if(m.id===id){clearTimeout(t);child.off('message',fn);res()}};child.on('message',fn);child.send({op:'answer',id,text:expected,stamp})});
      // Only a live list update can vouch for content revision. Detail hydrates
      // optional rename/retry metadata and intentionally does not replace counts.
      await page.waitForFunction(async({id,oldKey})=>{await WizLive.refresh();return WizLive.contentKey(WizLive.session(id))!==oldKey},{id,oldKey},{timeout:15000,polling:250});
      assert.equal(await page.evaluate(id=>!!WizLive.cachedMessages(id),id),false,'old answer must not be accepted as current');
     }
     // Empty is asserted immediately before tapping; accidental prefetch cannot
     // make a cold sample pass as warm.
     if(state==='empty')assert.equal(await page.evaluate(id=>!!WizLive.cachedMessages(id),id),false);
     if(state==='current')assert.equal(await page.evaluate(id=>!!WizLive.cachedMessages(id),id),true);
     await expandList(page,wid,shell); // canonical refresh may have re-rendered the list
     const row=rowFor(page,wid,id),geometry=await actionable(row);
     await armPaint(page,wid,expected,state==='stale'?marker:'');
     await page.evaluate(()=>{window.__speedRequests=[]});
     await input(row,shell);
     await page.waitForFunction(()=>window.__speed?.first!==null,null,{timeout:15000});
     const trace=await page.evaluate(()=>({tap:window.__speed.start,ms:window.__speed.first,expected:window.__speed.expected,stale:window.__speed.stale,requests:window.__speedRequests}));
     assert.ok(trace.tap>0,'the measured row received actual pointer input');
     assert.equal(trace.stale,false,'a stale cached answer never paints in this open');
     const header=await page.locator(`[data-win="${wid}"] .ch-thread .ch-head:visible`).evaluate(e=>{
      const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
      return {text:e.innerText,x,y,width:b.width,height:b.height,hit:e.contains(document.elementFromPoint(x,y)),backVisible:[...e.querySelectorAll('[data-chback]')].some(b=>b.getClientRects().length>0)};
     });
     assert.ok(header.width>0&&header.height>0&&header.hit,'owned current thread header remains on screen');
     assert.equal(header.backVisible,shell==='phone','phone Back / wide desktop persistent-list contract');
     assert.equal(await page.evaluate(wid=>(window.__wos||window.__wux).wins[wid]?.thread,wid),id,'current header belongs to opened thread');
     trace.geometry=geometry;trace.navigation=navigation;trace.header=header;samples.push(trace.ms);
     appendFileSync(join(out,'tap-traces.jsonl'),JSON.stringify({shell,skin,state,n,id,...trace})+'\n');
     if(n===1){await page.screenshot({path:join(out,`${shell}-${skin}-${state}.png`)});}
    }
    const record={shell,skin,state,...stats(samples),budget_ms:state==='current'?150:1000};record.pass=record.p95<record.budget_ms;results.browser.push(record);save();
   }
   // Long history uses the same actual owned-row input and viewport paint proof.
   await backToList(page,wid,shell);await expandList(page,wid,shell);
   await page.evaluate(async()=>{await WizLive.forgetMessages('wizard_speed_0');window.__speedRequests=[]});
   const longRow=rowFor(page,wid,'wizard_speed_0');await actionable(longRow);
   await armPaint(page,wid,'SYNTHETIC_CURRENT_ANSWER_0_v1');await input(longRow,shell);
   await page.waitForFunction(()=>window.__speed?.first!==null);
   const longPages=await page.evaluate(()=>window.__speedRequests.filter(r=>{const u=new URL(r.url,location.origin);return u.pathname.endsWith('/wizard_speed_0/messages')&&u.searchParams.get('limit')==='500'}).map(r=>Number(new URL(r.url,location.origin).searchParams.get('offset'))));
   assert.deepEqual(longPages,[0,500,1000],'1200 messages traverse three real pages before newest answer paints');
   assert.deepEqual(errors,[]);results.browser.push({shell,skin,case:'long-history-and-no-js-errors',offsets:longPages,pass:true});
   // Use the shipped durable enqueue API, not an injected _items entry. Hold its
   // browser admission before Service so no fixture upstream write can execute.
   const hangId='wizard_speed_400',pattern='**/sessions/wizard_speed_400/messages?**',sendPattern='**/wizard/hermes/v1/runs*';
   let release,releaseSend,sendAttempts=0;const held=new Promise(r=>{release=r}),heldSend=new Promise(r=>{releaseSend=r});
   releasePendingSend=releaseSend; // remain fenced through prefetch and context teardown
   await page.route(pattern,async route=>{await held;await route.abort().catch(()=>{})});
   await page.route(sendPattern,async route=>{sendAttempts++;await heldSend;await route.abort().catch(()=>{})});
   try{
    await backToList(page,wid,shell);await expandList(page,wid,shell);
    const custody=await page.evaluate(async({wid,id})=>{const H=window.__wux||window.__wos;await WizLive.forgetMessages(id);const it=await H.outbox.enqueue({kind:'reply',source:'voice',sessionId:id,text:'SYNTHETIC_PENDING_VOICE',wid,model:'fixture',provider:'synthetic'});return {id:it.id,durable:it.durable,state:it.state}}, {wid,id:hangId});
    assert.ok(custody.durable,'pending voice preparation owns real durable device custody');
    const hangRow=rowFor(page,wid,hangId);await actionable(hangRow);await input(hangRow,shell);
    const pane=`[data-win="${wid}"]`;
    await page.locator(`${pane} .ch-skel.thread:visible`).waitFor();
    await page.locator(`${pane} .msg.pending`).filter({hasText:'SYNTHETIC_PENDING_VOICE'}).waitFor({state:'visible'});
    // The shipped history read deadline is 12 s; 14 s bounds visible retry proof.
    const retry=page.locator(`${pane} [data-chretry]:visible`).last();await retry.waitFor({timeout:14000});
    assert.ok(sendAttempts>0,'the real outbox attempted the held synthetic admission');
    assert.ok(await page.locator(`${pane} .msg.pending`).filter({hasText:'SYNTHETIC_PENDING_VOICE'}).isVisible());
    release();await page.unroute(pattern);await actionable(retry);await input(retry,shell);
    await page.locator(`${pane} .msg.a`).filter({hasText:'SYNTHETIC_CURRENT_ANSWER_400_v1'}).last().waitFor({state:'visible'});
    results.browser.push({shell,skin,case:'pending-voice-hang-deadline-retry',custody_id:custody.id,durable:custody.durable,held_send_attempts:sendAttempts,pass:true});
   }finally{release();await page.unroute(pattern)}
   // The production preload cap is applied before selecting a short (one-page)
   // Ready row. A long background-heartbeat row cannot turn one read into many.
   const prefetch=await page.evaluate(async()=>{
    const g=WizLive.workGroups(),want=[...(g.ready||[]),...(g.errors||[]),...(g.working||[])].filter(s=>!s.archived&&!s.hidden&&!s.optimistic&&!s.synthetic&&!WizLive.agentOf(s.id)).slice(0,16);
    const index=want.findIndex(s=>g.ready.includes(s)&&s.messageCount>0&&s.messageCount<500);
    if(index<0)throw Error('No one-page Ready row in the real first-16 preload window');
    const s=want[index];await WizLive.forgetMessages(s.id);return {id:s.id,index,messageCount:s.messageCount};
   });
   const prefetchId=prefetch.id;
   let prefetchReads=0;const count=r=>{if(new URL(r.url()).pathname.endsWith('/'+prefetchId+'/messages'))prefetchReads++};page.on('request',count);
   await page.evaluate(()=>{navigator.connection.saveData=false;return WizLive.refresh()});
   await page.waitForFunction(id=>!!WizLive.cachedMessages(id),prefetchId,{timeout:15000});
   assert.equal(prefetchReads,1,'exactly one actual background prefetch');page.off('request',count);
   results.browser.push({shell,skin,case:'ready-prefetch-uses-existing-current-cache',...prefetch,history_reads:prefetchReads,pass:true});
   assert.deepEqual(errors,[],'no shell exceptions through the entire cell');
  }catch(e){results.failures.push(`${shell}/${skin}: ${e.stack}`);writeFileSync(join(out,`${shell}-${skin}-diagnostic.json`),JSON.stringify(await diagnostics(page).catch(e=>({error:String(e)})),null,2));await page.screenshot({path:join(out,`${shell}-${skin}-failure.png`)}).catch(()=>{});save();}
  finally{releasePendingSend?.();await ctx.close()}
 }
 } finally {await browser.close()}
} catch(e){results.failures.push(e.stack)}
finally{
 pumping=false;if(pump)await pump.catch(()=>{});child.kill('SIGTERM');
 await Promise.race([new Promise(r=>child.once('exit',r)),sleep(10000)]);if(child.exitCode===null){child.kill('SIGKILL');results.failures.push('fixture did not drain')}
 closeSync(log);
 if(existsSync(join(fixtureRoot,'custody.json'))){results.custody=JSON.parse(readFileSync(join(fixtureRoot,'custody.json')));if(results.custody.upstreamWrites)results.failures.push('upstream write attempted')}
 else results.failures.push('missing fixture custody receipt');
 results.complete=results.api.length===3&&results.browser.filter(r=>r.state).length===12&&results.browser.filter(r=>r.case).length===12;
 results.expected={api_groups:3,api_samples_each:50,tap_groups:12,tap_samples_each:30,browser_cases:12};
 results.complete=results.complete&&results.api.every(r=>r.n===50)&&results.browser.filter(r=>r.state).every(r=>r.n===30);
 results.budgets_pass=results.complete&&!results.failures.length&&[...results.api,...results.browser].every(r=>r.pass);
 save();console.log(JSON.stringify({label,complete:results.complete,budgets_pass:results.budgets_pass,failures:results.failures}));
}
// Baseline violations are measurements, not a gate. Candidate violations fail.
if(label==='candidate'&&!results.budgets_pass)process.exitCode=1;
