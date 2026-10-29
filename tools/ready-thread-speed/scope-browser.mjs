// Focused real-Service/real-UX scope proof. Synthetic gateways only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
const [service,ux,out]=process.argv.slice(2).map(p=>resolve(p)),require=createRequire(import.meta.url);
const {scene,kinds}=await import(pathToFileURL(join(service,'qa/agent-parity/fixture.mjs')));
const {chromium}=require(process.env.QA_PLAYWRIGHT),browser=await chromium.launch({executablePath:process.env.QA_CHROME});
mkdirSync(out,{recursive:true});const cells=[];
try {
 for(const shell of ['phone','desktop'])for(const skin of ['nebula','signal'])for(const kind of [...kinds,'synthetic-private']){
  const s=await scene(kind==='synthetic-private'?'host-profile':kind,{uxDir:join(ux,'web'),followThrough:false});
  const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1280,height:900},isMobile:shell==='phone',hasTouch:true,extraHTTPHeaders:s.ownerHeaders});
  const cell={shell,skin,kind,pass:false};
  try {
   if(kind==='synthetic-private')s.setSupervisorSeal('private',[]);
   const id='wizard_speed_scope',at=Date.now()/1000;
   s.sessions.set(id,{id,title:'Synthetic scope answer',source:'wizard-mobile',created_at:at-10,messages:[{role:'user',content:'Synthetic scope request',timestamp:at-5},{role:'assistant',content:'SYNTHETIC_SCOPED_CURRENT_ANSWER',timestamp:at,finish_reason:'stop'}]});
   await s.request('/api/sessions?view=list');
   let detailReleasedAt=0;const requests=[];
   await ctx.route('**/*',async r=>{
    const u=new URL(r.request().url());if(u.origin!==s.origin())return r.fulfill({status:403,body:'External reads refused'});
    if(u.pathname.endsWith('/messages'))requests.push({url:u.href,at:Date.now()});
    if(u.pathname.endsWith('/'+id)&&u.searchParams.get('view')==='detail'){await new Promise(res=>setTimeout(res,1000));detailReleasedAt=Date.now();}
    return r.continue();
   });
   await ctx.addInitScript(skin=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wos.skin',skin);Object.defineProperty(navigator,'connection',{value:{saveData:true},configurable:true})},skin);
   const page=await ctx.newPage();await page.goto(s.origin()+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':''));
   await page.waitForFunction(()=>window.WizLive?.ok&&(window.__wux||window.__wos));
   await page.evaluate(async id=>{await WosAgents.load(true);WizOpenAgentChats(id)},s.id);
   const row=page.locator(`[data-chopen="${id}"]:visible`).first();await row.waitFor();const tapAt=Date.now();await row.tap();
   await page.locator('.ch-msgs').filter({hasText:'SYNTHETIC_SCOPED_CURRENT_ANSWER'}).last().waitFor({state:'visible'});
   const paintAt=Date.now(),read=requests.find(r=>r.at>=tapAt);assert.ok(read,'actual history request recorded');
   if(kind!=='main')assert.equal(new URL(read.url).searchParams.get('agent'),s.id);
   assert.ok(!detailReleasedAt||read.at<detailReleasedAt,'history must not wait for optional detail when scope is known');
   if(kind==='synthetic-private'||kind!=='main')assert.equal(await page.evaluate(id=>WizLive.cachedMessages(id),id),null,'routed/private history not persisted in main cache');
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.skin),skin);
   await page.screenshot({path:join(out,`${shell}-${skin}-${kind}.png`)});
   Object.assign(cell,{pass:true,elapsed_ms:paintAt-tapAt,history_before_detail:true,private_data_read:false});
  }catch(e){cell.error=e.stack}
  finally{await ctx.close();await s.close();cells.push(cell);appendFileSync(join(out,'cells.jsonl'),JSON.stringify(cell)+'\n')}
 }
}finally{await browser.close()}
const expected=2*2*(kinds.length+1);writeFileSync(join(out,'results.json'),JSON.stringify({expected,count:cells.length,pass:cells.length===expected&&cells.every(c=>c.pass),cells},null,2));
if(cells.length!==expected||cells.some(c=>!c.pass))process.exitCode=1;
