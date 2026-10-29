// Foreground battery regression. Real Wizard reads, no writes. Run only on Thales.
// QA_TREE serves candidate static assets; baseline uses the live shell unchanged.
const fs=require('fs'),path=require('path');
const {chromium}=require('./tools/qa-playwright.cjs');
const BASE=process.env.QA_URL||(require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/?open=chats');
(async()=>{
 const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const ctx=await browser.newContext({viewport:{width:412,height:892},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,permissions:['microphone'],ignoreHTTPSErrors:true,serviceWorkers:'block'});
 let writes=0,runs=0,checks=[];const errors=[];
 const check=(name,ok,evidence)=>{checks.push({name,pass:!!ok,evidence});console.log(`${ok?'PASS':'FAIL'} ${name} ${JSON.stringify(evidence??'')}`);};
 await ctx.route('**/*',r=>{const q=r.request(),u=new URL(q.url());
  if(!['GET','HEAD'].includes(q.method())){writes++;if(u.pathname==='/v1/runs')runs++;return r.fulfill({status:403,contentType:'application/json',body:'{"error":"QA refuses writes"}'});}
  if(process.env.QA_TREE&&u.pathname.startsWith('/wizard-os-home/')){const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html',f=path.join(process.env.QA_TREE,'web',rel);if(!rel.includes('..')&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({status:200,contentType:rel.endsWith('.js')?'application/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':rel.endsWith('.png')?'image/png':'text/plain',body:fs.readFileSync(f)});}
  return r.continue();});
 await ctx.addInitScript(()=>{
  localStorage.setItem('wos.coached','true');window.__draws={stars:0,orb:0};window.__qaHide=false;
  Object.defineProperty(Document.prototype,'hidden',{configurable:true,get(){return __qaHide;}});
  Object.defineProperty(Document.prototype,'visibilityState',{configurable:true,get(){return __qaHide?'hidden':'visible';}});
  const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.id==='stars')__draws.stars++;return clear.apply(this,a);};
  const draw=WebGLRenderingContext.prototype.drawArrays;WebGLRenderingContext.prototype.drawArrays=function(...a){if(this.canvas.id==='orb')__draws.orb++;return draw.apply(this,a);};
 });
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(BASE,{waitUntil:'load'});await p.waitForFunction(()=>WizLive.ok&&__wos.chats);await p.waitForTimeout(4000);
 const sample=async(ms=3000)=>{const a=await p.evaluate(()=>({...__draws}));await p.waitForTimeout(ms);const z=await p.evaluate(()=>({...__draws}));return{stars:z.stars-a.stars,orb:z.orb-a.orb};};
 check('WebGL orb remains rendered',await p.evaluate(()=>Orb.webgl&&Orb.frames>0));
 const idle=await sample();check('idle sky draws zero frames',idle.stars===0,idle);check('idle in-app orb draws zero frames',idle.orb===0,idle);
 check('resting nebula/halo/rings/moons have no running animation',await p.evaluate(()=>!document.getAnimations().some(a=>a.playState==='running'&&(/orb-halo|orb-ring|moons/.test(a.effect?.target?.className||'')||a.effect?.target?.parentElement?.classList.contains('nebula')))));
 await p.evaluate(()=>Orb.press(true));const pressed=await sample(400);await p.evaluate(()=>Orb.press(false));check('touch feedback wakes the orb',pressed.orb>0,pressed);
 await p.evaluate(()=>__wos.setVoice('listen'));const listen=await sample(1700);check('live recording feedback remains animated',listen.orb>0,listen);
 check('live halo animation resumes',await p.evaluate(()=>getComputedStyle(document.querySelector('.orb-halo')).animationPlayState==='running'));
 await p.evaluate(()=>__wos.setVoice('idle'));await p.waitForTimeout(2400);check('orb settles back to zero frames', (await sample()).orb===0);
 await p.evaluate(()=>{__qaHide=true;document.dispatchEvent(new Event('visibilitychange'));});const hidden=await sample(1000);check('hidden shell draws nothing',hidden.stars===0&&hidden.orb===0,hidden);
 await p.evaluate(()=>{__qaHide=false;document.dispatchEvent(new Event('visibilitychange'));});const shown=await sample(2000);check('foreground return repaints both canvases',shown.stars>0&&shown.orb>0,shown);check('foreground return settles again',(await sample()).orb===0);
 const resizeBefore=await p.evaluate(()=>({...__draws}));await p.setViewportSize({width:430,height:900});await p.waitForTimeout(2000);const resizeAfter=await p.evaluate(()=>({...__draws}));const resized={stars:resizeAfter.stars-resizeBefore.stars,orb:resizeAfter.orb-resizeBefore.orb};check('resize redraws the sky and orb',resized.stars>0&&resized.orb>0,resized);
 await p.evaluate(()=>__wos.goDesk(__wos.HOME));const moved=await sample(1100);check('desk movement redraws the sky',moved.stars>0,moved);
 await p.evaluate(()=>__wos.goDesk(1));await p.waitForTimeout(500);
 const lists=await p.evaluate(()=>{const w=Object.values(__wos.wins).find(w=>w.app==='chats'&&!w.thread),el=document.querySelector(`[data-chats="${w.id}"]`);__wos.chats.renderChatList(w,el);const root=el.firstElementChild,scroll=el.querySelector('.ch-scroll');scroll.scrollTop=90;__wos.chats.renderChatList(w,el);const same=el.firstElementChild===root;const pos=el.querySelector('.ch-scroll').scrollTop;const old=WizLive.sessions[0].title;WizLive.sessions[0].title=old+' [local QA]';__wos.chats.renderChatList(w,el);const changed=el.firstElementChild!==root;WizLive.sessions[0].title=old;__wos.chats.renderChatList(w,el);return{same,changed,scroll:pos};});
 check('unchanged chat list keeps its DOM',lists.same,lists);check('changed list still updates',lists.changed,lists);
 // Cache tests adjust only in-memory timestamps/session metadata, never server records.
 const result=await p.evaluate(async()=>{
  const w=Object.values(__wos.wins).find(w=>w.app==='chats');const s=WizLive.sessions.filter(s=>(!s.status||s.status==='completed')&&Number.isSafeInteger(s.messageCount)&&s.messageCount>1).sort((a,b)=>a.messageCount-b.messageCount)[0];
  if(!s)return{error:'No real completed session available'};
  // Hold a local session fixture stable while unrelated 15 s list reads finish. Message reads stay real.
  const sessionFn=WizLive.session;WizLive.session=function(id){return id===s.id?s:sessionFn.call(this,id);};
  __wos.openChat(w.id,s.id);while(__wos.chats.ch(w.id).loading)await new Promise(r=>setTimeout(r,50));
  const c=__wos.chats.ch(w.id);const original=WizLive.messages;let reads=0;WizLive.messages=async(...a)=>{reads++;return original.apply(WizLive,a);};
  const refresh=async(age,force)=>{c.at=Date.now()-age;await __wos.chats.loadThread(w,force);};
  await refresh(20000);const quiet=reads;
  s.messageCount++;await refresh(20000);const countChanged=reads;s.messageCount--;
  c.readRevision='';await refresh(0); // normalize revision before testing activity-only invalidation
  const a=reads;const old=s.activityAt;s.activityAt=new Date().toISOString();await refresh(0);const activity=reads>a;s.activityAt=old;
  c.readRevision='';await refresh(0);const b=reads;await refresh(61000);const safety=reads>b;
  const d=reads;await refresh(0,true);const force=reads>d;
  const oldStatus=s.status;s.status='running';const e=reads;await refresh(4000);const working=reads>e;s.status=oldStatus;
  c.err='local QA read failure';const f=reads;await refresh(20000);const retry=reads>f;
  const count=s.messageCount;s.messageCount=undefined;const g=reads;await refresh(20000);const unknown=reads>g;s.messageCount=count;
  WizLive.messages=original;WizLive.session=sessionFn;return{session:s.id,messageCount:s.messageCount,quiet,countChanged,activity,safety,force,working,retry,unknown};
 });
 check('finished unchanged history is cached past 15 seconds',result.quiet===0,result);
 check('message-count change reloads immediately',result.countChanged>result.quiet,result);
 check('activity-only change invalidates cache',result.activity,result);
 check('60-second safety read remains',result.safety,result);check('forced refresh remains',result.force,result);check('working reply cadence remains',result.working,result);check('failed reads retain retry cadence',result.retry,result);check('unknown revision retains existing cadence',result.unknown,result);
 await p.evaluate(()=>__wosNativeBack());check('Back leaves the thread and keeps Wizard open',await p.evaluate(()=>!!__wos&&Object.values(__wos.wins).some(w=>w.app==='chats'&&!w.thread)));
 await p.evaluate(()=>Orb.setRestingMotion?.(true));await p.waitForTimeout(2500);const nativeDefault=await sample(1500);check('shared default resting motion still available',nativeDefault.orb>0,nativeDefault);await p.evaluate(()=>Orb.setRestingMotion?.(false));
 check('no unexpected page errors',errors.length===0,errors);check('all writes intercepted; no agent run requested',runs===0,{blockedWrites:writes,runs});
 if(process.env.QA_SHOTS){fs.mkdirSync(process.env.QA_SHOTS,{recursive:true});await p.screenshot({path:path.join(process.env.QA_SHOTS,'foreground.png')});}
 const report={checks,pass:checks.filter(c=>c.pass).length,fail:checks.filter(c=>!c.pass).length,idle,result,writes,runs,errors};if(process.env.QA_OUT)fs.writeFileSync(process.env.QA_OUT,JSON.stringify(report,null,2));console.log(`${report.pass}/${checks.length} passed`);await browser.close();process.exit(report.fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
