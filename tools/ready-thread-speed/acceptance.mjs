import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
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
  const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1280,height:900},hasTouch:true,isMobile:shell==='phone',deviceScaleFactor:1});
  const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.fulfill({status:403,body:'Synthetic fixture blocks external requests'}));
  await ctx.addInitScript(()=>{
   localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wos.voiceTipSeen','true');
   // Controlled cache-state timings disable speculative preload only. Reads and
   // production cache validation/rendering remain untouched.
   Object.defineProperty(navigator,'connection',{value:{saveData:true},configurable:true});
   const base=window.fetch;window.__speedRequests=[];
   window.fetch=async(...args)=>{const url=String(args[0]),at=performance.now();const r=await base(...args);if(url.includes('/messages?')||url.includes('view=detail'))window.__speedRequests.push({url,request:at,response:performance.now()});return r};
   window.__speedResult=null;
   document.addEventListener('pointerdown',e=>{if(!e.target.closest('[data-chopen]')||!window.__speedExpected)return;const at=performance.now(),expected=window.__speedExpected;window.__speedResult=null;
    const find=()=>[...document.querySelectorAll('.ch-msgs .msg.a')].find(el=>el.textContent.includes(expected));
    const check=()=>{const el=find();if(!el)return;requestAnimationFrame(()=>requestAnimationFrame(()=>{const r=el.getBoundingClientRect();if(el.isConnected&&r.width&&r.height&&r.bottom>0&&r.top<innerHeight&&el.textContent.includes(expected)){window.__speedResult={tap:at,paint:performance.now(),ms:performance.now()-at,expected};observer.disconnect()}}))};
    const observer=new MutationObserver(check);observer.observe(document.body,{subtree:true,childList:true,attributes:true});check();
    setTimeout(()=>observer.disconnect(),15000);
   },true);
  });
  try {
   await page.goto(origin+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':''),{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>WizLive?.ok && (window.__wos||window.__wux));
   await page.evaluate(()=>{(window.__wux||window.__wos).openSettings('look')});
   await page.locator('[data-skinfamily="wizard"]').first().click();await page.locator(`[data-skinpick="${skin}"]`).first().click();
   await page.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
   await page.evaluate(()=>{if(window.__wux)__wux.closeSettings();else __wos.closeSheets(true)});
   await page.evaluate(()=>{if(window.__wux)__wux.openChatsList();else {__wos.goDesk(1);if(!Object.values(__wos.wins).some(w=>w.app==='chats'))__wos.openWin({app:'chats'})}});
   const wid=await page.evaluate(()=>Object.values((window.__wux||window.__wos).wins).find(w=>w.app==='chats')?.id);assert.ok(wid);
   for(const state of ['current','empty','stale']){
    const samples=[];
    for(let n=1;n<=30;n++){
     const id=`wizard_speed_${n}`;
     const history=JSON.parse(await get(`/wizard/hermes/api/sessions/${id}/messages?order=oldest&limit=500&include_compacted=true&view=wizard`));
     const marker=(history.data||history.messages).at(-1).content.split('\n')[0];
     await page.evaluate(({wid,id,state})=>{const H=window.__wux||window.__wos;H.chats.openChat(wid,null);if(state==='empty')WizLive.forgetMessages(id)}, {wid,id,state});
     if(state!=='empty')await page.evaluate(async id=>{await WizLive.sessionInfo(id);await WizLive.messages(id)},id);
     let expected=marker;
     if(state==='stale'){
      const stamp=Date.now()/1000;
      // Mutate only this process's disposable canonical fixture via IPC.
      expected=`SYNTHETIC_CURRENT_ANSWER_${n}_v${Math.trunc(stamp*1e6)}`;
      await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('fixture revision ack timeout')),10000);const fn=m=>{if(m.id===id){clearTimeout(t);child.off('message',fn);res()}};child.on('message',fn);child.send({op:'answer',id,text:expected,stamp})});
      await page.evaluate(id=>WizLive.sessionInfo(id),id);
      assert.equal(await page.evaluate(id=>!!WizLive.cachedMessages(id),id),false,'old answer must not be accepted as current');
     }
     // Empty is asserted immediately before tapping; accidental prefetch cannot
     // make a cold sample pass as warm.
     if(state==='empty')assert.equal(await page.evaluate(id=>!!WizLive.cachedMessages(id),id),false);
     if(state==='current')assert.equal(await page.evaluate(id=>!!WizLive.cachedMessages(id),id),true);
     await page.evaluate(expected=>{window.__speedExpected=expected;window.__speedResult=null;window.__speedRequests=[]},expected);
     const row=page.locator(`[data-chopen="${id}"]:visible`).first();await row.scrollIntoViewIfNeeded();await row.tap();
     await page.waitForFunction(()=>!!window.__speedResult,null,{timeout:15000});
     const trace=await page.evaluate(()=>({...window.__speedResult,requests:window.__speedRequests}));samples.push(trace.ms);
     appendFileSync(join(out,'tap-traces.jsonl'),JSON.stringify({shell,skin,state,n,id,...trace})+'\n');
     if(n===1){await page.screenshot({path:join(out,`${shell}-${skin}-${state}.png`)});}
    }
    const record={shell,skin,state,...stats(samples),budget_ms:state==='current'?150:1000};record.pass=record.p95<record.budget_ms;results.browser.push(record);save();
   }
   // Long history traverses several real pages without dropping the newest answer.
   await page.evaluate(wid=>{(window.__wux||window.__wos).chats.openChat(wid,'wizard_speed_0')},wid);
   await page.getByText('SYNTHETIC_CURRENT_ANSWER_0_v1',{exact:false}).last().waitFor({state:'visible'});
   assert.deepEqual(errors,[]);results.browser.push({shell,skin,case:'long-history-and-no-js-errors',pass:true});
   // A pending synthetic voice send must not hide a stalled saved transcript.
   // Seed sending custody only; no send/pump/admission is invoked by this test.
   const hangId='wizard_speed_400',pattern='**/sessions/wizard_speed_400/messages?**';
   let release;const held=new Promise(r=>{release=r});
   await page.route(pattern,async route=>{await held;await route.abort().catch(()=>{})});
   await page.evaluate(({wid,id})=>{const H=window.__wux||window.__wos;WizLive.forgetMessages(id);H.outbox._items.set('speed-voice',{id:'speed-voice',kind:'reply',source:'voice',sessionId:id,text:'SYNTHETIC_PENDING_VOICE',state:'sending',createdAt:Date.now(),attempts:1,agent:''});H.chats.openChat(wid,id)}, {wid,id:hangId});
   await page.locator('.ch-skel.thread:visible').waitFor();
   await page.getByText('SYNTHETIC_PENDING_VOICE',{exact:false}).last().waitFor({state:'visible'});
   await page.locator('[data-chretry]:visible').waitFor({timeout:14000});
   assert.ok(await page.getByText('SYNTHETIC_PENDING_VOICE',{exact:false}).last().isVisible());
   release();await page.unroute(pattern);
   await page.locator('[data-chretry]:visible').click();
   await page.getByText('SYNTHETIC_CURRENT_ANSWER_400_v1',{exact:false}).last().waitFor({state:'visible'});
   await page.evaluate(()=>{(window.__wux||window.__wos).outbox._items.delete('speed-voice')});
   results.browser.push({shell,skin,case:'pending-voice-hang-deadline-retry',pass:true});
   await page.evaluate(async()=>{Object.defineProperty(navigator,'connection',{value:{saveData:false},configurable:true});await WizLive.forgetMessages('wizard_speed_30');await WizLive.refresh()});
   await page.waitForFunction(()=>!!WizLive.cachedMessages('wizard_speed_30'),null,{timeout:15000});
   results.browser.push({shell,skin,case:'ready-prefetch-uses-existing-current-cache',pass:true});
  }catch(e){results.failures.push(`${shell}/${skin}: ${e.stack}`);await page.screenshot({path:join(out,`${shell}-${skin}-failure.png`)}).catch(()=>{});save();}
  finally{await ctx.close()}
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
 results.budgets_pass=results.complete&&!results.failures.length&&[...results.api,...results.browser].every(r=>r.pass);
 save();console.log(JSON.stringify({label,complete:results.complete,budgets_pass:results.budgets_pass,failures:results.failures}));
}
// Baseline violations are measurements, not a gate. Candidate violations fail.
if(label==='candidate'&&!results.budgets_pass)process.exitCode=1;
