'use strict';
// Live read-only Notes lifecycle, separate from Chats swipe coverage. Disposable
// workspace sync is off so another device's restored desks cannot obscure it.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path');
const BASE = process.env.QA_BASE, OUT = process.env.QA_OUT;
if (!BASE || !OUT) throw Error('Set QA_BASE and QA_OUT');
fs.mkdirSync(OUT,{recursive:true});
const report = {cases:[],limitations:['Live GET responses only; all writes refused','Workspace sync disabled in disposable QA storage','Browser viewport, not physical Android']};
(async()=>{
 const browser = await chromium.launch();
 try { for (const skin of ['nebula','landscapes']) {
  const row={skin,errors:[],failedRequests:[],blockedWrites:[],pass:false};report.cases.push(row);
  const ctx=await browser.newContext({viewport:{width:412,height:892},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await ctx.addInitScript(s=>{try{localStorage.setItem('wos.skin',s);localStorage.setItem('wos.wsync.off','true');localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1')}catch{}},skin);
  await ctx.route('**/*',r=>{
   const q=r.request();if(['GET','HEAD'].includes(q.method()))return r.continue();
   row.blockedWrites.push({method:q.method(),path:new URL(q.url()).pathname});return r.fulfill({status:403,contentType:'application/json',body:'{"error":"Read-only acceptance run"}'});
  });
  const p=await ctx.newPage();p.on('pageerror',e=>row.errors.push(e.stack));p.on('requestfailed',r=>row.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
  try {
   await p.goto(BASE+'/wizard-os-home/?open=notes&myskin=off');await p.waitForFunction(()=>!!window.__wos);await p.evaluate(()=>WizCore.appsLoaded());
   await p.waitForFunction(()=>{const w=__wos.wins[__wos.desks[__wos.idx].focus];return w?.appId==='notes'});
   let f;for(let i=0;i<60&&!f;i++){f=p.frames().find(f=>f.url().startsWith(BASE+'/notes/'));if(!f)await p.waitForTimeout(250)}
   if(!f)throw Error('Notes frame did not mount');
   await f.locator('#vault-count').filter({hasText:/\d/}).waitFor({timeout:30000});
   row.items=await f.locator('[role="treeitem"]').count();
   row.viewport=await f.evaluate(()=>({width:innerWidth,height:innerHeight,skin:document.documentElement.dataset.skin}));
   if(row.viewport.width!==412)throw Error('Notes is not phone width');
   await p.waitForTimeout(600);await p.screenshot({path:path.join(OUT,'notes-'+skin+'.png')});
   if(row.errors.length)throw Error(row.errors.join('\n'));
   row.pass=true;console.log('PASS',skin,'Notes loaded at phone width without page errors',JSON.stringify({items:row.items,viewport:row.viewport}));
  }catch(e){row.error=String(e);console.log('FAIL',skin,row.error)}
  finally {await ctx.close();fs.writeFileSync(path.join(OUT,'notes.json'),JSON.stringify(report,null,2));}
 }}finally{await browser.close()}
 report.counts={passed:report.cases.filter(c=>c.pass).length,failed:report.cases.filter(c=>!c.pass).length};
 fs.writeFileSync(path.join(OUT,'notes.json'),JSON.stringify(report,null,2));console.log(report.counts);process.exitCode=report.counts.failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=2});
