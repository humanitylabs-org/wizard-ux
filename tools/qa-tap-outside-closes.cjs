'use strict';
// James: tap outside any sheet/menu/modal closes it, like Back. No live service,
// owner data or external network: real browser + production modules, fixture APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./qa-playwright.cjs');
const web = path.resolve(__dirname, '../web');
const origin = 'http://wizard.test';
const shell = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/core/base.css"><link rel="stylesheet" href="/core/links.css">
<link rel="stylesheet" href="/core/home-screen-apps.css"><link rel="stylesheet" href="/core/share-sheet.css">
<link rel="stylesheet" href="/core/app-route.css"><link rel="stylesheet" href="/core/tour.css">
<link rel="stylesheet" href="/core/sel-menu.css"><link rel="stylesheet" href="/core/resources.css">
<link rel="stylesheet" href="/core/chats.css">
<style>body{margin:0}#device{position:relative;width:390px;height:844px}#app-frame{position:absolute;top:240px;left:20px;width:340px;height:400px}#outside{position:absolute;top:8px;left:8px}#words{user-select:text;-webkit-user-select:text;position:absolute;top:180px;left:16px}.rs-sheet{position:absolute;inset:100px 20px 50px}</style>
<div id="device" class="device"><button id="outside">Outside</button><p id="words">Words for a selection menu test</p><iframe id="app-frame" src="/fixture-app"></iframe></div>
<script>
window.appFixture={id:'notes',name:'Notes',kind:'wizard',url:'/fixture-app'};
window.WizCore={apps:()=>({APP:{notes:appFixture,messenger:{id:'messenger',name:'Messenger',kind:'wizard',url:'/fixture-app'}}})};
window.WizHomeScreenPolicy={validId:id=>/^[a-z][a-z0-9-]*$/.test(id),isShell:()=>false,within:()=>true,displayName:a=>a.name};
window.WosAgents={esc:s=>String(s??''),onChange(){},binding:()=>null,list:[],get:()=>null,icon:()=>'',colour:()=>'',appKnown:()=>false,load:async()=>{},loadBindings:async()=>{},loadOptions:async()=>null,appAgents:async()=>null};
window.__wos={idx:0,sheet:null,desks:[{wins:[]}],toast(){}};
window.WosUsage={normalize:()=>({providers:[]}),html:()=>'<p>No fixture usage</p>'};
</script>`;
const app = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/kit/wizard-ui.css"><script src="/core/app-client.js"></script><script src="/kit/wizard-sheet.js"></script>
<style>dialog{box-sizing:border-box;position:fixed;inset:auto 10px 10px;width:300px;height:150px;margin:0;padding:20px}#hold{position:fixed;top:10px;left:10px}</style>
<button id="hold">Hold</button><dialog id="sheet"><button id="action">Action</button></dialog>
<script>
window.activated=0;window.cancelled=0;
action.onclick=()=>activated++;
sheet.oncancel=()=>cancelled++;
window.openSheet=()=>{sheet.showModal();window.releaseBack=WizardApp.back.push(()=>{sheet.close();return true;});};
sheet.onclose=()=>releaseBack?.release();
hold.onpointerdown=()=>{window.holdTimer=setTimeout(openSheet,450);};hold.onpointerup=()=>clearTimeout(holdTimer);
</script>`;
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }
(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    await context.route('**/*', async route => {
      const u = new URL(route.request().url());
      assert.equal(u.origin, origin, 'test must not contact another origin');
      if (u.pathname === '/fixture') return route.fulfill({contentType:'text/html',body:shell});
      if (u.pathname === '/fixture-app') return route.fulfill({contentType:'text/html',body:app});
      if (u.pathname.startsWith('/fixture-page')) return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture page</title><p>Page</p>'});
      const file = path.resolve(web, '.' + u.pathname);
      if (file.startsWith(web + '/') && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'image/png'});
      return route.fulfill({contentType:'application/json',body:'{}'});
    });
    const page = await context.newPage();
    const errors=[];page.on('pageerror', e=>errors.push(e.message));
    await page.goto(origin+'/fixture');
    const frame=page.frames().find(f=>f.url()===origin+'/fixture-app');
    await frame.waitForFunction(()=>window.WizardApp && window.WzSheet);
    const mounted=async()=>assert.equal(await page.locator('#app-frame').count(),1,'app frame stays mounted');
    const tapBackdrop=()=>page.touchscreen.tap(30,270);
    const open=()=>frame.evaluate(()=>openSheet());
    const isOpen=()=>frame.evaluate(()=>sheet.open);
    await check('hosted dialog: backdrop sends cancel, closes, releases Back; frame stays mounted',async()=>{
      await open();await tapBackdrop();assert.equal(await isOpen(),false);assert.equal(await frame.evaluate(()=>cancelled),1);await mounted();
    });
    await check('hosted dialog: cancelled cancel respects veto, Notes-style cancel closes itself',async()=>{
      await frame.evaluate(()=>sheet.oncancel=e=>e.preventDefault());await open();await tapBackdrop();assert.equal(await isOpen(),true);
      await frame.evaluate(()=>sheet.oncancel=e=>{e.preventDefault();sheet.close();});await tapBackdrop();assert.equal(await isOpen(),false);await mounted();
    });
    await check('hosted dialog: inside tap is not Back; keyboard activation passes without pointerdown',async()=>{
      await open();await frame.locator('#action').tap();assert.equal(await frame.evaluate(()=>activated),1);assert.equal(await isOpen(),true);
      await frame.locator('#action').focus();await page.keyboard.press('Enter');assert.equal(await frame.evaluate(()=>activated),2);await frame.evaluate(()=>sheet.close());
    });
    await check('hosted dialog: long-press opening release cannot dismiss or activate a menu item',async()=>{
      await frame.locator('#hold').dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',bubbles:true});
      await frame.waitForFunction(()=>sheet.open);
      await frame.evaluate(()=>{action.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));sheet.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:0,clientY:0}));});
      assert.equal(await isOpen(),true);assert.equal(await frame.evaluate(()=>activated),2);await tapBackdrop();assert.equal(await isOpen(),false);await mounted();
    });
    await check('hosted dialog: real touch hold then release leaves the new modal open',async()=>{
      const hold=await frame.locator('#hold').boundingBox(),cdp=await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hold.x+10,y:hold.y+10}]});await frame.waitForFunction(()=>sheet.open);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await isOpen(),true);assert.equal(await frame.evaluate(()=>activated),2);await tapBackdrop();assert.equal(await isOpen(),false);await cdp.detach();await mounted();
    });
    await check('hosted dialog: inside-to-outside drag does not close; re-open forgets prior pointerdown',async()=>{
      await open();await frame.evaluate(()=>{action.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));sheet.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:0,clientY:0}));});assert.equal(await isOpen(),true);
      await frame.evaluate(()=>{sheet.close();openSheet();sheet.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1,clientX:0,clientY:0}));});assert.equal(await isOpen(),true);await tapBackdrop();assert.equal(await isOpen(),false);
    });
    await check('hosted dialog: opt-out and nonmodal dialogs are untouched, including kit wiring',async()=>{
      await frame.evaluate(()=>{sheet.dataset.wzNoOutsideClose='';WzSheet.open(sheet);});await tapBackdrop();assert.equal(await isOpen(),true);
      await frame.evaluate(()=>{WzSheet.close(sheet);delete sheet.dataset.wzNoOutsideClose;sheet.show();});
      await frame.evaluate(()=>sheet.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,clientX:0,clientY:0})));assert.equal(await isOpen(),true);await frame.evaluate(()=>sheet.close());
    });
    const script=async f=>page.addScriptTag({url:origin+'/core/'+f+'.js'});
    await script('sigils');await script('links');await script('home-screen-apps');await script('share-sheet');await script('app-route');await script('tour');await script('sel-menu');await script('resources');await script('chat-kit');
    await check('shell link sheet: outside is one Back step, nested page unwinds before closing',async()=>{
      await page.evaluate(()=>{window.links=WizLinks.mount({parent:document.querySelector('#device')});links.open('/fixture-page/one');links.open('/fixture-page/two');links.el.classList.add('peek');});
      await page.locator('.ls-scrim').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>links.state().depth),1);
      await page.locator('.ls-scrim').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>links.isOpen()),false);await mounted();
    });
    await check('shell link context menu: opening release ignored, outside and Back both close only the menu',async()=>{
      await page.evaluate(()=>{const p=document.createElement('p');p.className='bub';p.innerHTML='<a href="/fixture-page/menu">Fixture link</a>';p.style.cssText='position:absolute;top:100px;left:20px';document.querySelector('#device').append(p);WizLinks.intercept(p,links);});
      await page.locator('.bub a').dispatchEvent('contextmenu',{bubbles:true,clientX:100,clientY:100});
      await page.evaluate(()=>document.querySelector('.wiz-linkmenu button').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1})));
      assert.equal(await page.locator('.wiz-linkmenu').count(),1);await page.locator('#outside').tap();assert.equal(await page.locator('.wiz-linkmenu').count(),0);
      await page.locator('.bub a').dispatchEvent('contextmenu',{bubbles:true});assert.equal(await page.evaluate(()=>WizLinks.backMenu()),true);assert.equal(await page.locator('.wiz-linkmenu').count(),0);await mounted();
    });
    await check('shell home-pin sheet: opening release ignored, fresh outside tap uses Back even while pending',async()=>{
      await page.evaluate(()=>WizHomeScreenApps.offer(appFixture));
      await page.evaluate(()=>document.querySelector('.home-pin-backdrop').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1})));
      assert.equal(await page.evaluate(()=>WizHomeScreenApps.state.open),true);
      await page.evaluate(()=>{
        window.wizardHomeScreenPort={postMessage(raw){const q=JSON.parse(raw);if(q.op==='status')queueMicrotask(()=>this.onmessage({data:JSON.stringify({requestId:q.requestId,status:'ready'})}));else if(q.op==='pin')queueMicrotask(()=>this.onmessage({data:JSON.stringify({requestId:q.requestId,status:'pending'})}));}};
        WizHomeScreenApps.offer(appFixture);
      });
      await page.locator('.home-pin-sheet button').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.home-pin-sheet button').disabled);
      await page.locator('.home-pin-sheet button').tap();assert.equal(await page.evaluate(()=>WizHomeScreenApps.state.pending),true);
      await page.locator('.home-pin-backdrop').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>WizHomeScreenApps.state.open),false);await mounted();
      await page.evaluate(()=>delete window.wizardHomeScreenPort);
    });
    await check('shell share sheet: outside resolves cancelled through Back cleanup',async()=>{
      await page.evaluate(()=>{window.shareResult=null;WosShareSheet.show({text:'Fixture share'},async()=>'unsupported').then(x=>shareResult=x);});
      await page.locator('.wos-share').tap({position:{x:5,y:5}});await page.waitForFunction(()=>shareResult==='cancelled');await mounted();
    });
    await check('shell app-route sheet: outside closes without removing app frame',async()=>{
      await page.evaluate(()=>WosAppRoute.open('notes'));
      await page.locator('.aroute').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>WosAppRoute.back()),false);await mounted();
    });
    await check('shell tour and help: outside uses Back, controls stay available',async()=>{
      await page.evaluate(()=>WosTour.attach({device:document.querySelector('#device'),orbWrap:document.querySelector('#app-frame'),toast(){},prepare(){},dismissVoice(){},closeSheets(){},goHome(){},atHome:()=>true,noMic:()=>true,readyCount:()=>0}));
      await page.evaluate(()=>WosTour.openHelp());await page.locator('.help-sheet').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>WosTour.helpOpen),false);
      await page.evaluate(()=>WosTour.start('test'));await page.locator('#outside').tap();assert.equal(await page.evaluate(()=>WosTour.active),false);await mounted();
    });
    await check('desktop tour card: outside uses its Back finish path',async()=>{
      await page.evaluate(()=>{WosTour.desk.attach({newChat(){},composer:()=>document.querySelector('#words'),toast(){}});WosTour.desk.start('test');});
      assert.equal(await page.evaluate(()=>WosTour.desk.active),true);await page.touchscreen.tap(380,800);assert.equal(await page.evaluate(()=>WosTour.desk.active),false);await mounted();
    });
    await check('shell selection menu: outside clears selection, does not reopen after settle',async()=>{
      await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('#words'));getSelection().removeAllRanges();getSelection().addRange(r);WosSelMenu.show();});
      await page.waitForFunction(()=>WosSelMenu.state.open);await page.locator('#outside').tap();await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>WosSelMenu.state.open),false);assert.equal(await page.evaluate(()=>getSelection().isCollapsed),true);await mounted();
    });
    await check('shell Resources popup: outside runs Back cleanup',async()=>{
      await page.evaluate(()=>{const b=document.createElement('button');b.dataset.resOpen='server';document.querySelector('#device').append(b);b.click();});
      assert.equal(await page.evaluate(()=>WosResources.state.panel),true);await page.locator('.rs-backdrop').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>WosResources.state.panel),false);await mounted();
    });
    await check('shell media viewer: outside photo closes; photo menu release ignored then backdrop closes only menu',async()=>{
      await page.evaluate(()=>WosChat.viewer.open([{kind:'image',url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>',name:'Fixture'}]));
      await page.locator('.mv-stage').dispatchEvent('contextmenu',{bubbles:true});
      await page.evaluate(()=>document.querySelector('.mv-menu').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1})));
      assert.equal(await page.evaluate(()=>WosChat.viewer.state.menu),true);
      await page.locator('.mv-menu').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>WosChat.viewer.state.menu),false);assert.equal(await page.evaluate(()=>WosChat.viewer.isOpen()),true);
      await page.locator('.mv-stage').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>WosChat.viewer.isOpen()),false);await mounted();
    });
    await check('shell Snooze sheet: outside closes without saving',async()=>{
      await script('scheduled-reminders');await page.addStyleTag({url:origin+'/core/scheduled-reminders.css'});
      await page.evaluate(()=>WosBoomerang.open({sessionId:'fixture-thread',title:'Fixture'}));
      await page.locator('.boom-sheet').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>WosBoomerang.isOpen()),false);await mounted();
    });
    await check('shell recorder recovery: outside closes the unknown-owner controls without adopting/discarding take',async()=>{
      await page.evaluate(()=>{
        window.__wos.voice='idle';window.__wos.V={};
        window.__fixtureNative={version:()=>1,recActive:()=>JSON.stringify({id:'fixture-take',ms:1000}),recPending:()=> '[]'};
        window.WizAppCapture={getState:()=>({nativeRegistryReady:true,nativeOwnershipReady:false,nativeDeviceTakeIds:[]})};
      });
      await page.addScriptTag({url:origin+'/device.js'});await page.evaluate(()=>{window.WizardOSDevice=__fixtureNative;WosDevice.recoverRecorder();});
      assert.equal(await page.evaluate(()=>WosDevice._state().sheet),'recorder-controls');
      await page.locator('.dv-scrim').tap({position:{x:5,y:5}});assert.equal(await page.evaluate(()=>WosDevice._state().sheet),null);await mounted();
    });
    await check('hosted Store install layer: outside padding pops one layer and keeps frame mounted',async()=>{
      const [store]=await Promise.all([page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/store/index.html')}),page.evaluate(()=>{const f=document.createElement('iframe');f.id='store-frame';f.src='/store/index.html?view=install&repo=bad';f.style.cssText='position:fixed;inset:0;width:390px;height:844px';document.body.append(f);})]);
      await store.locator('.link-error').waitFor();
      await store.locator('#sheet').tap({position:{x:2,y:2}});
      assert.equal(await store.locator('#discover').isVisible(),true);assert.equal(await page.locator('#store-frame').count(),1);await mounted();
    });
    assert.deepEqual(errors,[],'no browser exceptions');
    console.log(`tap outside closes: ${passed} PASS (390x844 touch; fixture-only, no live shell)`);
    await context.close();
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
