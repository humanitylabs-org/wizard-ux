'use strict';
// Real AI-apps shell; synthetic origin only. Never touches owner Look or history.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const origin='https://window-modes.test',prefix='/wizard-os-home/',root=path.resolve(__dirname,'../web');
const out=process.env.QA_OUT||'window-modes-evidence';fs.mkdirSync(out,{recursive:true});
const report={cases:[]};
(async()=>{
 const browser=await chromium.launch(); let p;
 try {
 for(const skin of ['nebula','sepia']) {
  const c=await browser.newContext({viewport:{width:1440,height:960},serviceWorkers:'block',reducedMotion:'reduce'});
  const writes=[],runs=[],errors=[];
  await c.routeWebSocket('**/*',ws=>ws.close());
  await c.addInitScript(skin=>{if(window!==top)return;for(const[k,v]of Object.entries({'wos.shell':'desktop','wos.desktop-view.v1':'ai-apps','wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.skin':skin}))if(localStorage.getItem(k)===null)localStorage.setItem(k,v);},skin);
  await c.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url());if(u.origin!==origin)return r.abort();
   if(u.pathname.includes('/v1/runs')){runs.push(u.pathname);return r.abort();}
   if(!['GET','HEAD'].includes(q.method())){writes.push(q.method()+' '+u.pathname);return r.fulfill({status:403,json:{error:'QA refuses writes'}});}
   if(u.pathname===prefix+'store/index.html')return r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><style>body{background:#171722;color:#eee;padding:24px;font:16px system-ui}input{font:inherit}h1{font-size:24px}</style><h1>Synthetic app</h1><p>This retained document stays open in every window mode.</p><input value="unsent"><script>window.documentId=Math.random()<\/script>'});
   if(u.pathname==='/wizard/v1/ui-preferences')return r.fulfill({json:{migrations:{'launcher-seed-v1':true}}});
   if(u.pathname==='/wizard/hermes/api/sessions')return r.fulfill({json:{data:[{id:'qa-thread',title:'Window modes — synthetic chat',status:'completed',updatedAt:'2026-11-05T00:00:00Z'}],has_more:false}});
   if(u.pathname.startsWith('/wizard/'))return r.fulfill({json:ownerRead(u.pathname)});
   if(u.pathname.startsWith(prefix)){const f=path.resolve(root,u.pathname.slice(prefix.length)||'index.html');if(f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({path:f});}
   return r.fulfill({json:{apps:[],agents:[],sessions:[],connected:false}});
  });
  p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  const settle=async()=>{await p.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)));await p.evaluate(()=>document.fonts.ready);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
  const boot=async()=>{await p.waitForFunction(()=>window.__wux&&document.documentElement.dataset.aiApps==='desktop'&&!WosWelcome.active&&!WosExperience.state.busy&&document.querySelector('.ch-compose'));await settle();};
  const model=()=>p.evaluate(()=>WizCore.panes.get());
  const box=async role=>p.locator('#stage > .wsp[data-aad-role="'+role+'"]').boundingBox();
  const clickMode=async(role,mode)=>{await p.locator((role==='chat'?'.aad-ctop':'.aad-ptop')+' [data-mode="'+mode+'"]').click();await settle();assert.equal((await model()).mode,mode);};
  const shot=async name=>{const file=path.join(out,skin+'-'+name+'.png');await p.screenshot({path:file});report.cases.push({skin,name,file,model:await model(),chat:await box('chat'),app:await box('app')});};
  await p.goto(origin+prefix+'desktop.html');await boot();await p.evaluate(()=>__wux.openThread('qa-thread'));await p.waitForFunction(()=>document.documentElement.hasAttribute('data-aad-chat'));await settle();
  await clickMode('chat','centre');const centre=await box('chat');assert.equal(centre.width,840);assert.equal(centre.x,300);await shot('centred-chat');
  // Floating panel is pixel-identical over loud text and empty background.
  await p.evaluate(()=>{const n=document.createElement('div');n.id='loud-underlay';Object.assign(n.style,{position:'fixed',inset:'0',zIndex:'0',background:'#ff0066',font:'bold 48px monospace',color:'#00ff00',pointerEvents:'none'});n.textContent='LOUD TEXT '.repeat(500);document.body.prepend(n);});
  const clip={x:centre.x+10,y:centre.y+10,width:centre.width-20,height:centre.height-20};
  const over=await p.screenshot({clip});await p.evaluate(()=>document.getElementById('loud-underlay').style.visibility='hidden');const empty=await p.screenshot({clip});
  const pixelDiff=await p.evaluate(async data=>{const decode=async b=>{const i=new Image();i.src='data:image/png;base64,'+b;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,i.width,i.height).data;};const a=await decode(data[0]),b=await decode(data[1]);let n=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])n++;return n;},[over.toString('base64'),empty.toString('base64')]);
  fs.writeFileSync(path.join(out,skin+'-panel-over.png'),over);fs.writeFileSync(path.join(out,skin+'-panel-empty.png'),empty);assert.equal(pixelDiff,0,'opaque floating panel decoded pixels');await p.evaluate(()=>document.getElementById('loud-underlay').remove());
  await clickMode('chat','full');assert.equal((await box('chat')).x,0);assert.equal((await box('chat')).width,1440);await shot('full-chat');
  // Escape closes the transient guide FIRST, not fullscreen.
  await p.keyboard.press('Alt+KeyS');await p.waitForFunction(()=>!document.getElementById('dsettings').hidden);await p.keyboard.press('Escape');await settle();assert.equal((await model()).mode,'full');
  await p.keyboard.press('Escape');await settle();assert.equal((await model()).mode,'tiled');
  await p.evaluate(()=>__wux.openApp(WizCore.apps('desktop').APP['app-store']));const field=p.frameLocator('iframe[src*="/store/index.html"]').locator('input');await field.waitFor();const docId=await field.evaluate(()=>window.documentId);await settle();
  await p.evaluate(()=>WizCore.panes.set({ratio:'1/3'}));await settle();const tiled={chat:await box('chat'),app:await box('app')};
  await clickMode('app','pair');await shot('side-by-side');assert.equal((await box('chat')).x+(await box('chat')).width,(await box('app')).x);
  await clickMode('app','centre');assert.equal(await p.locator('#stage > .wsp[data-aad-role="chat"]').isVisible(),false);await shot('centred-app');
  await clickMode('app','full');await shot('full-app');assert.equal(await field.inputValue(),'unsent');assert.equal(await field.evaluate(()=>window.documentId),docId);
  await field.click();await p.keyboard.press('Alt+Shift+KeyU');await settle();assert.equal((await model()).mode,'centre','trusted iframe chord');
  await p.keyboard.press('Alt+Shift+KeyJ');await settle();assert.equal((await model()).mode,'pair');
  await p.keyboard.press('Alt+Shift+KeyF');await settle();assert.equal((await model()).mode,'full');
  await p.keyboard.press('Alt+Shift+KeyT');await settle();assert.equal((await model()).mode,'tiled');assert.deepEqual({chat:await box('chat'),app:await box('app')},tiled,'tiled ratio restored');
  // Real finite motion: header/body relative offsets do not drift.
  await p.emulateMedia({reducedMotion:'no-preference'});
  const samples=await p.evaluate(()=>new Promise(resolve=>{const desk=document.querySelector('#stage > .wsp[data-aad-role="app"]'),head=desk.querySelector('.aad-ptop'),win=desk.querySelector('.win'),rows=[],start=performance.now();const sample=()=>{const a=head.getBoundingClientRect(),b=win.getBoundingClientRect();rows.push({t:performance.now()-start,x:a.x,dx:a.x-b.x,dy:a.y-b.y});if(performance.now()-start<320)requestAnimationFrame(sample);else resolve(rows);};desk.querySelector('[data-mode="centre"]').click();requestAnimationFrame(sample);}));
  assert.ok(samples.length>3);assert.ok(samples.some(r=>Math.abs(r.x-samples.at(-1).x)>4),'mode actually moves');for(const r of samples){assert.ok(Math.abs(r.dx-samples[0].dx)<.6);assert.ok(Math.abs(r.dy-samples[0].dy)<.6);}report.cases.push({skin,motion:samples,pixelDiff});
  await p.emulateMedia({reducedMotion:'reduce'});await clickMode('app','full');await p.reload();await boot();await field.waitFor();assert.equal((await model()).mode,'full');assert.equal((await model()).ratio,1/3);assert.equal(await p.locator('.aad-ptop .aad-mode-chats').isVisible(),true);await shot('restored-full');
  await p.locator('.aad-ptop .aad-mode-chats').click();await settle();assert.equal((await model()).mode,'tiled');assert.equal(await p.locator('.aad-side').isVisible(),true,'Chats list reachable from full');
  // Live-switchable skin on this synthetic origin only, preserving retained app.
  await p.evaluate(s=>WosSkin.set(s),skin==='nebula'?'sepia':'nebula');await settle();assert.equal(await field.inputValue(),'unsent');await shot('skin-switched');
  assert.deepEqual(errors,[]);assert.deepEqual(runs,[]);assert.ok(writes.every(w=>w==='PUT /wizard/thread-seen'),'only refused read receipts: '+JSON.stringify(writes));report.cases.push({skin,writes,runs,errors});await c.close();
 }
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('PASS window mode controls, trusted shortcuts, Escape ordering, reload, ratios, unified motion, decoded opacity, two skins; synthetic only');
 }catch(e){await p?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'partial-report.json'),JSON.stringify(report,null,2));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
