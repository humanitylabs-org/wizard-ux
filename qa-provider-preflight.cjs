// Synthetic provider-preflight receipt; all writes intercepted. Tests both real shell renderers.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const WEB = process.env.QA_WEB_DIR || __dirname;
const BASE = process.env.QA_BASE || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-preflight');
let pass=0,fail=0; const check=(v,n)=>{ console.log(v?'PASS':'FAIL',n);v?pass++:fail++; };
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try {
 for (const shell of ['phone','desktop']) {
  const ctx=await browser.newContext({viewport:shell==='phone'?{width:412,height:892}:{width:1400,height:900},hasTouch:shell==='phone',isMobile:shell==='phone',serviceWorkers:'block'});
  const sid='wizard_qa_provider_preflight', ts=Date.now()/1000-190;
  let sentWrites=0;const errs=[];
  const session={id:sid,source:'wizard-mobile',title:'Wizard OS · Opus delivery',status:'failed',archived:false,hidden:false,message_count:0,started_at:ts,last_active:ts,model:'claude-opus-5-5',provider:'anthropic',wizard_last_run_status:'failed',wizard_run_id:'wizardq_qa_preflight',wizard_last_run_key:'qa_preflight',wizard_last_user_at:ts,wizard_activity_at:ts,wizard_last_request_at:ts,preview:'Saved request',preview_role:'user',wizard_last_run_preview:'Saved request'};
  await ctx.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),json=(body)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   if(!['GET','HEAD'].includes(q.method())){if(u.pathname.endsWith('/v1/runs'))sentWrites++;return json({});}
   if(u.pathname==='/wizard/hermes/api/sessions')return json({data:[session],total:1,has_more:false});
   if(u.pathname===`/wizard/hermes/api/sessions/${sid}/messages`)return json({data:[],messages:[],total:0});
   if(u.pathname===`/wizard/hermes/api/sessions/${sid}`)return json({session});
   if(!process.env.QA_LIVE && u.pathname.startsWith('/wizard-os-home/')){
    const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html';const file=path.join(WEB,'web',rel);
    if(fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({status:200,contentType:rel.endsWith('.html')?'text/html':rel.endsWith('.css')?'text/css':rel.endsWith('.js')?'application/javascript':'application/octet-stream',body:fs.readFileSync(file)});
   }
   return r.continue();
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errs.push(String(e)));
  await page.addInitScript(()=>localStorage.setItem('wos.coached','true'));
  await page.goto(BASE+'?shell='+shell,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>(window.__wos||window.__wux)&&window.WizLive?.ok&&window.WosOutbox,null,{timeout:45000});
  await page.evaluate(async({sid,ts})=>{
   await WosOutbox.load();WosOutbox._items.set('qa_preflight',{id:'qa_preflight',kind:'reply',sessionId:sid,createdAt:ts*1000,sentAt:ts*1000,state:'sent',runId:'wizardq_qa_preflight',text:'Saved request',files:[],model:'claude-opus-5-5',provider:'anthropic'});
   await WizLive.refresh();if(window.__wos)__wos.openWizardThread(sid);else __wux.openThread(sid);
  },{sid,ts});
  await page.waitForSelector('[data-ob="qa_preflight"]');await page.waitForTimeout(500);
  const state=await page.evaluate(()=>({shell:document.documentElement.dataset.shell,text:document.querySelector('.ch-msgs')?.innerText,spinners:[...document.querySelectorAll('.ch-msgs details.steps.live')].map(x=>x.innerText),pending:WosOutbox.get('qa_preflight')?.state}));
  check(state.shell===shell,shell+' correct shell');
  check(state.pending==='sent'&&state.text.includes('Saved request'),shell+' saved accepted message preserved');
  check(!state.spinners.some(t=>/Sending/.test(t)),shell+' accepted failed receipt has no endless Sending spinner');
  await page.screenshot({path:path.join(OUT,shell+'.png')});
  check(sentWrites===0,shell+' zero agent sends');check(errs.length===0,shell+' zero page errors '+JSON.stringify(errs));
  await ctx.close();
 }
 }finally{await browser.close();}
 const result={pass,fail,host:require('os').hostname(),web:WEB,live:!!process.env.QA_LIVE};fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exit(1)});
