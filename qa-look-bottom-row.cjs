#!/usr/bin/env node
// Real shell, synthetic preview only. No private stores, owner APIs or external traffic.
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('./tools/qa-playwright.cjs');
const OUT=process.env.QA_OUT||path.join(__dirname,'tmp/look-bottom-row');
const PORT=Number(process.env.QA_PORT||19749),ORIGIN=`http://127.0.0.1:${PORT}`;
const report={pass:false,diagnostic:process.env.QA_DIAGNOSTIC==='1',cases:[],source:process.env.QA_SOURCE_SHA};
fs.mkdirSync(OUT,{recursive:true});
const flush=()=>fs.writeFileSync(path.join(OUT,'geometry.json'),JSON.stringify(report,null,2));
function measure(){
 const box=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
 const style=e=>{const s=getComputedStyle(e);return Object.fromEntries(['display','position','height','minHeight','maxHeight','overflow','overflowY','paddingTop','paddingBottom','marginTop','marginBottom','boxSizing','gridTemplateRows','flexShrink'].map(k=>[k,s[k]]));};
 const root=document.querySelector('#settingsBody'),pane=root.querySelector('.st-page');
 const tile=pane.querySelector('[data-skinpick="signal"]')||[...pane.querySelectorAll('[data-skinpick]')].at(-1);
 const chain=[];for(let e=tile;e;e=e.parentElement)chain.push({tag:e.tagName,id:e.id,cls:e.className,box:box(e),style:style(e),clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop});
 const tiles=[...pane.querySelectorAll('[data-skinpick]')].map(e=>{const label=e.querySelector('.skp-nm'),r=document.createRange();r.selectNodeContents(label);return {id:e.dataset.skinpick,box:box(e),label:box(label),text:[...r.getClientRects()].map(r=>({top:r.top,bottom:r.bottom,left:r.left,right:r.right}))};});
 return {shell:document.documentElement.dataset.shell,skin:WosSkin.current,viewport:{width:innerWidth,height:innerHeight},token:getComputedStyle(root).getPropertyValue('--wz-space-5'),root:box(root),pane:box(pane),chain,tiles};
}
(async()=>{
 const server=spawn(process.execPath,['tools/ux-main-sync-preview.cjs'],{cwd:__dirname,env:{...process.env,PORT:String(PORT),PREVIEW_SHA:process.env.QA_SOURCE_SHA||'diagnostic'},stdio:['ignore','pipe','inherit']});
 let browser;
 try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('preview startup timeout')),10000);server.once('exit',c=>reject(Error('preview exited '+c)));server.stdout.once('data',()=>{clearTimeout(t);resolve();});});
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const shell of ['phone','desktop']){
   const phone=shell==='phone',ctx=await browser.newContext({viewport:phone?{width:412,height:892}:{width:1440,height:900},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
   await ctx.route('**/*',route=>new URL(route.request().url()).origin===ORIGIN?route.continue():route.abort('blockedbyclient'));
   await ctx.routeWebSocket('**/*',ws=>ws.close());
   await ctx.addInitScript(s=>localStorage.setItem('wux.shell',s),shell);
   const p=await ctx.newPage();p.setDefaultTimeout(15000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
   try{
    await p.goto(ORIGIN+'/wizard-os-home/'+(phone?'index.html':'desktop.html')+'?recipe=shared&view=skin',{waitUntil:'load'});
    await p.locator('[data-skinfamily="wizard"]:visible').waitFor();
    assert.equal(await p.evaluate(()=>document.documentElement.dataset.shell),shell);
    for(const skin of ['nebula','grove']){
     await p.locator(`[data-skinpick="${skin}"]:visible`).click();
     await p.waitForFunction(s=>WosSkin.current===s&&!WosExperience.state.busy&&!document.querySelector('.skp-wait'),skin);
     await p.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
     await p.locator('#settingsBody').evaluate(root=>{root.scrollTop=root.scrollHeight;const pane=root.querySelector('.st-page');pane.scrollTop=pane.scrollHeight;});
     await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     const geometry=await p.evaluate(measure),file=`${shell}-${skin}.png`,row={shell,skin,file,geometry,errors:[...errors],checks:[]};report.cases.push(row);flush();
     await p.screenshot({path:path.join(OUT,file)});
     const check=(pass,name,detail)=>row.checks.push({pass:!!pass,name,detail});
     const scroller=geometry.chain.find(r=>r.id==='settingsBody'&&phone||r.cls==='st-page'&&!phone);
     check(parseFloat(scroller.style.paddingBottom)>=24,'scroll owner keeps 24px bottom padding',scroller.style);
     const bottom=Math.max(...geometry.tiles.map(t=>Math.max(t.box.bottom,...t.text.map(r=>r.bottom))));
     check(bottom<=scroller.box.bottom-24+1,'last row and rendered labels clear padded scroll bottom',{bottom,scrollBottom:scroller.box.bottom});
     for(const t of geometry.tiles)for(const r of t.text)check(r.top>=t.box.top-1&&r.bottom<=t.box.bottom+1&&r.left>=t.box.left-1&&r.right<=t.box.right+1,'rendered caption fits '+t.id,{tile:t.box,text:r});
     for(const a of geometry.chain.filter(a=>['auto','hidden','scroll','clip'].includes(a.style.overflowY)&&a.box.height>0))check(bottom<=a.box.bottom+1,'last row fits clipping ancestor '+a.tag+'.'+a.cls,{bottom,ancestor:a.box});
     check(errors.length===0,'no page errors',errors);flush();
    }
   }finally{await ctx.close();}
  }
  report.pass=report.cases.length===4&&report.cases.every(r=>r.checks.every(c=>c.pass));flush();
  console.log(JSON.stringify(report,null,2));if(!report.diagnostic)assert(report.pass,'Look geometry regression; see '+OUT);
 }finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));flush();}
})().catch(e=>{report.failure=String(e);flush();console.error(e);process.exitCode=1;});
