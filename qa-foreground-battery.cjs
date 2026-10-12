// Read-only foreground work probe. Run Chromium on Thales, never Telos.
// Real session reads; all non-GET/HEAD requests refused. QA_TREE swaps only static UX files.
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.QA_PLAYWRIGHT || '/home/telos/node_modules/playwright');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/?open=chats';
const TREE = process.env.QA_TREE, SECONDS = +(process.env.QA_SECONDS || 15);
(async () => {
 const b = await chromium.launch({args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const ctx = await b.newContext({viewport:{width:412,height:892},deviceScaleFactor:2.6,hasTouch:true,isMobile:true,ignoreHTTPSErrors:true,serviceWorkers:'block',userAgent:'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'});
 let refused=0;
 await ctx.route('**/*',r => {
  const q=r.request(), u=new URL(q.url());
  if(!['GET','HEAD'].includes(q.method())) { refused++; return r.fulfill({status:403,contentType:'application/json',body:'{"error":"read-only battery QA"}'}); }
  if(TREE && u.pathname.startsWith('/wizard-os-home/')) {
   const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html';
   if(!rel.includes('..')) { const f=path.join(TREE,'web',rel); if(fs.existsSync(f)&&fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':rel.endsWith('.png')?'image/png':'text/plain',body:fs.readFileSync(f)}); }
  }
  return r.continue();
 });
 await ctx.addInitScript(() => {
  localStorage.setItem('wos.coached','true');
  window.__batteryQA={canvas:{},mutations:0,raf:0};
  const q=window.__batteryQA;
  for(const [klass,method] of [[CanvasRenderingContext2D,'clearRect'],[WebGLRenderingContext,'drawArrays']]) {
   const orig=klass.prototype[method]; klass.prototype[method]=function(...a){const k=this.canvas.id||'unnamed';q.canvas[k]=(q.canvas[k]||0)+1;return orig.apply(this,a);};
  }
  const raf=window.requestAnimationFrame.bind(window); window.requestAnimationFrame=f=>raf(t=>{q.raf++;f(t);});
  addEventListener('DOMContentLoaded',()=>new MutationObserver(l=>q.mutations+=l.length).observe(document.body,{attributes:true,childList:true,subtree:true,characterData:true}));
 });
 const p=await ctx.newPage(), errors=[]; p.on('pageerror',e=>errors.push(String(e)));
 let measure=false, requests=[],bytes=0;
 p.on('request',q=>{if(measure) requests.push(new URL(q.url()).pathname);});
 p.on('response',async r=>{if(measure){try{bytes+=(await r.body()).length;}catch{}}});
 await p.goto(URL_,{waitUntil:'load'}); await p.waitForFunction(()=>window.WizLive?.ok && window.__wos);
 if(process.env.QA_SESSION) { await p.evaluate(id=>__wos.openWizardThread(id),process.env.QA_SESSION);await p.waitForFunction(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats'&&w.thread);return w&&__wos.chats.ch(w.id).loadedFor===w.thread&&!__wos.chats.ch(w.id).loading;}); }
 await p.waitForTimeout(4500);
 const cdp=await ctx.newCDPSession(p); await cdp.send('Performance.enable');
 const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
 const a=await metrics(); await p.evaluate(()=>{__batteryQA.canvas={};__batteryQA.mutations=0;__batteryQA.raf=0;});
 measure=true;await p.waitForTimeout(SECONDS*1000);measure=false;
 const z=await metrics(),profile=(await cdp.send('Profiler.stop')).profile;
 const weights={}; (profile.samples||[]).forEach((id,i)=>weights[id]=(weights[id]||0)+(profile.timeDeltas?.[i]||0));
 const top=profile.nodes.map(n=>({fn:n.callFrame.functionName,url:n.callFrame.url,line:n.callFrame.lineNumber+1,ms:Math.round((weights[n.id]||0)/1000)})).sort((a,b)=>b.ms-a.ms).slice(0,15);
 const snap=await p.evaluate(()=>({...__batteryQA,orbFrames:Orb.frames,mode:Orb.mode,rows:document.querySelectorAll('[data-chopen]').length,stars:{w:stars.width,h:stars.height},animations:document.getAnimations().filter(a=>a.playState==='running').map(a=>({name:a.animationName,target:a.effect?.target?.className})),desk:__wos.idx}));
 const output={seconds:SECONDS,snapshot:snap,taskMs:Math.round((z.TaskDuration-a.TaskDuration)*1000),scriptMs:Math.round((z.ScriptDuration-a.ScriptDuration)*1000),layoutMs:Math.round((z.LayoutDuration-a.LayoutDuration)*1000),requests:requests.reduce((m,u)=>(m[u]=(m[u]||0)+1,m),{}),responseBytes:bytes,refusedWrites:refused,errors,top};
 console.log(JSON.stringify(output,null,2));if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(output,null,2));
 await ctx.close();await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
