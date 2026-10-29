// Focused real-Service/real-UX scope proof. Synthetic gateways only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { initialize,openList,rowFor,actionable,input,armPaint,diagnostics,verifyServingBytes } from './browser-preparation.mjs';
const [service,ux,out]=process.argv.slice(2).map(p=>resolve(p)),require=createRequire(import.meta.url);
const {scene,kinds}=await import(pathToFileURL(join(service,'qa/agent-parity/fixture.mjs')));
const {chromium}=require(process.env.QA_PLAYWRIGHT),browser=await chromium.launch({executablePath:process.env.QA_CHROME});
mkdirSync(out,{recursive:true});const cells=[];
try {
 for(const shell of ['phone','desktop'])for(const skin of ['nebula','signal'])for(const kind of [...kinds,'synthetic-private','main-legacy-full']){
  const main=kind==='main'||kind==='main-legacy-full',legacy=kind==='main-legacy-full';
  const id='wizard_speed_scope',at=Date.now()/1000,expected='SYNTHETIC_SCOPED_CURRENT_ANSWER';
  const fixtureRow={id,title:'Synthetic scope answer',source:'wizard-mobile',created_at:at-10,messages:[{role:'user',content:'Synthetic scope request',timestamp:at-5},{role:'assistant',content:expected,timestamp:at,finish_reason:'stop'}]};
  // scene() normally disables canonical main listing. That intentionally exposes
  // the legacy upstream fallback, not the compact archive-window path used live.
  // Supply authoritative synthetic canonical input, never a pre-normalized row:
  // the real Service still owns truth projection, listVersion and window metadata.
  const s=await scene(main?'main':kind==='synthetic-private'?'host-profile':kind,{uxDir:join(ux,'web'),followThrough:false,
   ...(kind==='main'?{canonicalSessionReader:async()=>[{...fixtureRow,message_count:fixtureRow.messages.length,latest_message:fixtureRow.messages.at(-1),last_active:fixtureRow.messages.at(-1).timestamp}]}:{})});
  const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1280,height:900},isMobile:shell==='phone',hasTouch:shell==='phone',serviceWorkers:'block',extraHTTPHeaders:s.ownerHeaders});
  const cell={shell,skin,kind,pass:false};let page;
  try {
   writeFileSync(join(s.root,'os/settings.json'),JSON.stringify({schema:1,setup:{seen_at:new Date().toISOString()}}));
   if(kind==='synthetic-private')s.setSupervisorSeal('private',false);
   cell.served_assets=await verifyServingBytes(s.origin(),ux,s.ownerHeaders);
   const setup=await (await fetch(s.origin()+'/wizard/v1/setup',{headers:s.ownerHeaders})).json();
   assert.equal(setup.first_run,false,'fixture is explicitly past onboarding');
   const registry=await (await fetch(s.origin()+'/wizard/v1/agents',{headers:s.ownerHeaders})).json();
   const agent=registry.agents.find(a=>a.id===s.id);assert.ok(agent,'valid fixture agent must be in the real registry');
   if(kind==='synthetic-private')assert.equal(agent.privacy,'private');
   s.sessions.set(id,fixtureRow);
   const response=await s.request('/api/sessions?view=list&window=archive-50&limit=100');assert.equal(response.status,200);
   const list=await response.json();
   const projected=list.data.find(r=>r.id===id);assert.ok(projected,'real Service list contains the synthetic thread');
   assert.equal(list.list_version,1,'Service advertises its list projection');
   if(!legacy){assert.equal(list.window,'archive-50','canonical compact list window');assert.equal(projected.listVersion,1);}
   else assert.equal(list.window,undefined,'legacy fallback has no canonical window');
   cell.list_provenance={canonical_reader:kind==='main',list_version:list.list_version,window:list.window??null,row_list_version:projected.listVersion??null};
   let detailStartedAt=0,detailReleasedAt=0,done;
   const detailDone=new Promise(r=>{done=r}),requests=[];
   await ctx.route('**/*',async r=>{
    const u=new URL(r.request().url());if(u.origin!==s.origin())return r.fulfill({status:403,body:'External reads refused'});
    if(u.pathname.endsWith('/'+id+'/messages'))requests.push({url:u.href,at:Date.now()});
    if(u.pathname.endsWith('/'+id)&&u.searchParams.get('view')==='detail'){
     detailStartedAt=Date.now();await new Promise(res=>setTimeout(res,1000));detailReleasedAt=Date.now();
     try{return await r.continue()}finally{done()}
    }
    return r.continue();
   });
   await initialize(ctx,skin);page=await ctx.newPage();page.setDefaultTimeout(15000);
   const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   const wid=await openList(page,s.origin(),shell,s.id),row=rowFor(page,wid,id),geometry=await actionable(row);
   const normalized=await page.evaluate(id=>{const s=WizLive.session(id);return {listVersion:s?.listVersion??null,detailNeeded:!!s?.detailNeeded}},id);
   assert.equal(normalized.detailNeeded,!legacy,'fixture must exercise its declared hydration branch');
   assert.equal(normalized.listVersion,legacy?null:1,'normalized list matches Service projection/fallback');
   cell.normalized_provenance=normalized;
   await armPaint(page,wid,expected);const tapAt=Date.now();await input(row,shell);
   await page.waitForFunction(()=>window.__speed?.first!==null);
   const paint=await page.evaluate(()=>({at:performance.timeOrigin+window.__speed.start+window.__speed.first,ms:window.__speed.first,tap:window.__speed.start}));
   const read=requests.find(r=>r.at>=tapAt);assert.ok(read,'actual history request recorded');
   if(!main)assert.equal(new URL(read.url).searchParams.get('agent'),s.id);
   if(!legacy){
    // All original 20 cells still require positive delayed-detail execution.
    let timer;try{await Promise.race([detailDone,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('optional detail was never requested')),5000)})])}finally{clearTimeout(timer)}
    assert.ok(detailStartedAt>0&&detailReleasedAt>0,'actual optional detail delay observed');
    assert.ok(read.at<detailReleasedAt,'known-scope history does not wait for optional detail');
    assert.ok(paint.at<detailReleasedAt,'actual answer paints before optional detail is released');
   }else{
    // Additional negative branch: allow the same detail window to elapse after
    // history completes. Full legacy rows require no metadata request at all.
    await page.waitForTimeout(1100);assert.equal(detailStartedAt,0,'hydrated legacy row does not request optional detail');
   }
   if(!main)assert.equal(await page.evaluate(id=>WizLive.cachedMessages(id),id),null,'routed/private history not persisted in main cache');
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.skin),skin);
   assert.deepEqual(errors,[],'no shell exceptions');
   await page.screenshot({path:join(out,`${shell}-${skin}-${kind}.png`)});
   Object.assign(cell,{pass:true,elapsed_ms:paint.ms,history_before_detail:legacy?null:true,answer_before_detail:legacy?null:true,no_optional_detail:legacy,geometry,requests,detailStartedAt,detailReleasedAt,paintAt:paint.at,private_data_read:false});
  }catch(e){cell.error=e.stack;if(page){cell.diagnostic=await diagnostics(page).catch(e=>({error:String(e)}));await page.screenshot({path:join(out,`${shell}-${skin}-${kind}-failure.png`)}).catch(()=>{})}}
  finally{await ctx.close();await s.close();cells.push(cell);appendFileSync(join(out,'cells.jsonl'),JSON.stringify(cell)+'\n')}
 }
}finally{await browser.close()}
const expected=2*2*(kinds.length+2),positive=cells.filter(c=>c.kind!=='main-legacy-full'),legacy=cells.filter(c=>c.kind==='main-legacy-full');
writeFileSync(join(out,'results.json'),JSON.stringify({expected,count:cells.length,positive_count:positive.length,legacy_count:legacy.length,pass:cells.length===expected&&positive.length===20&&legacy.length===4&&cells.every(c=>c.pass),cells},null,2));
if(cells.length!==expected||cells.some(c=>!c.pass))process.exitCode=1;
