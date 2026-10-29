import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { initialize,openList,rowFor,actionable,input,expandList,backToList,diagnostics,armPaint,verifyServingBytes } from './browser-preparation.mjs';
import { historyRevision,assessCache,cacheEvidence,waitForRevision } from './cache-evidence.mjs';
import {SAMPLE_IDS,implementationCaps,assertOldCopy,waitForRevisions,exactMatrix} from './batch-preparation.mjs';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [service, ux, out, label]=process.argv.slice(2).map((s,i)=>i<3?resolve(s):s);
const own=resolve(fileURLToPath(new URL('.',import.meta.url)));
mkdirSync(out,{recursive:true});const fixtureRoot=join(out,'fixture');mkdirSync(fixtureRoot);
const log=openSync(join(out,'fixture.log'),'w');
const child=spawn(process.execPath,['--cpu-prof',`--cpu-prof-dir=${out}`,join(own,'fixture.mjs'),service,ux,fixtureRoot],{stdio:['ignore',log,log,'ipc']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const caps=implementationCaps(ux);
const results={label,source:{service,ux},implementation_caps:caps,network:'loopback, no network throttle; phone-sized touch emulation, not physical-device proof',api:[],browser:[],failures:[]};
const save=()=>writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));
const mutateAnswer=async(id,n)=>{
 const stamp=Date.now()/1000,text=`SYNTHETIC_CURRENT_ANSWER_${n}_v${Math.trunc(stamp*1e6)}`;
 const source=await new Promise((res,rej)=>{const t=setTimeout(()=>{child.off('message',fn);rej(Error('fixture revision ack timeout'))},10000);const fn=m=>{if(m.id===id){clearTimeout(t);child.off('message',fn);res(m.revision)}};child.on('message',fn);child.send({op:'answer',id,text,stamp})});
 // The Service projects internal status markers out of history. Compare accepted
 // content to THAT real public projection, and bind it back to canonical IPC truth.
 const response=await fetch(origin+`/wizard/hermes/api/sessions/${id}/messages?order=oldest&limit=500&include_compacted=true&view=wizard`);
 assert.equal(response.status,200);const data=await response.json(),projected=historyRevision(data.data||data.messages);
 assert.equal(projected.key,source.key,'Service history contains the exact committed canonical revision');
 assert.equal(projected.marker,source.marker,'Service projected the exact newly committed answer');
 return {...projected,sourceContentSha256:source.contentSha256};
};
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
  const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];let releasePendingSend,activeSample=null;
  const historyGates=new Map();page.on('pageerror',e=>errors.push(String(e)));
  const evidence=(phase,snapshot)=>appendFileSync(join(out,'cache-evidence.jsonl'),JSON.stringify({shell,skin,...activeSample,phase,snapshot})+'\n');
  const ipc=m=>new Promise((res,rej)=>{
   const timer=setTimeout(()=>{child.off('message',fn);rej(Error('fixture inspect timeout'))},10000);
   const fn=r=>{if(r.op===m.op&&r.id===m.id){clearTimeout(timer);child.off('message',fn);res(r)}};
   child.on('message',fn);child.send(m);
  });
  const seedHistory=async(id,canonical)=>{
   // An earlier open's in-flight read has its original captured key. Drain that
   // read, then require a completed real read captured under the exact old key.
   for(let attempt=0;attempt<3;attempt++){
    await page.evaluate(id=>WizLive.messages(id),id);
    const s=await cacheEvidence(page,id);evidence('seed-history-read',{attempt,canonical,...s});
    if(assessCache(s,canonical)==='current-copy-refilled')return;
   }
   throw Error('real current transcript did not establish a current cache');
  };
  await page.exposeBinding('__speedReleaseHistory',(_,id)=>{const gate=historyGates.get(id);if(gate&&gate.releasedAt===null){gate.releasedAt=Date.now();gate.release()}});
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.fulfill({status:403,body:'Synthetic fixture blocks external requests'}));
  await initialize(ctx,skin);
  await ctx.addInitScript(()=>{
   const base=window.fetch;window.__speedRequests=[];window.__speedTraffic=[];
   window.fetch=async(...args)=>{
    const url=String(args[0]),parsed=new URL(url,location.origin),tracked=url.includes('/messages?')||url.includes('view=detail');
    const id=parsed.pathname.match(/\/sessions\/([^/]+)\/messages$/)?.[1];
    const item=tracked?{url,request:performance.now(),response:null,pending:true,capturedKey:id&&window.WizLive?.contentKey(WizLive.session(id))}:null;
    if(item){window.__speedTraffic.push(item);if(window.__speedTraffic.length>300)window.__speedTraffic.shift()}
    try{const r=await base(...args);if(parsed.pathname==='/wizard/hermes/api/sessions'&&parsed.searchParams.get('view')==='list'&&!parsed.searchParams.has('fields')){
      const p=await r.clone().json();window.__speedRawList={status:r.status,at:performance.now(),rows:(p.data||p.sessions||[]).map(s=>({id:s.id,messageCount:s.messageCount,lastAssistantAt:s.lastAssistantAt,lastUserAt:s.lastUserAt}))};
    }
    if(item){Object.assign(item,{response:performance.now(),pending:false,status:r.status});window.__speedRequests.push({...item});
      r.clone().json().then(j=>{const rows=j.data||j.messages;if(Array.isArray(rows))item.content={count:rows.length,lastAssistant:rows.filter(r=>r.role==='assistant').at(-1)}}).catch(()=>{});
    }return r}catch(e){if(item)Object.assign(item,{pending:false,error:String(e)});throw e}
   };
   document.addEventListener('pointerdown',e=>{
    const row=e.target.closest('[data-chopen]'),s=window.__speed;
    if(row&&s?.historyGateId===row.dataset.chopen&&row.closest('[data-win]')?.dataset.win===s.wid)window.__speedReleaseHistory(s.historyGateId);
   },true);
  });
  try {
   const wid=await openList(page,origin,shell);
   await page.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
   await expandList(page,wid,shell);
   for(const state of ['current','empty','stale']){
    const samples=[],canonicalById=new Map(),oldById=new Map();
    activeSample={state,phase:'batch-preparation'};
    // Park wide desktop on an UNAFFECTED real row; phone returns via its real
    // Back control. No active target may launch an old-revision read on refresh.
    if(state!=='current')await backToList(page,wid,shell);
    await expandList(page,wid,shell);
    if(shell==='desktop'){
     const control=rowFor(page,wid,'wizard_speed_31');await actionable(control);await input(control,shell);
     await page.locator(`[data-win="${wid}"] .msg.a`).filter({hasText:'SYNTHETIC_CURRENT_ANSWER_31_v1'}).last().waitFor({state:'visible'});
    }
    for(const id of SAMPLE_IDS){
     const h=JSON.parse(await get(`/wizard/hermes/api/sessions/${id}/messages?order=oldest&limit=500&include_compacted=true&view=wizard`));
     canonicalById.set(id,historyRevision(h.data||h.messages));
    }
    await waitForRevisions(page,canonicalById,s=>evidence('batch-initial-exact-revisions',s));
    if(state==='stale'){
     await page.waitForFunction(ids=>!(window.__speedTraffic||[]).some(r=>r.pending&&ids.some(id=>r.url.includes('/'+id+'/messages?'))),SAMPLE_IDS);
     for(const id of SAMPLE_IDS){await page.evaluate(id=>WizLive.sessionInfo(id),id);await seedHistory(id,canonicalById.get(id));}
     await page.waitForFunction(ids=>!(window.__speedTraffic||[]).some(r=>r.pending&&ids.some(id=>r.url.includes('/'+id+'/messages?'))),SAMPLE_IDS);
     // All 30 old copies coexist below the actual TC_MAX (40 in these exports).
     // Cache reads are observations; the only writes were the real history APIs.
     for(const id of SAMPLE_IDS){
      const old=canonicalById.get(id),seeded=await cacheEvidence(page,id);
      assert.equal(assessCache(seeded,old),'current-copy-refilled');
      assert.equal(historyRevision(seeded.persisted.rows).contentSha256,old.contentSha256);
      assert.ok(JSON.stringify(seeded.accepted).length<=caps.bytes);oldById.set(id,old);
      evidence('batch-seeded-old-copy',{id,canonical:old,...seeded});
     }
     evidence('batch-drained-inflight',{traffic:await page.evaluate(()=>window.__speedTraffic)});
     await page.evaluate(()=>{window.__speedTraffic=[]});
     for(const id of SAMPLE_IDS){
      let release;const held=new Promise(r=>{release=r}),pattern=`**/sessions/${id}/messages?**`;
      const gate={id,pattern,release,releasedAt:null,requests:[]};historyGates.set(id,gate);
      await page.route(pattern,async route=>{gate.requests.push({url:route.request().url(),at:Date.now()});await held;await route.continue().catch(()=>{})});
     }
     const started=Date.now();
     for(const [i,id] of SAMPLE_IDS.entries()){
      const canonical=await mutateAnswer(id,i+1);assert.equal(canonical.messageCount,oldById.get(id).messageCount+2);canonicalById.set(id,canonical);
     }
     // One whole-batch barrier per cell, capped at the r11-proven 45 s. This is
     // preparation OUTSIDE pointerdown-to-paint; no TTL or oracle is weakened.
     const exact=await waitForRevisions(page,canonicalById,s=>evidence('batch-held-exact-revisions',s));
     for(const id of SAMPLE_IDS){
      const canonical=canonicalById.get(id),db=await ipc({op:'inspect',id}),invalid=await cacheEvidence(page,id),gate=historyGates.get(id);
      assert.equal(db.actualCount,canonical.messageCount);assert.equal(db.session.message_count,canonical.messageCount);
      assert.equal(db.revision.key,canonical.key);assert.equal(db.canonicalReader.row.message_count,canonical.messageCount);
      assertOldCopy(invalid,oldById.get(id),canonical);assert.equal(gate.releasedAt,null);
      assert.equal(gate.requests.length,0,'no old-key in-flight target read was captured by the fence');
      evidence('batch-ready',{id,canonical,old:oldById.get(id),db,raw:exact.raw.rows.find(s=>s.id===id),elapsed_ms:Date.now()-started,...invalid});
     }
    }
    for(let n=1;n<=30;n++){
     const id=SAMPLE_IDS[n-1],canonical=canonicalById.get(id),marker=oldById.get(id)?.marker||canonical.marker,expected=canonical.marker;
     const historyGate=historyGates.get(id);
     activeSample={state,n,id};
     const navigation=n>1?await backToList(page,wid,shell):{contract:shell==='desktop'?'prepared-persistent-split-list':'prepared-owned-list'};
     await expandList(page,wid,shell);
     await waitForRevision(page,id,canonical,s=>evidence('sample-exact-revision',s));
     if(state==='empty')await page.evaluate(id=>WizLive.forgetMessages(id),id);
     if(state==='current'){await page.evaluate(id=>WizLive.sessionInfo(id),id);await seedHistory(id,canonical);}
     // Empty is asserted immediately before tapping; accidental prefetch cannot
     // make a cold sample pass as warm.
     if(state==='empty')assert.equal(await page.evaluate(id=>!!WizLive.cachedMessages(id),id),false);
     if(state==='current')assert.equal(await page.evaluate(id=>!!WizLive.cachedMessages(id),id),true);
     await expandList(page,wid,shell); // canonical refresh may have re-rendered the list
     const row=rowFor(page,wid,id),geometry=await actionable(row);
     await armPaint(page,wid,expected,state==='stale'?marker:'');
     if(state==='stale'){
      const atTap=await cacheEvidence(page,id);evidence('immediately-before-tap',{canonical,gate:{releasedAt:historyGate.releasedAt,requests:historyGate.requests},...atTap});
      assertOldCopy(atTap,oldById.get(id),canonical);
      assert.equal(historyGate.releasedAt,null,'target remains fenced immediately before actual input');
      const remaining=[...historyGates.values()].filter(g=>g.releasedAt===null).length;
      assert.equal(remaining,31-n,'only previously tapped targets have been released');
      assert.equal(historyGate.requests.length,0,'no pre-tap old-revision read is hidden in INFLIGHT');
      await page.evaluate(id=>{window.__speed.historyGateId=id},id);
     }
     const immediatelyBefore=await cacheEvidence(page,id);
     evidence('all-states-immediately-before-tap',{canonical,...immediatelyBefore});
     if(state==='empty')assert.equal(immediatelyBefore.accepted,null,'cold stays cold through final actionability');
     if(state==='current')assert.equal(assessCache(immediatelyBefore,canonical),'current-copy-refilled');
     if(state==='stale')assertOldCopy(immediatelyBefore,oldById.get(id),canonical);
     await page.evaluate(()=>{window.__speedRequests=[]});
     await input(row,shell);
     await page.waitForFunction(()=>window.__speed?.first!==null,null,{timeout:15000});
     const trace=await page.evaluate(()=>({tap:window.__speed.start,ms:window.__speed.first,expected:window.__speed.expected,stale:window.__speed.stale,requests:window.__speedRequests}));
     assert.ok(trace.tap>0,'the measured row received actual pointer input');
     assert.equal(trace.stale,false,'a stale cached answer never paints in this open');
     if(state==='stale'){
      assert.ok(historyGate.releasedAt,'actual owned-row pointerdown released history');
      assert.ok(historyGate.requests.length,'actual history request crossed the browser gate');
      const after=await cacheEvidence(page,id);evidence('after-current-paint',{canonical,gate:{releasedAt:historyGate.releasedAt,requests:historyGate.requests},...after});
      assert.equal(assessCache(after,canonical),'current-copy-refilled','painted answer also has exact current cache content');
      assert.ok(after.traffic.length);assert.ok(after.traffic.every(r=>r.capturedKey===canonical.key),'every target read captured the exact current revision, never an older in-flight key');
      trace.cache={canonical,old:oldById.get(id),seeded_old_marker:marker,held_requests:historyGate.requests,released_at:historyGate.releasedAt};
      historyGate.release();await page.unroute(historyGate.pattern);historyGates.delete(id);
     }
     const header=await page.locator(`[data-win="${wid}"] .ch-thread .ch-head:visible`).evaluate(e=>{
      const b=e.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
      return {text:e.innerText,x,y,width:b.width,height:b.height,hit:e.contains(document.elementFromPoint(x,y)),backVisible:[...e.querySelectorAll('[data-chback]')].some(b=>b.getClientRects().length>0)};
     });
     assert.ok(header.width>0&&header.height>0&&header.hit,'owned current thread header remains on screen');
     assert.equal(header.backVisible,shell==='phone','phone Back / wide desktop persistent-list contract');
     assert.equal(await page.evaluate(wid=>(window.__wos||window.__wux).wins[wid]?.thread,wid),id,'current header belongs to opened thread');
     trace.geometry=geometry;trace.navigation=navigation;trace.header=header;trace.canonical=canonical;samples.push(trace.ms);
     const painted=await cacheEvidence(page,id);assert.equal(assessCache(painted,canonical),'current-copy-refilled');evidence('all-states-after-current-paint',{canonical,...painted});
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
   assert.deepEqual(errors,[]);results.browser.push({shell,skin,case:'long-history',offsets:longPages,pass:true});
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
    if(label==='baseline'){
     // Older baseline has neither the new skeleton nor bounded history Retry.
     // Record those exact observables, without suppressing later group/case counts.
     await page.locator(`${pane} .msg.pending`).filter({hasText:'SYNTHETIC_PENDING_VOICE'}).waitFor({state:'visible'});
     let retryObserved=true;
     try{await page.locator(`${pane} [data-chretry]:visible`).last().waitFor({timeout:14000})}catch{retryObserved=false}
     const skeletonObserved=await page.locator(`${pane} .ch-skel.thread:visible`).count()>0;
     assert.ok(sendAttempts>0,'baseline real outbox attempted the held admission');
     results.browser.push({shell,skin,case:'pending-voice-hang-deadline-retry',custody_id:custody.id,durable:custody.durable,held_send_attempts:sendAttempts,
      skeleton_observed:skeletonObserved,retry_observed:retryObserved,known_limitation:'Baseline predates visible skeleton and bounded history Retry; not candidate evidence',pass:false});
    }else{
     await page.locator(`${pane} .ch-skel.thread:visible`).waitFor();
     await page.locator(`${pane} .msg.pending`).filter({hasText:'SYNTHETIC_PENDING_VOICE'}).waitFor({state:'visible'});
     // The shipped history read deadline is 12 s; 14 s bounds visible retry proof.
     const retry=page.locator(`${pane} [data-chretry]:visible`).last();await retry.waitFor({timeout:14000});
     assert.ok(sendAttempts>0,'the real outbox attempted the held synthetic admission');
     assert.ok(await page.locator(`${pane} .msg.pending`).filter({hasText:'SYNTHETIC_PENDING_VOICE'}).isVisible());
     release();await page.unroute(pattern);await actionable(retry);await input(retry,shell);
     await page.locator(`${pane} .msg.a`).filter({hasText:'SYNTHETIC_CURRENT_ANSWER_400_v1'}).last().waitFor({state:'visible'});
     results.browser.push({shell,skin,case:'pending-voice-hang-deadline-retry',custody_id:custody.id,durable:custody.durable,held_send_attempts:sendAttempts,pass:true});
    }
   }finally{release();await page.unroute(pattern)}
   // The production preload cap is applied before selecting a short (one-page)
   // Ready row. A long background-heartbeat row cannot turn one read into many.
   const prefetch=await page.evaluate(async({preload:cap,preloadOrder:order})=>{
    const g=WizLive.workGroups(),want=order.flatMap(k=>g[k]||[]).filter(s=>!s.archived&&!s.hidden&&!s.optimistic&&!s.synthetic&&!WizLive.agentOf(s.id)).slice(0,cap);
    const index=want.findIndex(s=>g.ready.includes(s)&&s.messageCount>0&&s.messageCount<500);
    if(index<0)throw Error('No one-page Ready row in the actual capped preload window');
    const s=want[index];await WizLive.forgetMessages(s.id);return {id:s.id,index,messageCount:s.messageCount,cap};
   },caps);
   const prefetchId=prefetch.id;
   let prefetchReads=0;const count=r=>{if(new URL(r.url()).pathname.endsWith('/'+prefetchId+'/messages'))prefetchReads++};page.on('request',count);
   await page.evaluate(()=>{navigator.connection.saveData=false;return WizLive.refresh()});
   await page.waitForFunction(id=>!!WizLive.cachedMessages(id),prefetchId,{timeout:15000});
   assert.equal(prefetchReads,1,'exactly one actual background prefetch');page.off('request',count);
   results.browser.push({shell,skin,case:'ready-prefetch-uses-existing-current-cache',...prefetch,history_reads:prefetchReads,pass:true});
   assert.deepEqual(errors,[],'no shell exceptions through the entire cell');
   results.browser.push({shell,skin,case:'no-js-errors',count:errors.length,pass:true});
  }catch(e){results.failures.push(`${shell}/${skin}: ${e.stack}`);const detail=await diagnostics(page).catch(e=>({error:String(e)}));detail.sample=activeSample;detail.cache=activeSample?.id?await cacheEvidence(page,activeSample.id).catch(e=>({error:String(e)})):null;detail.gates=[...historyGates.values()].map(({id,releasedAt,requests})=>({id,releasedAt,requests}));writeFileSync(join(out,`${shell}-${skin}-diagnostic.json`),JSON.stringify(detail,null,2));await page.screenshot({path:join(out,`${shell}-${skin}-failure.png`)}).catch(()=>{});save();}
  finally{for(const gate of historyGates.values())gate.release();releasePendingSend?.();await ctx.close()}
 }
 } finally {await browser.close()}
} catch(e){results.failures.push(e.stack)}
finally{
 pumping=false;if(pump)await pump.catch(()=>{});child.kill('SIGTERM');
 await Promise.race([new Promise(r=>child.once('exit',r)),sleep(10000)]);if(child.exitCode===null){child.kill('SIGKILL');results.failures.push('fixture did not drain')}
 closeSync(log);
 if(existsSync(join(fixtureRoot,'custody.json'))){results.custody=JSON.parse(readFileSync(join(fixtureRoot,'custody.json')));if(results.custody.upstreamWrites)results.failures.push('upstream write attempted')}
 else results.failures.push('missing fixture custody receipt');
 results.complete=exactMatrix(results);
 results.expected={api_groups:3,api_samples_each:50,tap_groups:12,tap_samples_each:30,browser_cases:16,batch_turns_per_cell:30,maximum_batch_revision_wait_ms:45000};
 results.budgets_pass=results.complete&&!results.failures.length&&[...results.api,...results.browser].every(r=>r.pass);
 save();console.log(JSON.stringify({label,complete:results.complete,budgets_pass:results.budgets_pass,failures:results.failures}));
}
// Baseline violations are measurements, not a gate. Candidate violations fail.
if(label==='candidate'&&!results.budgets_pass)process.exitCode=1;
