// Run on Thales. Optional QA_SOURCE tests exact candidate files over read-only live APIs.
const {chromium}=require(process.env.PW);
const fs=require('fs'),path=require('path'),os=require('os');
const BASE=process.argv[2],OUT=process.env.QA_OUT,SOURCE=process.env.QA_SOURCE;
if(!OUT?.startsWith('/Volumes/ThalesMedia/')||!os.hostname().toLowerCase().includes('thales'))throw Error('Thales evidence required');
fs.mkdirSync(OUT,{recursive:true});
const cases=[],errors=[],writes=[];
function check(v,name,detail){cases.push({pass:!!v,name,detail});console.log(v?'PASS':'FAIL',name,detail||'');}
const nap=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
for(const mobile of [true,false]){
 const kind=mobile?'phone':'desktop';
 const ctx=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile,userAgent:mobile?'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'});
 await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1');});
 await ctx.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url());
  if(!['GET','HEAD'].includes(q.method())){writes.push({method:q.method(),url:q.url()});return r.fulfill({status:403,body:'{}'});}
  if(SOURCE&&u.pathname.startsWith('/wizard-os-home/')){
   const rel=decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length))||'index.html';
   const f=path.resolve(SOURCE,'web',rel);
   if(f.startsWith(path.resolve(SOURCE,'web')+'/')&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({path:f});
  }
  return r.continue();
 });
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(kind+': '+e));
 await p.goto(BASE);
 await p.waitForFunction(m=>m?window.__wos?.live?.ok:window.__wux?.live?.ok,mobile,{timeout:45000});
 await p.evaluate(()=>WosAgents.load());await nap(500);
 check(await p.evaluate(m=>document.documentElement.dataset.shell===(m?'phone':'desktop'),mobile),kind+' UA selects actual shell');
 check(await p.evaluate(()=>WizSigil.of({id:'wizard'}).glyph==='hat'),kind+' Chats uses company hat');
 check(await p.evaluate(()=>WizSigil.of({id:'messenger'}).glyph==='chats'),kind+' Messenger retains speech bubbles');
 check(await p.evaluate(()=>WosAgents.glyph(WosAgents.get(WosAgents.defaultId()))==='hat'),kind+' main agent hat');
 check(await p.evaluate(()=>WosAgents.glyph(WosAgents.get('private'))==='hat-private'),kind+' private keyhole hat');
 check(await p.evaluate(()=>WosAgents.colour(WosAgents.get(WosAgents.defaultId()))==='hsl(265 72% 62%)'&&WosAgents.colour(WosAgents.get('private'))==='hsl(160 72% 62%)'),kind+' configured purple main and green private');
 check(await p.evaluate(()=>{const a={id:'future-one'},b={id:'future-two'};return WosAgents.glyph(a)==='hat'&&WosAgents.colour(a)!==WosAgents.colour(b)&&WosAgents.colour(a)===WosAgents.colour(a);}),kind+' future agents keep hat and stable distinct hue');
 await p.evaluate(()=>WizOpenAgentChats('private'));await nap(1200);
 check(await p.locator('[data-agent-titlebar="private"] .sg-hat-private').count()>0,kind+' private title bar renders keyhole hat');
 if(mobile){
  await p.evaluate(()=>__wos.goDesk(0,true));await nap(250);
  check(await p.locator('#dock .sg-hat-private').count()>0,kind+' private dock uses keyhole hat');
  const details=await p.locator('#dock .sg-hat-private').first().evaluate(e=>({mask:getComputedStyle(e).maskImage,size:getComputedStyle(e).maskSize,color:getComputedStyle(e.parentElement).getPropertyValue('--c')})).catch(()=>({}));
  check(details.mask?.includes('wizard-mark-private.png')&&details.color?.includes('160'),kind+' actual private mask and green paint',details);
  await p.evaluate(()=>__wos.openOverview());await nap(250);
  check(await p.locator('.ov-home .sg-home').count()===1,kind+' overview Home restored house');
  check(await p.locator('.ov-card .sg-hat-private').count()>0,kind+' overview private identity');
  await p.screenshot({path:path.join(OUT,kind+'-overview.png')});
  await p.evaluate(()=>__wos.closeOverview());
  await p.evaluate(()=>__wos.openAgentChats('hermes'));await nap(800);
  check(await p.locator('#dock .dhome .sg-home').count()>0,kind+' bottom Home restored house');
  const sid=await p.evaluate(()=>__wos.live.sessions.find(s=>!s.archived)?.id);
  if(sid){await p.evaluate(id=>__wos.openWizardThread(id),sid);await nap(500);await p.evaluate(()=>history.back());await nap(300);check(!p.isClosed()&&p.url().includes('/wizard-os-home/'),kind+' nested Back stays inside Wizard');}
  await p.setViewportSize({width:360,height:800});await nap(200);
  const bounds=await p.locator('#dock').evaluate(e=>({right:e.getBoundingClientRect().right,width:innerWidth,orb:!!document.querySelector('#orb')}));
  check(bounds.right<=bounds.width+1&&bounds.orb,kind+' 360px dock stays on screen');
 }else{
  check(await p.locator('#logo .sg-home').count()===1,kind+' Home control restored house');
  check(await p.locator('.wbar .sg-hat-private').count()>0,kind+' private window title identity');
  await p.evaluate(()=>WizOpenAgentChats('hermes'));await nap(800);
  check(await p.locator('.wbar .sg-hat').count()>0,kind+' main window hat identity');
 }
 const mask=await p.evaluate(async()=>{const r=await fetch('/wizard-os-home/brand/wizard-mark-private.png');return {status:r.status,bytes:(await r.arrayBuffer()).byteLength};});
 check(mask.status===200&&mask.bytes>500,kind+' private asset served',mask);
 await p.screenshot({path:path.join(OUT,kind+'.png')});
 check(await p.locator('.ch-row').count()>0,kind+' real main thread rows render');
 await ctx.close();
}
check(errors.length===0,'zero page errors',errors);
check(!writes.some(w=>/\/v1\/runs/.test(w.url)),'zero agent admissions',writes);
}finally{await b.close();}
})().catch(e=>{errors.push(String(e.stack));check(false,'suite completed',String(e));}).finally(()=>{const report={worker:os.hostname(),source:SOURCE||'live',base:BASE,cases,errors,writes,pass:cases.filter(c=>c.pass).length,fail:cases.filter(c=>!c.pass).length};fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,fail:report.fail}));process.exitCode=report.fail?1:0;});
