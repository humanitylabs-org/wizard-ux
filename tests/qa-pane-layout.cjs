'use strict';
// Real shell, two pinned source trees, synthetic origin, no owner reads or sends.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..'), prefix = '/wizard-os-home/', origin = 'https://panes.test';
const baselineRef = 'ed0401b78';
const out = process.env.QA_OUT || 'pane-layout-evidence'; fs.mkdirSync(out, { recursive: true });
// parts.js rides with the baseline desktop.js: the renderer boundary moved noteThread/noteRouteIntoActions out of it,
// so a pinned old desktop.js needs its own parts.js to link.
const changed = new Set(['desktop.html', 'desktop/desktop.js', 'layouts/ai-apps/desktop.js', 'layouts/ai-apps/desktop.css', 'layouts/ai-apps/parts.js']);
const baseline = {};
for (const f of changed) baseline[f] = execFileSync('git', ['show', baselineRef + ':web/' + f], { cwd: repo });
const mime = f => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html';
const selectors = { side: '.aad-side', dock: '.aad-vt', chat: '#stage > .wsp[data-aad-role="chat"]', app: '#stage > .wsp[data-aad-role="app"]', header: '.aad-ptop', ctop: '.aad-ctop' };
(async () => {
 const browser = await chromium.launch({ ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
 let page;
 const report = { baseline: execFileSync('git', ['rev-parse', baselineRef], { cwd: repo, encoding: 'utf8' }).trim(), cases: [] };
 try {
  for (const skin of ['nebula', 'sepia']) {
   let before;
   for (const tree of ['baseline', 'candidate']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const writes = [], runs = [], errors = [];
    await context.routeWebSocket('**/*', ws => ws.close());
    await context.addInitScript(skin => {
     if (window !== top) return;
     for (const [k,v] of Object.entries({ 'wos.shell':'desktop', 'wos.desktop-view.v1':'ai-apps', 'wos.coached':'true', 'wos.tour.v1':'true', 'wos.welcome.v1':'done', 'wos.skin':skin })) localStorage.setItem(k,v);
    }, skin);
    await context.route('**/*', async r => {
     const q = r.request(), u = new URL(q.url());
     if (u.origin !== origin) return r.abort();
     if (u.pathname.includes('/v1/runs')) { runs.push(u.pathname); return r.abort(); }
     if (!['GET','HEAD'].includes(q.method())) { writes.push(q.method()+' '+u.pathname); return r.fulfill({status:403,json:{error:'QA refuses all writes'}}); }
     if ([prefix+'store/index.html',prefix+'agents/index.html'].includes(u.pathname)) return r.fulfill({contentType:'text/html',body:'<!doctype html><style>body{background:#fff;color:#111}</style><h1>Synthetic app</h1><input value="unsent">'});
     if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({json:{migrations:{'launcher-seed-v1':true}}});
     if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({json:{ data:[{id:'qa-thread',title:'Synthetic chat',status:'completed',updatedAt:'2026-11-05T00:00:00Z'}],has_more:false }});
     if (u.pathname.startsWith('/wizard/')) return r.fulfill({json:ownerRead(u.pathname)});
     if (u.pathname.startsWith(prefix)) {
      const f = decodeURIComponent(u.pathname.slice(prefix.length) || 'index.html'), root = path.join(repo,'web'), abs = path.resolve(root,f);
      if (abs.startsWith(root+path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
       if (tree==='baseline' && changed.has(f)) return r.fulfill({contentType:mime(f),body:baseline[f]});
       return r.fulfill({path:abs});
      }
     }
     return r.fulfill({json:{apps:[],agents:[],sessions:[],connected:false}});
    });
    page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+prefix+'desktop.html');
    await page.waitForFunction(()=>window.__wux && document.documentElement.dataset.aiApps==='desktop' && !WosWelcome.active && !WosExperience.state.busy && document.querySelector('.ch-compose'));
    const settle = async () => { await page.waitForFunction(()=>!document.getAnimations().some(a=>a.playState==='running' && Number.isFinite(a.effect?.getComputedTiming().endTime))); await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))); };
    const boxes = () => page.evaluate(selectors => Object.fromEntries(Object.entries(selectors).map(([k,s])=>{ const n=document.querySelector(s); if(!n) return [k,null]; const b=n.getBoundingClientRect(); return [k,{x:b.x,y:b.y,width:b.width,height:b.height}]; })), selectors);
    const snapshots = { home: await boxes() };
    await page.evaluate(()=>__wux.openThread('qa-thread'));
    await page.waitForFunction(()=>document.documentElement.hasAttribute('data-aad-chat'));
    await settle(); snapshots.chat = await boxes();
    await page.evaluate(()=>__wux.openApp(WizCore.apps('desktop').APP['app-store']));
    await page.frameLocator('iframe[src*="/store/index.html"]').locator('input').waitFor();
    await page.waitForFunction(()=>document.documentElement.hasAttribute('data-aad-split'));
    await settle(); snapshots.both = await boxes();
    if (tree==='baseline') before=snapshots;
    else {
     report.cases.push({skin,tree,snapshots});
     // Issue 1233: an open chat takes the room the app panel leaves (it was a fixed narrow column with empty canvas
     // beside it). Everything else stays pixel-equal to the baseline; the chat and its header keep their left edge
     // and now end where the app panel (or, with no app, the tabs column) starts.
     const strip = s => Object.fromEntries(Object.entries(s).map(([state,b])=>[state,state==='home'?b:{...b,chat:b.chat&&{x:b.chat.x,y:b.chat.y,height:b.chat.height},ctop:b.ctop&&{x:b.ctop.x,y:b.ctop.y,height:b.ctop.height}}]));
     assert.deepEqual(strip(snapshots),strip(before),'default pane boxes equal before (chat width aside) on '+skin);
     for (const state of ['chat','both']) {
      const b=snapshots[state], end=state==='both'?b.app.x:b.dock.x;
      for (const k of ['chat','ctop']) assert.ok(Math.abs(b[k].x+b[k].width-end)<=1/64,state+' '+k+' fills to '+end+': '+JSON.stringify(b[k]));
      assert.ok(b.chat.width>=before[state].chat.width,state+' chat never narrower than before');
     }
     for (const patch of [{ratio:'1/3'}, {ratio:'2/3'}, {ratio:'1/2',side:'end'}, {side:'start',dock:{edge:'start'}}]) {
      await page.evaluate(p=>WizCore.panes.set(p),patch); await settle();
      const actual = await boxes();
      const expected = await page.evaluate(()=>{
       const root=document.documentElement, s=getComputedStyle(root), px=k=>parseFloat(s.getPropertyValue(k));
       return WizCore.panes.geometry(WizCore.panes.get(),{width:innerWidth,height:innerHeight},{sideWidth:root.dataset.aadSide==='open'?px('--aad-side-w'):52,dockWidth:root.dataset.aadTabs==='rail'?52:px('--aad-tabs-px'),appWidth:px('--aad-app-px'),chatOn:true,appOn:true});
      });
      for (const [id,want] of Object.entries({side:expected.sidebar,dock:expected.dock,chat:expected.panes.chats,app:expected.panes.app})) {
       for (const k of ['x','width']) assert.ok(Math.abs(actual[id][k]-want[k])<=1/64,id+' '+k+' '+JSON.stringify({actual:actual[id],want}));
      }
      const rects=['side','dock','chat','app'].map(k=>actual[k]);
      for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++)assert.ok(Math.min(rects[i].x+rects[i].width,rects[j].x+rects[j].width)-Math.max(rects[i].x,rects[j].x)<=1/64,'no pane overlap');
      report.cases.push({skin,patch,actual,expected});
     }
     await page.screenshot({path:path.join(out,skin+'-dock-start.png')});
     await page.evaluate(()=>WosSkin.set(WosSkin.current==='nebula'?'sepia':'nebula')); await settle();
     assert.equal(await page.frameLocator('iframe[src*="/store/index.html"]').locator('input').inputValue(),'unsent','skin switch retains app');
     await page.evaluate(()=>WizCore.panes.set({ratio:null,side:'start',dock:{edge:'end'}})); await settle();
     await page.evaluate(skin=>WosSkin.set(skin),skin); await settle();
    }
    await page.screenshot({path:path.join(out,skin+'-'+tree+'-default.png')});
    if (tree==='candidate') {
     await page.evaluate(()=>{ __wux.openApp(WizCore.apps('desktop').APP.agents); WizCore.panes.set({slots:['chats','app','app2'],app2:'app-store',ratio:'1/2'}); });
     await page.waitForFunction(()=>document.querySelector('#stage > .wsp[data-aad-role="app2"]'));
     await settle();
     assert.equal(await page.frameLocator('iframe[src*="/store/index.html"]').locator('input').inputValue(),'unsent');
     const second=await page.locator('#stage > .wsp[data-aad-role="app2"]').boundingBox(), actual=await boxes();
     assert.equal(second.width,238); assert.equal(actual.chat.width,476); assert.equal(actual.app.width,238);
     assert.equal(actual.chat.x+actual.chat.width,actual.app.x); assert.equal(actual.app.x+actual.app.width,second.x);
     assert.equal(await page.locator('#stage > .wsp[data-aad-role="app2"]').isVisible(),true);
     report.cases.push({skin,secondApp:second,actual});
     await page.screenshot({path:path.join(out,skin+'-second-app.png')});
     await page.evaluate(()=>WizCore.panes.set({slots:['app','app2'],weights:{app:2,app2:1}})); await settle();
     assert.equal(await page.locator(selectors.chat).isVisible(),false,'omitted Chats is not interactive behind apps');
     const appOnly=await boxes(), secondOnly=await page.locator('#stage > .wsp[data-aad-role="app2"]').boundingBox();
     assert.equal(appOnly.app.width,635); assert.equal(secondOnly.width,317);
     assert.equal(appOnly.app.x+appOnly.app.width,secondOnly.x);
     report.cases.push({skin,omittedChats:true,app:appOnly.app,second:secondOnly});
     await page.screenshot({path:path.join(out,skin+'-two-apps-only.png')});
     await page.evaluate(()=>WizCore.panes.set({slots:['chats'],weights:{}})); await settle();
     assert.equal(await page.locator(selectors.app).isVisible(),false,'omitted app is hidden');
     assert.equal(await page.locator(selectors.header).isVisible(),false,'omitted app header is hidden');
     assert.equal((await boxes()).chat.width,952);
    }
    assert.deepEqual(errors,[]); assert.deepEqual(runs,[]);
    assert.ok(writes.every(w=>w==='PUT /wizard/thread-seen'),'only explicitly refused read receipts: '+JSON.stringify(writes));
    report.cases.push({skin,tree,snapshots,writes,runs,errors});
    await context.close();
   }
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  console.log('PASS default pixel-equal pane boxes; 1/3, 2/3, chats-end, dock-start; two skins; no sends');
 } catch(e) { await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{}); fs.writeFileSync(path.join(out,'partial-report.json'),JSON.stringify(report,null,2)); throw e; }
 finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
