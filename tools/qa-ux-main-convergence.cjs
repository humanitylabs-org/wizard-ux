// forum-only: delivered-source phone + desktop, two in-shell skins, no owner APIs.
'use strict';
const {chromium}=require('./qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const BASE=process.env.QA_BASE,OUT=process.env.QA_OUT,SHA=process.env.QA_EXPECT_SHA;
assert(BASE&&OUT&&SHA,'QA_BASE, QA_OUT and QA_EXPECT_SHA required');fs.mkdirSync(OUT,{recursive:true});
const report={base:BASE,expected_sha:SHA,scope:'synthetic Chromium only; no physical phone/provider/private app acceptance',cases:[],pass:false};
const flush=()=>fs.writeFileSync(path.join(OUT,'browser-results.json'),JSON.stringify(report,null,2));
(async()=>{const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 for(const phone of [true,false])for(const optional of [false,true]){
  const id=(phone?'phone':'desktop')+'-'+(optional?'james-opt-in':'shared-default');const row={id,checks:[],errors:[],failed_requests:[],refused_writes:[],shots:[],skins:[]};report.cases.push(row);flush();
  const ctx=await b.newContext({viewport:phone?{width:412,height:892}:{width:1440,height:1000},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
  const p=await ctx.newPage();p.setDefaultTimeout(15000);
  p.on('pageerror',e=>{row.errors.push(String(e));flush();});p.on('requestfailed',r=>{row.failed_requests.push({url:r.url(),error:r.failure()});flush();});p.on('response',r=>{if(r.status()===403)row.refused_writes.push({url:r.url(),method:r.request().method()});});
  const check=(ok,name,detail)=>{row.checks.push({pass:!!ok,name,detail});flush();assert(ok,name+': '+JSON.stringify(detail));};
  const shot=async(name)=>{const file=path.join(OUT,id+'-'+name+'.png');await p.screenshot({path:file,fullPage:false});row.shots.push(file);flush();};
  try{
   const receipt=await ctx.request.get(new URL('/__preview/receipt',BASE).href);assert.equal(receipt.status(),200);row.receipt=await receipt.json();check(row.receipt.sha===SHA&&!row.receipt.upstream&&!row.receipt.writes&&!row.receipt.websockets,'HTTPS delivered immutable synthetic read-only origin',row.receipt);
   const root=process.env.QA_SOURCE_WEB;
   for(const [asset,expected] of Object.entries(row.receipt.assets)){
    const res=await ctx.request.get(new URL('/wizard-os-home/'+asset,BASE).href);assert.equal(res.status(),200);const actual=crypto.createHash('sha256').update(await res.body()).digest('hex');check(actual===expected,'delivered source hash '+asset,{actual,expected});
    if(root)check(actual===crypto.createHash('sha256').update(fs.readFileSync(path.join(root,asset))).digest('hex'),'worker source equals delivered '+asset);
   }
   for(const method of ['POST','PUT','PATCH','DELETE'])check((await ctx.request.fetch(new URL('/wizard/v1/ui-preferences',BASE).href,{method,data:{synthetic:true}})).status()===403,'server refuses '+method);
   await p.goto(new URL('/wizard-os-home/'+(phone?'index.html':'desktop.html')+'?recipe='+(optional?'james':'shared')+'&skin=nebula',BASE).href,{waitUntil:'load'});
   await p.waitForFunction(()=>!!(window.__wos||window.__wux)&&window.WosExperience&&!WosExperience.state.busy&&window.WosSettings);
   check(await p.evaluate(phone=>phone?!!window.__wos&&!window.__wux:!!window.__wux&&!window.__wos,phone),'actual responsive shell entrypoint');
   const experience=await p.evaluate(()=>WosExperience.state.tweaks.map(({id,on})=>({id,on})));row.experience=experience;
   for(const tweak of ['wizard/orb-radial','wizard/new-send-list','miguel/group-by-day'])check(experience.some(t=>t.id===tweak&&t.on===optional),'optional tweak matches explicit recipe '+tweak,experience);
   if(!optional)check(await p.evaluate(()=>!window.WosOrbSwitcher&&!performance.getEntriesByType('resource').some(r=>/orb-switcher\.js/.test(r.name))),'OFF does not import orb handler');
   else if(phone)await p.waitForFunction(()=>window.WosOrbSwitcher?.active());
   await shot('shell-nebula');
   for(const skin of ['nebula','grove']){
    await p.evaluate(()=>WizCore.deeplink.route('/wizard-os-home/?view=skin'));
    await p.locator('#settingsBody').waitFor({state:'visible'});
    const family=await p.evaluate(s=>WosSkin.familyOf?.(s),skin);
    if(family&&await p.locator('[data-skinfamily="'+family+'"]:visible').count())await p.locator('[data-skinfamily="'+family+'"]:visible').click();
    await p.locator('[data-skinpick="'+skin+'"]:visible').click();
    await p.waitForFunction(s=>WosSkin.current===s&&!WosExperience.state.busy,skin);
    const tokens=await p.evaluate(()=>{const s=getComputedStyle(document.documentElement);return Object.fromEntries(['--wz-text','--wz-base','--wz-accent','--wz-panel'].map(k=>[k,s.getPropertyValue(k).trim()]));});
    check(Object.values(tokens).every(Boolean),'Appearance v1 tokens present '+skin,tokens);row.skins.push({skin,tokens});
    await shot(skin+'-appearance-in-shell');
    if(phone)await p.evaluate(()=>__wos.onBack());else await p.keyboard.press('Escape');
    await p.locator('#settingsBody [data-st-page="about"]:visible').waitFor();
    await p.locator('#settingsBody [data-st-page="about"]:visible').click();
    await p.waitForFunction(()=>document.querySelector('#settingsBody').dataset.settingsPage==='about');
    await shot(skin+'-about-in-shell');
    if(phone)await p.evaluate(()=>__wos.onBack());else await p.keyboard.press('Escape');
    await p.locator('#settingsBody [data-st-page="about"]:visible').waitFor();
    if(phone)await p.evaluate(()=>__wos.onBack());else await p.keyboard.press('Escape');
    const sheet=p.locator(phone?'#settings':'#dsettings');
    await p.waitForFunction(phone=>{const e=document.querySelector(phone?'#settings':'#dsettings');if(!e)return true;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||r.bottom<=0||r.top>=innerHeight;},phone);
    await shot(skin+'-after-nested-back');
   }
   check(row.errors.length===0,'no page errors',row.errors);
  }catch(e){row.failure=String(e);await shot('failure').catch(()=>{});throw e;}finally{await ctx.close();flush();}
 }
 report.pass=report.cases.length===4&&report.cases.every(r=>!r.failure&&r.checks.every(c=>c.pass));flush();assert(report.pass);
}finally{await b.close();flush();}})().catch(e=>{report.failure=String(e);flush();console.error(e);process.exitCode=1;});
