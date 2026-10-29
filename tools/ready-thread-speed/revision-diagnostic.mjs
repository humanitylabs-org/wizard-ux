// REUSE the existing fixture, real shell preparation, cache assessor and paint probe.
// Diagnostic only: one canonical turn + one stale open per shell, not acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,existsSync,openSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initialize,openList,rowFor,actionable,input,expandList,armPaint,verifyServingBytes} from './browser-preparation.mjs';
import {historyRevision,assessCache,cacheEvidence,waitForRevision} from './cache-evidence.mjs';
const [service,ux,out,label]=process.argv.slice(2).map((v,i)=>i<3?resolve(v):v);
mkdirSync(out,{recursive:true});const root=join(out,'fixture');mkdirSync(root);
const fd=openSync(join(out,'fixture.log'),'w');
const child=spawn(process.execPath,[new URL('./fixture.mjs',import.meta.url).pathname,service,ux,root],{stdio:['ignore',fd,fd,'ipc']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={label,diagnostic_only:true,full_acceptance:false,pass:false,cells:[],failures:[]};
const save=()=>writeFileSync(join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
const ipc=m=>new Promise((res,rej)=>{
 const timer=setTimeout(()=>{child.off('message',fn);rej(Error('fixture IPC timeout'))},10000);
 const fn=r=>{if(r.id===m.id&&(m.op==='inspect'?r.op==='inspect':!r.op)){clearTimeout(timer);child.off('message',fn);res(r)}};
 child.on('message',fn);child.send(m);
});
const fields=r=>r?Object.fromEntries(['id','listVersion','messageCount','message_count','lastAssistantAt','lastUserAt','wizard_last_assistant_at','wizard_last_user_at'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])):null;
const reduced=s=>({key:s.key,trusted:s.trusted,list:fields(s.list),accepted:s.accepted?{count:s.accepted.length,revision:historyRevision(s.accepted)}:null,persisted:s.persisted?{rev:s.persisted.rev,count:s.persisted.rows?.length}:null,storageError:s.storageError});
let browser,pumping=false,pump,origin;
try{
 const {listRow}=await import(pathToFileURL(join(service,'server/session-list-view.mjs')));
 report.timestamp_controls=[];
 for(const [user,assistant,expectedUser,expectedAssistant] of [
  [1793274543.083,1793274543.0839999,'2026-10-29T11:49:03.083Z','2026-10-29T11:49:03.083Z'],
  [1793274932.655,1793274932.656,'2026-10-29T11:55:32.655Z','2026-10-29T11:55:32.656Z'],
  [1793274922.833,1793274922.8339999,'2026-10-29T11:55:22.833Z','2026-10-29T11:55:22.833Z'],
 ]){
  const rows=[{role:'user',timestamp:user,content:'Synthetic request'},{role:'assistant',timestamp:assistant,content:'SYNTHETIC_CURRENT_ANSWER_1_v1'}];
  const history=historyRevision(rows),raw=listRow({id:'wizard_speed_1',message_count:2,wizard_last_user_at:user,wizard_last_assistant_at:assistant});
  assert.equal(history.lastUserAt,expectedUser);assert.equal(history.lastAssistantAt,expectedAssistant);
  assert.equal([raw.messageCount,raw.lastAssistantAt,raw.lastUserAt].join('|'),history.key,'actual Service normalizer and history oracle use identical TimeClip, not decimal rounding');
  report.timestamp_controls.push({user,assistant,scaledMs:assistant*1000,historyKey:history.key,serverKey:[raw.messageCount,raw.lastAssistantAt,raw.lastUserAt].join('|'),pass:true});
 }
 for(let i=0;i<150&&!existsSync(join(root,'ready.json'));i++){assert.equal(child.exitCode,null,'fixture stays alive');await sleep(100)}
 origin=JSON.parse(readFileSync(join(root,'ready.json'))).origin;
 report.served_assets=await verifyServingBytes(origin,ux);
 // Preserve the original overlapping canonical/list-check workload, not its API benchmark.
 pumping=true;pump=(async()=>{while(pumping){const r=await fetch(origin+'/wizard/hermes/api/sessions?limit=100&view=list');assert.equal(r.status,200);await r.arrayBuffer();await sleep(30)}})();
 pump.catch(e=>report.failures.push('overlap: '+e));
 const {chromium}=createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT);
 browser=await chromium.launch({executablePath:process.env.QA_CHROME});
 for(const shell of ['phone','desktop']){
  const id=shell==='phone'?'wizard_speed_1':'wizard_speed_2',n=shell==='phone'?1:2,skin='nebula';
  const cell={shell,skin,id,scope:'main',mutations:0,taps:0,pass:false};report.cells.push(cell);
  const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1280,height:900},isMobile:shell==='phone',hasTouch:shell==='phone',serviceWorkers:'block'});
  const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  let gate,release=()=>{};
  const observe=async(phase,s,expected)=>{
   const db=await ipc({op:'inspect',id});
   assert.equal(db.session.message_count,db.actualCount,'fixture session count equals actual DB rows in the committed transaction');
   if(expected)assert.equal(db.revision.key,expected.key,'DB revision is immutable throughout this one-turn check');
   const raw=await page.evaluate(()=>window.__revisionRaw||null);
   appendFileSync(join(out,'revision-observations.jsonl'),JSON.stringify({shell,skin,id,phase,at:Date.now(),elapsed_ms:cell.committed_at?Date.now()-cell.committed_at:null,expected,db,raw,client:reduced(s)})+'\n');
   return {db,raw};
  };
  try{
   await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.fulfill({status:403,body:'Synthetic fixture blocks external requests'}));
   await initialize(ctx,skin);
   await ctx.addInitScript(id=>{
    const base=window.fetch;
    window.fetch=async(...args)=>{
     const url=new URL(String(args[0]),location.origin),start=performance.now(),r=await base(...args);
     if(url.pathname==='/wizard/hermes/api/sessions'&&url.searchParams.get('view')==='list'&&!url.searchParams.has('fields')){
      const p=await r.clone().json(),row=(p.data||p.sessions||[]).find(s=>s.id===id);
      if(row)window.__revisionRaw={url:url.pathname+url.search,status:r.status,request:start,response:performance.now(),list_version:p.list_version,snapshot:p.snapshot,row:Object.fromEntries(['id','listVersion','messageCount','message_count','lastAssistantAt','lastUserAt','wizard_last_assistant_at','wizard_last_user_at'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]))};
     }
     return r;
    };
    document.addEventListener('pointerdown',e=>{const row=e.target.closest('[data-chopen]'),s=window.__speed;if(row?.dataset.chopen===id&&row.closest('[data-win]')?.dataset.win===s?.wid)window.__revisionRelease(id)},true);
   },id);
   await page.exposeBinding('__revisionRelease',(_,row)=>{if(row===id&&gate){gate.releasedAt=Date.now();release()}});
   const wid=await openList(page,origin,shell);await expandList(page,wid,shell);
   const response=await fetch(origin+`/wizard/hermes/api/sessions/${id}/messages?order=oldest&limit=500&include_compacted=true&view=wizard`);assert.equal(response.status,200);
   const old=historyRevision((await response.json()).data);
   await waitForRevision(page,id,old,s=>observe('seed-list',s),45000);
   await page.evaluate(id=>WizLive.sessionInfo(id),id);await page.evaluate(id=>WizLive.messages(id),id);
   const seeded=await cacheEvidence(page,id);assert.equal(assessCache(seeded,old),'current-copy-refilled');await observe('seeded-exact-content',seeded);
   const before=await ipc({op:'inspect',id});cell.reader_before=before.canonicalReader;
   const held=new Promise(r=>{release=r});gate={releasedAt:null,requests:[]};
   await page.route(`**/sessions/${id}/messages?**`,async route=>{gate.requests.push({url:route.request().url(),at:Date.now()});await held;await route.continue().catch(()=>{})});
   // Keep the original fractional-second write. Inspect its actual JS TimeClip result;
   // do not round the oracle or waive either timestamp field.
   const stamp=Date.now()/1000,text=`SYNTHETIC_CURRENT_ANSWER_${n}_v${Math.trunc(stamp*1e6)}`;
   const ack=await ipc({op:'answer',id,stamp,text});cell.mutations++;cell.committed_at=Date.now();
   const h=await fetch(origin+`/wizard/hermes/api/sessions/${id}/messages?order=oldest&limit=500&include_compacted=true&view=wizard`);assert.equal(h.status,200);
   const expected=historyRevision((await h.json()).data);assert.equal(expected.key,ack.revision.key);assert.equal(expected.marker,ack.revision.marker);
   assert.equal(expected.messageCount,old.messageCount+2);cell.expected=expected;
   let crossed15=false,intermediate=false;
   const invalid=await waitForRevision(page,id,expected,async s=>{
    const state=await observe('await-exact-list',s,expected);
    crossed15||=Date.now()-cell.committed_at>=15000;
    intermediate||=s.list?.messageCount===old.messageCount&&s.list?.lastAssistantAt===expected.lastAssistantAt&&s.list?.lastUserAt===expected.lastUserAt;
    if(s.key===expected.key){
     assert.equal(state.db.canonicalReader.row.message_count,expected.messageCount,'canonical reader refreshed before exact client count');
     assert.equal(state.raw.row.messageCount,expected.messageCount,'actual HTTP compact list supplied exact count');
     assert.equal(state.raw.row.lastAssistantAt,expected.lastAssistantAt);assert.equal(state.raw.row.lastUserAt,expected.lastUserAt);
    }
   },45000);
   cell.exact_after_ms=Date.now()-cell.committed_at;cell.crossed_original_15s=crossed15;cell.saw_mixed_source_revision=intermediate;
   assert.equal(assessCache(invalid,expected),'rejected-old-copy');assert.equal(gate.releasedAt,null);
   await expandList(page,wid,shell);const row=rowFor(page,wid,id),geometry=await actionable(row);await armPaint(page,wid,expected.marker,old.marker);
   const atTap=await cacheEvidence(page,id);await observe('before-real-tap',atTap,expected);assert.equal(assessCache(atTap,expected),'rejected-old-copy');assert.equal(gate.releasedAt,null);
   await input(row,shell);cell.taps++;
   await page.waitForFunction(()=>window.__speed?.first!==null,null,{timeout:15000});
   const trace=await page.evaluate(()=>({tap:window.__speed.start,ms:window.__speed.first,stale:window.__speed.stale}));
   assert.ok(trace.tap>0);assert.equal(trace.stale,false);assert.ok(gate.releasedAt&&gate.requests.length);
   const after=await cacheEvidence(page,id);await observe('after-current-paint',after,expected);assert.equal(assessCache(after,expected),'current-copy-refilled');
   assert.deepEqual(errors,[]);cell.trace={...trace,geometry,gate};cell.pass=true;
   await page.screenshot({path:join(out,shell+'-current.png')});
  }catch(e){cell.error=String(e.stack);report.failures.push(shell+': '+e);await page.screenshot({path:join(out,shell+'-failure.png')}).catch(()=>{})}
  finally{release();await ctx.close();save()}
 }
}catch(e){report.failures.push(String(e.stack))}
finally{
 pumping=false;if(pump)await pump.catch(()=>{});if(browser)await browser.close();
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(10000)]);
 if(child.exitCode===null){child.kill('SIGKILL');report.failures.push('fixture did not drain')}
 closeSync(fd);
 if(existsSync(join(root,'custody.json')))report.custody=JSON.parse(readFileSync(join(root,'custody.json')));
 else report.failures.push('missing custody');
 report.pass=report.timestamp_controls?.length===3&&report.timestamp_controls.every(c=>c.pass)&&report.cells.length===2&&report.cells.every(c=>c.pass&&c.mutations===1&&c.taps===1)&&!report.failures.length&&report.custody?.upstreamWrites===0;
 save();console.log(JSON.stringify({label,diagnostic_pass:report.pass,full_acceptance:false,cells:report.cells.map(({shell,pass,exact_after_ms,saw_mixed_source_revision})=>({shell,pass,exact_after_ms,saw_mixed_source_revision})),failures:report.failures}));
 if(!report.pass)process.exitCode=1;
}
