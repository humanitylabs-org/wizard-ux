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
<button id="hold">Hold</button><dialog id="sheet"><button id="action">Action</button><label for="opt">Option</label><input type="checkbox" id="opt"><label id="wrap"><input type="checkbox" id="opt2"> Wrapped</label></dialog>
<script>
window.activated=0;window.cancelled=0;
action.onclick=()=>activated++;
sheet.oncancel=()=>cancelled++;
window.openSheet=()=>{sheet.showModal();window.releaseBack=WizardApp.back.push(()=>{sheet.close();return true;});};
sheet.onclose=()=>releaseBack?.release();
hold.onpointerdown=()=>{window.holdTimer=setTimeout(openSheet,450);};hold.onpointerup=()=>clearTimeout(holdTimer);
</script>`;
const standaloneIds=['notes','wisdom','kit','cover','imported','disabled','late'];
// Synthetic reading documents only: no app API, owner storage or private note bodies.
// QA_NOTES_CSS optionally exercises the exact current Notes layout stylesheet.
const standaloneApp=id=>`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
${['wisdom','cover'].includes(id)?'<meta name="wizard-os-edge" content="cover">':''}
<link rel="stylesheet" href="/kit/wizard-ui.css"><script src="/core/app-client.js"></script>
${id==='notes'?'<link rel="stylesheet" href="/standalone-notes.css">':''}
${id==='imported'?'<link rel="stylesheet" href="/standalone-import.css">':''}
${id==='disabled'?'<style id="unused" media="not all">header{padding-top:var(--wos-cutout)}</style>':''}
<style>html,body{margin:0;height:100%;overflow:hidden}body{background:var(--wz-base,var(--bg,#111));color:var(--ink,#eee)}#main{height:100%;overflow:auto;position:relative;box-sizing:border-box}#canvas-tools{position:sticky;top:0;background:var(--wz-base,var(--bg,#111));z-index:2}p{line-height:28px;margin:12px 24px}#editor{margin:12px 24px;font:inherit}#formatting{position:fixed;bottom:8px;left:12px}body{--keyboard-inset:0px}
${['wisdom','cover','late'].includes(id)?'#canvas-tools{padding-top:calc(var(--wos-cutout,0px) + 12px)}':''}
</style><main id="main"><header id="canvas-tools" class="wz-head"><button id="back">Synthetic controls</button></header><h1 style="margin:16px 24px">Synthetic ${id} reading fixture</h1>
<input id="editor" aria-label="Fixture editor" value="Synthetic editable text">
${Array.from({length:100},(_,i)=>`<p data-line="${i}">Fixture paragraph ${i}: scroll to test the protected status area.</p>`).join('')}</main><button id="formatting">Aa</button>
<script>if(document.getElementById('unused'))document.getElementById('unused').sheet.disabled=true;window.fixtureReady=true;WizardApp.ready({title:'Fixture',back:()=>false});</script>`;
const standaloneHost=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/core/base.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/core/skins.css"><link rel="stylesheet" data-skin-pkg="obsidian" href="/skins/obsidian/skin.css"><link rel="stylesheet" href="/core/links.css"><link rel="stylesheet" href="/core/update-banner.css"><link rel="stylesheet" href="/core/home-screen-apps.css">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#nativeStatus{position:fixed;inset:0 0 auto;height:var(--single-cut,0px);z-index:2147483647;pointer-events:none;box-sizing:border-box;padding:2px 18px;font:12px system-ui;color:var(--ink);background:var(--bg)}#singleApp{transition:none}</style>
<div id="device" class="device"><div id="toast" class="toast"></div></div><div id="nativeStatus">09:41 · synthetic Android status bar</div>
<script>
const q=new URLSearchParams(location.search),id=q.get('app-session'),list=${JSON.stringify(standaloneIds)}.map(id=>({id,name:id,kind:'wizard',url:'/standalone-app/'+id+'/'}));
document.documentElement.dataset.appSession=id;document.documentElement.dataset.skin=q.get('skin')||'nebula';document.documentElement.dataset.shell='phone';
document.getElementById('nativeStatus').style.height=Math.max(Number(q.get('top')||0),Number(q.get('cut')||0))+'px';
window.nativeCalls=[];window.WizardOSNative={immersive:v=>nativeCalls.push(v),insetTop:()=>Number(q.get('top')||0),cutoutTop:()=>Number(q.get('cut')||0)};
window.WizCore={apps:()=>({APPS:list,APP:Object.fromEntries(list.map(a=>[a.id,a]))}),appsLoaded:()=>q.has('delayed')?new Promise(r=>window.releaseApps=r):Promise.resolve(),esc:s=>String(s)};
</script><script src="/core/skins.js"></script><script>WosSkin.set(q.get('skin')||'nebula');</script><script src="/core/home-screen-policy.js"></script><script src="/core/appearance-host.js"></script><script src="/core/app-services.js"></script><script src="/core/links.js"></script><script src="/core/single-app-session.js"></script>`;
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS', name); }
(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    await context.route('**/*', async route => {
      const u = new URL(route.request().url());
      assert.equal(u.origin, origin, 'test must not contact another origin');
      if (u.pathname === '/core/single-app-session.js' && process.env.QA_SINGLE_APP_SOURCE) return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.QA_SINGLE_APP_SOURCE)});
      if (u.pathname === '/standalone-host') return route.fulfill({contentType:'text/html',body:standaloneHost});
      if (u.pathname.startsWith('/standalone-app/')) return route.fulfill({contentType:'text/html',body:standaloneApp(u.pathname.split('/')[2])});
      if (u.pathname === '/standalone-notes.css') return route.fulfill({contentType:'text/css',body:process.env.QA_NOTES_CSS?fs.readFileSync(process.env.QA_NOTES_CSS,'utf8'):'#canvas-tools{padding-top:calc(var(--wos-cutout,0px) + 12px)}'});
      if (u.pathname === '/standalone-import.css') return route.fulfill({contentType:'text/css',body:'@import "/standalone-inner.css";'});
      if (u.pathname === '/standalone-inner.css') return route.fulfill({contentType:'text/css',body:'@import "/standalone-leaf.css";'});
      if (u.pathname === '/standalone-leaf.css') return route.fulfill({contentType:'text/css',body:'#canvas-tools{padding-top:calc(var(--wos-cutout,0px) + 12px)}'});
      if(u.pathname==='/store-install/fixture'){storeInstalled=true;return route.fulfill({json:{state:'installed',selection:route.request().postDataJSON()}});}
      if(u.pathname.startsWith('/store-data/')) {
        const j=u.pathname.includes('/index/search')?{apps:[storeApp]}:u.pathname.includes('/installed-apps')?{complete:true,wam:storeInstalled?[storeApp]:[],shell:[]}:u.pathname.endsWith('/installed')?{installed:[]}:u.pathname.includes('/needs/')?{models:[{feature:'fixture-model',tier:'simple',status:'missing'}],services:[]}:{};
        return route.fulfill({json:j});
      }
      if (u.pathname === '/fixture') return route.fulfill({contentType:'text/html',body:shell});
      if (u.pathname === '/fixture-app') return route.fulfill({contentType:'text/html',body:app});
      if (u.pathname.startsWith('/fixture-page')) return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture page</title><p>Page</p>'});
      const file = path.resolve(web, '.' + u.pathname.replace(/^\/wizard-os-home\//,'/'));
      if (file.startsWith(web + '/') && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'image/png'});
      return route.fulfill({contentType:'application/json',body:'{}'});
    });
    const storeApp={id:'fixture',name:'Fixture',type:'view',repo:'example/fixture',source:'standard',channel:'standard',commit:'a'.repeat(40)};let storeInstalled=false;
    const page=await context.newPage();
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
    await check('hosted dialog: <label for> and wrapping labels still toggle their controls',async()=>{
      await open();await frame.locator('label[for=opt]').tap();assert.equal(await frame.evaluate(()=>opt.checked),true,'label for= toggles');
      await frame.locator('#wrap').tap();assert.equal(await frame.evaluate(()=>opt2.checked),true,'wrapping label toggles');
      await frame.locator('label[for=opt]').click();assert.equal(await frame.evaluate(()=>opt.checked),false,'mouse click on label toggles back');
      assert.equal(await isOpen(),true);await frame.evaluate(()=>sheet.close());
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
      await page.locator('.ls-scrim').tap({position:{x:190,y:20}});assert.equal(await page.evaluate(()=>links.state().depth),1);
      await page.locator('.ls-scrim').tap({position:{x:190,y:20}});assert.equal(await page.evaluate(()=>links.isOpen()),false);await mounted();
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
      const [store]=await Promise.all([page.waitForEvent('framenavigated',{predicate:f=>f.url().includes('/store/index.html')}),page.evaluate(()=>{const f=document.createElement('iframe');f.id='store-frame';f.src='/store/index.html?app=fixture';f.style.cssText='position:fixed;inset:0;width:390px;height:844px';document.body.append(f);})]);
      await store.locator('[data-get]').tap();
      await store.waitForFunction(()=>window.__store?.state().layers.at(-1)==='sheet');
      await store.locator('#sheet').tap({position:{x:2,y:2}});
      assert.deepEqual(await store.evaluate(()=>__store.state().layers),['detail']);assert.equal(await page.locator('#store-frame').count(),1);await mounted();
    });
    // Universal standalone status-bar rule: execute the real container, services,
    // SDK and CSS against synthetic long reading documents (no owner app APIs).
    const pinned=await context.newPage(),metrics=[];
    pinned.on('pageerror',e=>errors.push(e.message));
    const waitPinned=async()=>{
      await pinned.waitForFunction(()=>{const f=document.querySelector('#singleApp iframe');return f?.contentWindow?.fixtureReady&&f.contentDocument.readyState==='complete';});
      return (await pinned.locator('#singleApp iframe').elementHandle()).contentFrame();
    };
    const protectedFrame=async(edge,label)=>{
      const state=await pinned.evaluate(()=>{
        const f=document.querySelector('#singleApp iframe'),d=f.contentDocument,r=f.getBoundingClientRect(),t=d.querySelector('#canvas-tools').getBoundingClientRect();
        return {y:r.top,h:r.height,hostH:innerHeight,cut:getComputedStyle(d.documentElement).getPropertyValue('--wos-cutout').trim(),toolbar:r.top+t.top,scroll:d.querySelector('#main').scrollTop,hostScroll:scrollY,covering:document.elementFromPoint(180,Math.max(0,r.top/2))===f,nativeCalls};
      });
      if(state.y!==edge&&process.env.QA_OUTPUT) {fs.mkdirSync(process.env.QA_OUTPUT,{recursive:true});await pinned.screenshot({path:path.join(process.env.QA_OUTPUT,'standalone-regression-before.png')});}
      assert.equal(state.y,edge,label+' frame top = max(native,cutout), exactly once');
      assert.equal(state.h,state.hostH-edge,label+' full remaining viewport');
      assert.equal(state.cut,'0px',label+' child does not add another gap');
      assert.ok(state.toolbar>=edge,label+' sticky controls stay protected');
      assert.equal(state.hostScroll,0,label+' only app scrolls');
      if(edge)assert.equal(state.covering,false,label+' iframe is clipped out of status region');
      assert.deepEqual(state.nativeCalls,[false]);metrics.push({label,edge,...state});
    };
    for(const id of standaloneIds)for(const [top,cut] of [0,36,48].flatMap(top=>[0,36,48].map(cut=>[top,cut]))) {
      await check(`James universal standalone rule: ${id}, status ${top}/cutout ${cut}, scroll 0 + deep`,async()=>{
        await pinned.goto(origin+`/standalone-host?app-session=${id}&top=${top}&cut=${cut}`);
        const f=await waitPinned(),edge=Math.max(top,cut);await protectedFrame(edge,id+' top');
        await f.evaluate(()=>main.scrollTop=1500);await protectedFrame(edge,id+' deep');assert.ok(await f.evaluate(()=>main.scrollTop)>1000);
        if(id==='late') {
          await f.addStyleTag({content:':root{--wos-cutout:96px!important} #canvas-tools{padding-top:calc(var(--wos-cutout) + 12px)}'});
          await protectedFrame(edge,'late stylesheet');
        }
      });
    }
    for(const skin of ['nebula','obsidian-light'])for(const id of ['notes','wisdom']) {
      await check(`James universal standalone rule: ${id} ${skin} top/deep screenshots and shell overlays`,async()=>{
        await pinned.goto(origin+`/standalone-host?app-session=${id}&top=36&cut=48&skin=${skin}`);const f=await waitPinned();
        await f.waitForFunction(()=>WizardApp.theme.get()?.skin===new URL(parent.location.href).searchParams.get('skin'));
        for(const scroll of [0,1500]) {
          await f.evaluate(y=>main.scrollTop=y,scroll);await protectedFrame(48,`${skin} ${id} scroll ${scroll}`);
          if(process.env.QA_OUTPUT) {fs.mkdirSync(process.env.QA_OUTPUT,{recursive:true});await pinned.screenshot({path:path.join(process.env.QA_OUTPUT,`standalone-${skin}-${id}-${scroll}.png`)});}
        }
        await pinned.evaluate(()=>{const p=document.createElement('div');p.className='app-upd';p.textContent='Fixture app updated · Reload';singleApp.append(p);__wos.toast('Fixture toast');});
        await pinned.waitForFunction(()=>Math.abs(document.querySelector('#singleApp .app-upd').getBoundingClientRect().top-56)<.01&&Math.abs(document.getElementById('toast').getBoundingClientRect().top-60)<.01);
        const update=await pinned.locator('#singleApp .app-upd').boundingBox(),toast=await pinned.locator('#toast').boundingBox();
        assert.ok(Math.abs(update.y-56)<.1,'update uses host union once');assert.ok(Math.abs(toast.y-60)<.1,'toast uses union once');
        await pinned.evaluate(()=>__wos.links.open('/fixture-page'));
        await pinned.locator('.linksheet.open .ls-panel').waitFor({state:'visible'});
        await pinned.waitForFunction(()=>{const r=document.querySelector('.linksheet .ls-panel').getBoundingClientRect();return Math.abs(r.top-54)<.01;});
        assert.ok(Math.abs(await pinned.evaluate(()=>document.querySelector('.linksheet .ls-panel').getBoundingClientRect().top)-54)<.1,'body-mounted sheet clears status plus its 6px lip, not a second inset');
        await pinned.evaluate(()=>__wos.links.close());
        await pinned.evaluate(()=>{window.fixturePane=WizLinks.mount({parent:document.body,mode:'pane'});fixturePane.open('/fixture-page');});
        await pinned.waitForFunction(()=>Math.abs(document.querySelector('.linksheet.pane .ls-panel').getBoundingClientRect().top-48)<1);
        await pinned.evaluate(()=>fixturePane.close());
        if(process.env.QA_OUTPUT)await pinned.screenshot({path:path.join(process.env.QA_OUTPUT,`standalone-${skin}-${id}-notices.png`)});
      });
    }
    await check('James universal standalone rule: callbacks before mount, reload and focused editor keep one inset',async()=>{
      await pinned.goto(origin+'/standalone-host?app-session=notes&top=0&cut=0&delayed=1');
      await pinned.waitForFunction(()=>!!window.__wosTop&&!!window.releaseApps);
      await pinned.evaluate(()=>{__wosTop(36);__wosCutout(48);releaseApps();});let f=await waitPinned();await protectedFrame(48,'callback before mount');
      await f.locator('#editor').focus();await pinned.keyboard.type(' edited');
      await pinned.evaluate(()=>__wosTop(48));assert.equal(await f.evaluate(()=>document.activeElement.id),'editor','no remount/focus loss');
      await pinned.setViewportSize({width:390,height:520});await protectedFrame(48,'keyboard-size viewport');
      await pinned.setViewportSize({width:390,height:844});
      await pinned.evaluate(()=>{__wosTop(0);__wosCutout(0);});await protectedFrame(0,'bars reported zero');
      await pinned.goto(origin+'/standalone-host?app-session=notes&top=36&cut=48');f=await waitPinned();await pinned.reload();f=await waitPinned();await protectedFrame(48,'reload');
      await f.evaluate(()=>main.scrollTop=1500);await pinned.evaluate(()=>__wosCutout(36));await protectedFrame(36,'callback after deep scroll');
      assert.ok(await f.evaluate(()=>main.scrollTop)>1000,'callback preserves scroll');
      assert.equal(await pinned.evaluate(()=>__wosNativeBack()),'root','root Back stays inside pinned app');
    });
    if(process.env.QA_OUTPUT)fs.writeFileSync(path.join(process.env.QA_OUTPUT,'standalone-metrics.json'),JSON.stringify(metrics,null,2));
    await pinned.close();
    assert.deepEqual(errors,[],'no browser exceptions');
    console.log(`tap outside closes: ${passed} PASS (390x844 touch; fixture-only, no live shell)`);
    await context.close();
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
