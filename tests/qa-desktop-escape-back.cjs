'use strict';
// Real shell + app bridge, synthetic origin only. Never contacts an owner API or sends.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://escape.test', prefix = '/wizard-os-home/';
const out=process.env.QA_OUT||'escape-back-evidence'; fs.mkdirSync(out,{recursive:true});
let currentPage;
(async () => {
 const browser = await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try { for (const view of ['ai-apps','classic']) for (const skin of ['nebula','sepia']) {
  const context = await browser.newContext({viewport:{width:1440,height:960},permissions:['microphone'],serviceWorkers:'block'});
  await context.routeWebSocket('**/*', ws => ws.close());
  await context.addInitScript(({view,skin}) => {
   localStorage.setItem('wos.shell','desktop'); localStorage.setItem('wos.desktop-view.v1',view);
   for (const [k,v] of Object.entries({'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.skin':skin})) localStorage.setItem(k,v);
  },{view,skin});
  const writes = [], runs = [], errors = [];
  await context.route('**/*', async r => {
   const q=r.request(),u=new URL(q.url());
   if (u.origin!==origin) return r.abort();
   if (u.pathname.includes('/v1/runs')) { runs.push(u.pathname); return r.abort(); }
   if (!['GET','HEAD'].includes(q.method())) { writes.push(q.method()+' '+u.pathname); return r.fulfill({status:403,json:{error:'No writes in QA'}}); }
   if (u.pathname===prefix+'store/index.html') return r.fulfill({contentType:'text/html',body:`<!doctype html><style>body{background:var(--wz-base,#14141c);color:var(--wz-ink,#eee);padding:40px}</style><input id="field" value="unsent"><script>window.depth=1;window.backs=0;window.__wizardCloseOverlay=()=>{backs++;if(depth){depth--;return true;}return false;};document.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopImmediatePropagation();},true);<\/script>`});
   if (u.pathname===prefix+'qa-image.png') return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1kAAAAASUVORK5CYII=','base64')});
   if (u.pathname==='/wizard/hermes/api/sessions') return r.fulfill({json:{data:[{id:'qa-thread',title:'Synthetic chat',status:'completed',updatedAt:'2026-11-05T00:00:00Z'}],has_more:false}});
   if (u.pathname==='/wizard/hermes/api/sessions/qa-thread/messages') return r.fulfill({json:{data:[{id:'qa-image',role:'user',content:[{type:'text',text:'QA image'},{type:'image_url',image_url:{url:'/wizard-os-home/qa-image.png'}}],timestamp:'2026-11-05T00:00:00Z'}],has_more:false}});
   if (u.pathname.startsWith('/wizard/')) return r.fulfill({json:ownerRead(u.pathname)});
   if (u.pathname.startsWith(prefix)) {
    const root=path.resolve(__dirname,'../web'),file=path.resolve(root,u.pathname.slice(prefix.length)||'index.html');
    if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({path:file});
   }
   return r.fulfill({json:{apps:[],agents:[],sessions:[],connected:false}});
  });
  const p=currentPage=await context.newPage(); p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin+prefix+'desktop.html');
  await p.waitForFunction(()=>window.__wux && !WosWelcome.active && !WosExperience.state.busy).catch(async e=>{console.error({view,skin,errors});throw e;});
  if(view==='ai-apps') await p.waitForFunction(()=>document.documentElement.dataset.aiApps==='desktop' && document.querySelector('.ch-compose'));
  // Bare root cannot navigate/repaint the Classic list beneath AI apps.
  if(view==='classic') await p.evaluate(()=>{for(const w of Object.values(__wux.wins))__wux.closeWin(w.id);});
  await p.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)));
  const before=await p.evaluate(()=>JSON.stringify({ws:__wux.ws,cur:__wux.cur,wins:__wux.wins,home:__wux.homeOpen}));
  await p.evaluate(()=>{window.legacySamples=[];window.legacySampler=true;const step=()=>{if(!legacySampler)return;legacySamples.push([...document.querySelectorAll('.pane-list,.pane-empty,.ch-list')].map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {display:s.display,visibility:s.visibility,opacity:s.opacity,w:r.width,h:r.height,text:n.textContent.trim().length};}));requestAnimationFrame(step);};step();});
  await p.keyboard.press('Escape'); await p.waitForFunction(()=>legacySamples.length>=20);
  const samples=await p.evaluate(()=>{legacySampler=false;return legacySamples;});
  assert.equal(await p.evaluate(()=>JSON.stringify({ws:__wux.ws,cur:__wux.cur,wins:__wux.wins,home:__wux.homeOpen})),before,'bare desktop state unchanged');
  if(view==='ai-apps') for(const frame of samples) for(const n of frame) assert.ok(n.text===0 || n.display==='none'||n.visibility==='hidden'||n.opacity==='0'||n.w===0||n.h===0,JSON.stringify(n));
  // A real focused chat and an open app coexist on the AI apps view.
  await p.evaluate(()=>__wux.openThread('qa-thread'));
  await p.waitForFunction(()=>Object.values(__wux.wins).some(w=>w.thread==='qa-thread'));
  await p.evaluate(()=>__wux.openApp(WizCore.apps('desktop').APP['app-store']));
  const field=p.frameLocator('iframe[src*="/store/index.html"]').locator('#field'); await field.waitFor(); await field.focus();
  await p.keyboard.press('Escape');
  assert.equal(await field.evaluate(()=>window.backs),1,'iframe swallowed key still routes one app back');
  assert.equal(await field.evaluate(()=>window.depth),0);
  assert.equal(await p.evaluate(()=>Object.values(__wux.wins).some(w=>w.thread==='qa-thread')),true,'app Escape preserves chat');
  await p.keyboard.press('Escape'); assert.equal(await field.evaluate(()=>window.backs),2,'app root consumes back without closing');
  assert.equal(await field.inputValue(),'unsent');
  // Recording beats both app focus and a newer menu, with no sending.
  await p.evaluate(()=>__wux.talk('start')); await p.waitForFunction(()=>__wux.voiceState==='listen');
  await p.evaluate(()=>WosContextMenu.open({anchor:document.body,label:'QA menu',items:[{label:'Keep',action(){}}]}));
  await p.keyboard.press('Escape'); await p.waitForFunction(()=>__wux.voiceState==='idle');
  assert.equal(await p.evaluate(()=>WosContextMenu.isOpen),true,'voice cancellation leaves menu and surfaces open');
  assert.equal(await field.evaluate(()=>window.backs),2);
  await p.keyboard.press('Escape'); assert.equal(await p.evaluate(()=>WosContextMenu.isOpen),false,'next Escape dismisses menu only');
  assert.equal(await p.evaluate(()=>Object.values(__wux.wins).some(w=>w.thread==='qa-thread')),true);
  // Real chat thumbnail opens the shared image viewer; Back peels its menu then image.
  await p.locator('.win .ch-compose textarea').first().click();
  await p.locator('[data-mi]').first().click();
  await p.waitForFunction(()=>__wux.chats.KIT.viewer.isOpen());
  await p.evaluate(()=>__wux.chats.KIT.viewer.menu());
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>__wux.chats.KIT.viewer.state.menu),false);
  assert.equal(await p.evaluate(()=>__wux.chats.KIT.viewer.isOpen()),true,'menu closes, image stays');
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>__wux.chats.KIT.viewer.isOpen()),false,'Escape closes clicked image');
  assert.equal(await p.evaluate(()=>Object.values(__wux.wins).some(w=>w.thread==='qa-thread')),true,'image Back leaves chat open');
  // Focus the chat, not the app. Its next Back returns to the list.
  await p.locator('.win .ch-compose textarea').first().click(); await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>Object.values(__wux.wins).some(w=>w.thread==='qa-thread')),false,'focused chat closes');
  assert.equal(await field.inputValue(),'unsent','chat back keeps app mounted');
  await p.screenshot({path:path.join(out,view+'-'+skin+'.png')});
  // Live skin switching preserves ownership and focus behavior without reload.
  await p.evaluate(s=>WosSkin.set(s),skin==='nebula'?'sepia':'nebula');
  await p.waitForFunction(s=>WosSkin.current===s && !WosExperience.state.busy,skin==='nebula'?'sepia':'nebula');
  await p.evaluate(s=>WosSkin.set(s),skin);
  await p.waitForFunction(s=>WosSkin.current===s && !WosExperience.state.busy,skin);
  // Release the AI apps list owner: Classic renders the actual list again.
  await p.evaluate(()=>WosExperience.chooseDesktopView('classic'));
  await p.evaluate(()=>__wux.openChatsList());
  await p.waitForFunction(()=>[...document.querySelectorAll('.pane-list [data-chats]')].some(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0;}));
  await p.keyboard.press('Escape');
  assert.ok(await p.locator('.pane-list [data-chats]').first().isVisible(),'Classic list unaffected by Escape at root');
  assert.deepEqual(runs,[]); assert.ok(writes.every(w=>/thread-seen|ui-preferences|appearance/.test(w)),JSON.stringify(writes)); assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,view+'-'+skin+'.json'),JSON.stringify({view,skin,writes,runs,errors,legacySamples:samples},null,2));
  console.log('PASS',view,skin,'root/no-flash, iframe app back/root, recording, menu, focused chat');
  await context.close();
 }} catch(e) { if(currentPage&&!currentPage.isClosed()){await currentPage.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.html'),await currentPage.content().catch(()=>''));console.error(await currentPage.evaluate(()=>({back:window.__wuxLog,body:document.body.innerText.slice(-2000)})).catch(()=>null));} throw e; } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
