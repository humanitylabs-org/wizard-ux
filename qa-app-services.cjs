// Shared host/client QA. Run ONLY on Thales under the shared heavy-worker lock.
// Local fixture server, real shell/client scripts; no production requests, no agent writes.
// Capture is an explicit contract mock here; capture's own durability tests belong to its slice.
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), assert = require('assert/strict');
const { chromium } = require('./tools/qa-playwright.cjs');
const ROOT = process.env.QA_WEB_DIR || __dirname, OUT = process.env.QA_OUT || path.join(ROOT, 'evidence/shared-services');
fs.mkdirSync(OUT, { recursive: true });
const entries = [
 ['wizard-signal','/wizard-signal/'],['wizard-search','/wizard-search/'],['wisdom','/wisdom/'],['meditation','/meditation/'],['wizard-music','/wizard-music/'],['shopping','/wizard-shopping/'],['mizel','/mizel-live/'],['topics','/wizard-topics-preview/'],['projects','/wizard-projects/'],['calendar','/wizard-calendar/'],['trackhunt','/trackhunt/'],['cinequeue','/cinequeue/'],['social','/wizard-social/'],['files','/files/'],['iching','/iching/'],['console','/console/'],['android-apps','/android-apps/'],
];
const apps = entries.map(([id,url]) => ({ id,url,name:id,colors:['#777777','#888888'] }));
const captureMock = `(() => {let active=null, pending=[],failStop=false;window._qaCapture={failNextStop:()=>{failStop=true},finish:()=>active?.session.stop()};window.WizAppCapture={getState:()=>({active:!!active,appId:active?.appId}),async start(appId,opts){if(active)throw new Error('busy:'+active.appId);active={appId};let s={id:'qa-capture',onLevel(fn){fn(.5);return()=>{}},async stop(){if(failStop){failStop=false;throw new Error('fixture-stop-retry')}active=null;const r={id:s.id,blob:new Blob(['fixture']),mime:'audio/webm',durationMs:1,startedAt:Date.now(),meta:opts?.meta};pending.push({...r,appId});dispatchEvent(new CustomEvent('wizard-app-capture-state'));return r},async cancel(){active=null;dispatchEvent(new CustomEvent('wizard-app-capture-state'))}};active.session=s;return s},async pending(appId){return pending.filter(p=>p.appId===appId)},async ack(appId,id){pending=pending.filter(p=>p.appId!==appId||p.id!==id)}}})();`;
function appHTML(id) { return `<!doctype html><html data-app="${id}"><meta name="viewport" content="width=device-width"><title>${id} fixture</title><body><h1>${id}</h1><input id="draft" value="unsaved fixture"><button id="open">Nested</button><button id="close">Close</button><button id="share">Share</button><output id="state">0</output><script src="/wizard-os-home/core/app-client.js"></script><script>
window.depth=0;window.calls=0;window.unreg=WizardApp.back.register({canGoBack:()=>depth>0,back:()=>{calls++;if(!depth)return false;depth--;paint();return true}});
function paint(){document.querySelector('#state').textContent=depth}function nested(){depth++;paint()}
document.querySelector('#open').onclick=nested;document.querySelector('#close').onclick=()=>{if(depth){calls++;depth--;paint()}};
document.querySelector('#share').onclick=()=>{window.sharePromise=WizardApp.share.text({title:'Fixture title',text:'fixture text',url:'https://example.org/exact?q=a#b'})};
</script></body></html>`; }
let version = 'abc0001', requests = [], writes = [];
const server = http.createServer((req,res) => {
 requests.push(req.url); const u = new URL(req.url,'http://localhost');
 const send = (body,ct='text/html',status=200) => {res.writeHead(status,{'Content-Type':ct});res.end(body)};
 if (!['GET','HEAD'].includes(req.method)) { writes.push({method:req.method,url:req.url}); return send('{}','application/json',405); }
 if (u.pathname.endsWith('/ux-version.txt')) return send(version,'text/plain');
 if (u.pathname.endsWith('/ux-changes.json')) return send('[]','application/json');
 if (u.pathname === '/wizard/v1/apps') return send(JSON.stringify({apps}),'application/json');
 if (u.pathname === '/wizard/v1/bootstrap') return send(JSON.stringify({bootstrap:1,endpoints:{apps:'/wizard/v1/apps'},settings:{agent:{name:'Fixture Wizard'}},capabilities:{}}),'application/json');
 if (u.pathname === '/wizard/hermes/api/sessions') return send(JSON.stringify({data:[],has_more:false}),'application/json');
 if (u.pathname.endsWith('/thread-seen')) return send(JSON.stringify({state:{initializedAt:Date.now(),threads:{}}}),'application/json');
 if (u.pathname.endsWith('/thread-dispositions')) return send(JSON.stringify({state:{}}),'application/json');
 if (u.pathname.startsWith('/wizard/')) return send('{}','application/json');
 if (u.pathname === '/sw.js' || u.pathname.endsWith('/sw.js')) return send("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));",'application/javascript');
 if (u.pathname === '/wizard-os-home/core/app-capture.js') return send(captureMock,'application/javascript');
 if (u.pathname === '/harness/') return send('<!doctype html><html><body><div class="win"><iframe id="frame" src="/wizard-signal/"></iframe></div><script src="/wizard-os-home/core/core.js"></script><script src="/wizard-os-home/core/config.js"></script><script src="/wizard-os-home/core/apps.js"></script><script src="/wizard-os-home/core/appearance-host.js"></script><script src="/wizard-os-home/core/chat-kit.js"></script><script src="/wizard-os-home/core/app-capture.js"></script><script src="/wizard-os-home/core/app-services.js"></script><script>WizCore.appsLoaded().then(()=>WizAppServices.attach(document.querySelector("iframe"),{appId:"wizard-signal",path:"/wizard-signal/"}));</script></body></html>');
 const app = entries.find(([,p])=>u.pathname.startsWith(p)); if (app) return send(appHTML(app[0]));
 if (u.pathname === '/rogue/') return send(appHTML('rogue'));
 if (u.pathname.startsWith('/wizard-os-home/')) {
  const file = u.pathname.slice('/wizard-os-home/'.length) || 'index.html';
  const p = path.resolve(ROOT,'web',file); if (!p.startsWith(path.resolve(ROOT,'web')+path.sep)) return send('', 'text/plain',403);
  if (file === 'data.js' || file === 'summaries.js') return send('', 'application/javascript');
  if (!fs.existsSync(p)) return send('', 'text/plain',404);
  return send(fs.readFileSync(p),file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
 }
 send('', 'text/plain',404);
});
const receipt = { hostname:os.hostname(), source:process.env.QA_SHA, tree:process.env.QA_TREE, tests:[], limitations:['capture is a contract mock; not capture durability/permission QA','app documents are registered-path fixtures, not the independent app migrations','native bridge is mocked; void bridge cannot confirm chooser outcome','off-origin privileged services intentionally fail closed'], blockedExternal:[] };
function ok(name, condition, detail) { receipt.tests.push({name,pass:!!condition,...(detail===undefined?{}:{detail})}); console.log(condition?'PASS':'FAIL',name, detail===undefined?'':JSON.stringify(detail)); assert.ok(condition,name); }
async function context(b, mobile) {
 const ctx = await b.newContext({viewport:mobile?{width:412,height:892}:{width:1440,height:1000},hasTouch:!!mobile,isMobile:!!mobile});
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==origin){receipt.blockedExternal.push(u.href);return r.abort();}return r.continue()});
 await ctx.addInitScript(() => {
  if (window!==parent) return;
  localStorage.setItem('wos.coached','true');localStorage.setItem('wos.shell','mobile');
  window.nativeCalls=[];window.nativeActivations=[];window.nativeOutcome='shared';
  window.WizardOSNative={platform:()=> 'android:fixture',unsent:()=> '[]',everywhere:()=> '{}',appUnsent(){},haptic(){},keepAwake(){},shareText(...a){nativeActivations.push(navigator.userActivation.isActive);nativeCalls.push(['text',...a]);return window.nativeOutcome},shareFile(...a){nativeCalls.push(['file',...a]);return window.nativeOutcome}};
 });
 return ctx;
}
let origin;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const b=await chromium.launch({headless:true});
 try {
  for (const mobile of [true,false]) {
   const ctx=await context(b,mobile),p=await ctx.newPage(),errs=[];p.on('pageerror',e=>errs.push(String(e)));
   await p.goto(origin+'/wizard-os-home/'+(mobile?'?shell=phone':'desktop.html?shell=desktop'));
   await p.waitForFunction(m=>m?!!window.__wos:!!window.__wux,mobile);
   await p.evaluate(()=>WizCore.appsLoaded());
   const frames=[];ok('fixture registry has all approved app IDs',await p.evaluate(m=>WizCore.apps(m?'mobile':'desktop').APPS.filter(a=>a.url&&!['app-store','system'].includes(a.id)).length===17,mobile));
   for (const [id,url] of entries) {
    await p.evaluate(({id,mobile})=>{const a=WizCore.apps(mobile?'mobile':'desktop').APP[id];(mobile?__wos:__wux).openApp(a)},{id,mobile});
    const fr=await waitFrame(p,origin+url);frames.push(fr);
    await fr.waitForFunction(()=>WizardApp.hosted);
    await fr.locator('#open').click();await fr.locator('#open').click();
    const r=await p.evaluate(m=>m?__wosNativeBack():__wux.escStep(),mobile);
    await p.waitForTimeout(280);
    ok((mobile?'phone':'desktop')+' '+id+' nested Back exactly once / stays open',await fr.evaluate(()=>depth===1&&calls===1&&WizardApp.hosted),r);
    await fr.locator('#close').click();ok(id+' on-screen close parity',await fr.evaluate(()=>depth===0&&calls===2));
    const root=await p.evaluate(m=>m?__wosNativeBack():__wux.escStep(),mobile);
    await p.waitForTimeout(250);ok(id+' root stays open',await fr.evaluate(()=>depth===0&&calls===2),root);
    if (id!==entries.at(-1)[0]) await p.evaluate(({id,mobile})=>{const shell=mobile?__wos:__wux;const w=Object.values(shell.wins).find(w=>w.appId===id);shell.closeWin(w.id)},{id,mobile});
   }
   // Root Back returns to shell home; reopen the last fixture before gesture/share acceptance.
   const [lastId,lastUrl]=entries.at(-1);
   await p.evaluate(({id,mobile})=>{const a=WizCore.apps(mobile?'mobile':'desktop').APP[id];(mobile?__wos:__wux).openApp(a)},{id:lastId,mobile});
   const fr=await waitFrame(p,origin+lastUrl);await fr.waitForFunction(()=>WizardApp.hosted);
   await fr.locator('#open').click();
   await p.evaluate(()=>{document.documentElement.style.setProperty('--bg','#eeeeee');document.documentElement.style.setProperty('--ink','#111111');document.documentElement.style.colorScheme='light';WizAppearance.sync()});
   await fr.waitForFunction(()=>WizardApp.theme.get()?.colorScheme==='light');
   ok((mobile?'phone':'desktop')+' Appearance v1 preserves route/draft',await fr.evaluate(()=>depth===1&&document.querySelector('#draft').value==='unsaved fixture'&&document.documentElement.style.getPropertyValue('--wz-text')==='#111111'));
   await fr.locator('#share').click();ok('native receipt share immediate from gesture',await fr.evaluate(()=>sharePromise)==='shared');
   ok('ancestor transient activation retained for share',await p.evaluate(()=>nativeActivations.at(-1)));
   ok('native share preserves URL and title',await p.evaluate(()=>nativeCalls.at(-1)[1]==='fixture text\nhttps://example.org/exact?q=a#b'&&nativeCalls.at(-1)[2]==='Fixture title'));
   ok('relative share URL resolves against the app, not the shell',await fr.evaluate(()=>WizardApp.share.text({url:'item?q=a#b'}))==='shared'&&await p.evaluate(()=>nativeCalls.at(-1)[1]===location.origin+'/android-apps/item?q=a#b'));
   await p.evaluate(()=>nativeOutcome='cancelled');await fr.locator('#share').click();ok('native receipt cancellation not success',await fr.evaluate(()=>sharePromise)==='cancelled');
   await p.evaluate(()=>nativeOutcome=undefined);await fr.locator('#share').click();ok('void native transport does not invent success',await fr.evaluate(()=>sharePromise)==='unsupported');
   await p.evaluate(()=>nativeOutcome=Promise.resolve({status:'shared'}));
   const fileResult=await fr.evaluate(()=>WizardApp.share.file(new File(['exact bytes'],'test.txt',{type:'text/plain'}),{title:'file'}));
   ok('file shares cross-realm File via native bytes/name/mime',fileResult==='shared'&&await p.evaluate(()=>{const a=nativeCalls.at(-1);return a[0]==='file'&&atob(a[1])==='exact bytes'&&a[2]==='test.txt'&&a[3]==='text/plain'}));
   await fr.evaluate(()=>window.hold=WizardApp.update.hold('Unsaved fixture'));
   ok('app update hold makes shell busy',await p.evaluate(()=>WizAppServices.update.busy()));
   await p.evaluate(()=>WizAppServices.update.announce({version:'fixture-update'}));
   await fr.waitForFunction(()=>{let seen=false;WizardApp.update.onAvailable(x=>{seen=x.version==='fixture-update'});return seen});
   ok('availability delivery without route reload',await fr.evaluate(()=>depth===1));
   await fr.evaluate(()=>hold.release());ok('explicit release reconciles holds',!await p.evaluate(()=>WizAppServices.update.busy()));
   ok('apps cannot impersonate legacy Wizard voice native kinds',await fr.evaluate(()=>WizardApp.capture.start({kind:'auto'}).then(()=>false,()=>true))&&!await p.evaluate(()=>WizAppCapture.getState().active));
   await fr.evaluate(()=>WizardApp.capture.start({kind:'audio',meta:{fixture:true}}).then(s=>window.session=s));
   ok('capture session automatically holds update',await p.evaluate(()=>WizAppServices.update.busy()));
   await p.evaluate(m=>m?__wosNativeBack():__wux.escStep(),mobile);
   ok('Back does not cancel recording',await p.evaluate(()=>WizAppCapture.getState().active));
   await p.evaluate(async m=>{if(m)await __wos.startVoice('auto');else await __wux.talk('start')},mobile);
   ok('existing shell voice cannot acquire second microphone',await p.evaluate(m=>(m?__wos:__wux).voice==='idle',mobile));
   await fr.evaluate(()=>session.stop());ok('stop releases capture hold',!await p.evaluate(()=>WizAppServices.update.busy()));
   ok('pending/ack delegated by registered appId',await fr.evaluate(async()=>{const r=await WizardApp.capture.pending();await WizardApp.capture.ack(r[0].id);return r.length===1&&(await WizardApp.capture.pending()).length===0}));
   await fr.evaluate(()=>WizardApp.capture.start({kind:'audio'}).then(s=>window.session=s));
   await p.evaluate(()=>_qaCapture.failNextStop());
   ok('failed Stop keeps active recording hold',await fr.evaluate(()=>session.stop().then(()=>false,()=>true))&&await p.evaluate(()=>WizAppServices.update.busy()));
   await fr.evaluate(()=>session.stop());ok('failed Stop is retryable',!await p.evaluate(()=>WizAppServices.update.busy()));
   await fr.evaluate(()=>WizardApp.capture.start({kind:'audio'}).then(s=>window.session=s));
   await p.evaluate(()=>_qaCapture.finish());
   ok('automatic physical stop releases recording hold without an elapsed-time guess',!await p.evaluate(()=>WizAppServices.update.busy()));
   // Real update UI: neither visibility nor explicit Reload bypasses a hold.
   await (mobile?p.evaluate(()=>WosDevice.checkWeb(true)):p.evaluate(()=>WizAppUpdates.check()));
   await fr.evaluate(()=>window.hold=WizardApp.update.hold('Unsaved fixture'));version='abc0002';
   await (mobile?p.evaluate(()=>WosDevice.checkWeb(true)):p.evaluate(()=>WizAppUpdates.check()));
   const button=p.locator(mobile?'#dvWeb [data-web="go"]':'#dvWeb [data-web="go"]');await button.click({force:true});
   ok('explicit Reload blocked while held',await fr.evaluate(()=>WizardApp.hosted&&hold!=null));
   await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await p.waitForTimeout(300);
   ok('background visibility never forces unsaved reload',await fr.evaluate(()=>document.querySelector('#draft').value==='unsaved fixture'));
   await fr.evaluate(()=>hold.release());
   if (!mobile) await p.evaluate(()=>{window.WizardOSNative=null;window.webkit={messageHandlers:{wizardNative:{postMessage(){}}}};});
   await p.goBack({waitUntil:'domcontentloaded'});await p.waitForTimeout(100);
   ok((mobile?'phone':'desktop')+' browser Back keeps root app and shell open',p.url().startsWith(origin+'/wizard-os-home/')&&await fr.evaluate(()=>WizardApp.hosted));
   if (!mobile) {
     await p.goBack({waitUntil:'domcontentloaded'});await p.waitForTimeout(100);
     ok('Mac native bridge root consumes repeated browser Back without exit warning',p.url().startsWith(origin+'/wizard-os-home/')&&await fr.evaluate(()=>WizardApp.hosted)&&await p.evaluate(()=>!document.querySelector('#toast')?.textContent.includes('Press back again to exit')));
   }
   ok((mobile?'phone':'desktop')+' no page errors',!errs.length,errs);
   await p.screenshot({path:path.join(OUT,mobile?'phone.png':'desktop.png')});await ctx.close();version='abc0001';
  }
  // Isolated host verifies privilege and lifecycle boundaries, no shell special cases.
  const ctx=await context(b,false),p=await ctx.newPage();await p.goto(origin+'/harness/');const fr=await waitFrame(p,origin+'/wizard-signal/');await fr.waitForFunction(()=>WizardApp.hosted);
  ok('host ready version negotiation',await fr.evaluate(async()=>{const x=await WizardApp.ready({name:'fixture',version:'1'});return x.version===1&&x.hosted&&WizardApp.version===1}));
  await p.evaluate(()=>{window.viewerNotices=[];WosChat.K.notify=(...args)=>viewerNotices.push(args);nativeCalls=[];nativeOutcome=undefined;WosChat.viewer.open([{url:'data:text/plain;base64,ZXhhY3Q=',name:'fixture.txt',mime:'text/plain',kind:'file'}])});
  await p.locator('.mviewer [data-mv="share"]').click({force:true});await p.waitForFunction(()=>viewerNotices.length);
  ok('legacy void file bridge opens exactly one chooser and never claims Shared',await p.evaluate(()=>nativeCalls.length===1&&nativeCalls[0][0]==='file'&&viewerNotices[0][1]==='Sharing unavailable or not confirmed'));
  await p.evaluate(()=>{viewerNotices=[];nativeCalls=[];nativeOutcome='cancelled'});await p.locator('.mviewer [data-mv="share"]').click({force:true});await p.waitForTimeout(100);
  ok('file viewer cancellation has no false success toast',await p.evaluate(()=>nativeCalls.length===1&&!viewerNotices.length));
  await p.evaluate(()=>{WosChat.viewer.close();nativeOutcome='shared'});
  ok('allowlisted message share has source-verified outcome receipt',await fr.evaluate(()=>new Promise(resolve=>{const id='qa-message-share';setTimeout(()=>resolve('timeout'),2500);const listener=e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.type==='wizard:app:reply'&&e.data.id===id){removeEventListener('message',listener);resolve(e.data.value)}};addEventListener('message',listener);parent.postMessage({type:'wizard:app:request',version:1,id,op:'share.text',args:{text:'message fixture'}},location.origin)}))==='shared');
  await p.evaluate(()=>{nativeOutcome=new Promise(()=>{});});
  ok('native pending Promise bounded to unsupported',await fr.evaluate(()=>WizardApp.share.text({text:'timeout fixture'}))==='unsupported');
  await p.evaluate(()=>nativeOutcome='shared');
  await fr.evaluate(()=>{window.one=WizardApp.back.push(()=>{window.order=(window.order||[]).concat(1)});window.two=WizardApp.back.push(()=>{window.order=(window.order||[]).concat(2)})});
  await p.evaluate(()=>WizAppServices.back(document.querySelector('#frame')));await p.evaluate(()=>WizAppServices.back(document.querySelector('#frame')));
  ok('overlay callbacks LIFO',await fr.evaluate(()=>JSON.stringify(order)==='[2,1]'));
  await fr.evaluate(()=>{unreg();window.historyOff=WizardApp.back.useHistory({isRoot:()=>!location.hash});history.pushState({fixture:true},'', '#nested')});
  ok('history adapter uses one real app entry',await p.evaluate(()=>WizAppServices.back(document.querySelector('#frame')))==='handled');
  await fr.waitForFunction(()=>!location.hash);
  ok('history adapter root is synchronous atRoot',await p.evaluate(()=>WizAppServices.back(document.querySelector('#frame')))==='atRoot');
  await fr.evaluate(()=>historyOff());
  await fr.evaluate(()=>{window.h=WizardApp.update.hold('lifecycle');window.saved=parent.WizAppServices.connect(window,{back:()=>false})});
  await p.evaluate(()=>{const rogue=document.createElement('iframe');rogue.id='rogue';rogue.src='/rogue/';document.body.append(rogue)});const rogue=await waitFrame(p,origin+'/rogue/');
  ok('unregistered source denied',await rogue.evaluate(()=>parent.WizAppServices.connect(window,{back:()=>false})===null));
  await fr.evaluate(()=>WizardApp.update.onAvailable(x=>window.incomingUpdate=x));
  await rogue.evaluate(()=>parent.document.querySelector('#frame').contentWindow.postMessage({type:'wizard:app:update',version:1,available:{version:'rogue'}},location.origin));
  await p.waitForTimeout(100);ok('client ignores sibling-window host impersonation',await fr.evaluate(()=>!window.incomingUpdate));
  const denied=await fr.evaluate(()=>{const f=parent.document.querySelector('#frame');f.setAttribute('src','/rogue/');try{saved.share.text({text:'denied'});return false}catch(e){return true}});ok('src/path changed immediately denies old capability',denied);
  await p.waitForFunction(()=>!WizAppServices.update.busy());ok('navigation reconciles old document holds',!await p.evaluate(()=>WizAppServices.update.busy()));
  await p.evaluate(()=>{const f=document.querySelector('#frame');f.src='/wizard-signal/'});const fr2=await waitFrame(p,origin+'/wizard-signal/');await fr2.waitForFunction(()=>WizardApp.hosted);
  await fr2.evaluate(()=>WizardApp.capture.start({kind:'audio'}));await p.evaluate(()=>document.querySelector('#frame').remove());
  ok('removed frame never cancels capture or bypasses recording busy guard',await p.evaluate(()=>WizAppCapture.getState().active&&WizAppServices.update.busy()));
  await p.evaluate(()=>_qaCapture.finish());
  ok('removed frame releases lifecycle holds',!await p.evaluate(()=>WizAppServices.update.busy()));
  // Real browser SW/cache storage: exact reviewed app targets only, never the root or shell.
  await p.evaluate(async()=>{
    for (const [script,scope] of [['/sw.js','/'],['/wizard-os-home/sw.js','/wizard-os-home/'],['/unrelated/sw.js','/unrelated/'],['/trackhunt/sw.js','/trackhunt/']]) {
      const reg=await navigator.serviceWorker.register(script,{scope});
      if (!reg.active) await new Promise(resolve=>{const w=reg.installing||reg.waiting;if(!w)return resolve();w.addEventListener('statechange',()=>{if(w.state==='activated')resolve()})});
    }
    for (const name of ['root-shell-cache','trackhunt-v1-20260711d','trackhunt-v1-20260711d-extra']) await caches.open(name);
    const f=document.createElement('iframe');f.id='shopping';f.src='/trackhunt/';document.querySelector('.win').appendChild(f);
    await new Promise(resolve=>f.addEventListener('load',resolve,{once:true}));
    WizAppServices.attach(f,{appId:'trackhunt',path:'/trackhunt/'});
  });
  await p.waitForFunction(async()=>!(await navigator.serviceWorker.getRegistrations()).some(r=>r.scope.endsWith('/trackhunt/')));
  ok('exact app worker scope removed, root/shell/unrelated preserved',await p.evaluate(async()=>{const regs=await navigator.serviceWorker.getRegistrations();return ['/', '/wizard-os-home/','/unrelated/'].every(scope=>regs.some(r=>r.scope===location.origin+scope))}));
  ok('only exact named app cache removed',await p.evaluate(async()=>{const names=await caches.keys();return !names.includes('trackhunt-v1-20260711d')&&names.includes('root-shell-cache')&&names.includes('trackhunt-v1-20260711d-extra')}));
  // No arbitrary resource operation and no item-URL fetch through the file service.
  const shopping=await waitFrame(p,origin+'/trackhunt/');
  ok('host file resource rejects URL-shaped payload',await shopping.evaluate(()=>WizardApp.share.file({url:'/private-secret'}))==='unsupported');
  await ctx.close();
  // Standalone: no parent rights; the same client resource, Web Share/clipboard readback and root guard.
  const standalone=await b.newContext(),sp=await standalone.newPage();await sp.goto(origin+'/wizard-search/');
  ok('standalone ready does not pretend hosted',await sp.evaluate(async()=>!(await WizardApp.ready()).hosted&&!WizardApp.hosted));
  await sp.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Cancelled','AbortError')}})});
  ok('standalone browser share AbortError -> cancelled',await sp.evaluate(()=>WizardApp.share.text({text:'x'}))==='cancelled');
  await sp.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:t=>new Promise(r=>{window.copyText=t;window.completeCopy=r})}});window.copySettled=false;window.copy=WizardApp.share.text({text:'text',url:'https://example.org/path'}).then(v=>{copySettled=true;return v})});
  ok('clipboard waits for successful write',!await sp.evaluate(()=>copySettled));await sp.evaluate(()=>completeCopy());ok('copy payload keeps URL',await sp.evaluate(()=>copy)==='copied'&&await sp.evaluate(()=>copyText)==='text\nhttps://example.org/path');
  await sp.locator('#open').click();await sp.keyboard.press('Escape');await sp.waitForTimeout(100);
  ok('standalone CloseWatcher nested Back stays open',sp.url()===origin+'/wizard-search/'&&await sp.evaluate(()=>depth===0));
  await sp.goBack({waitUntil:'domcontentloaded'});await sp.waitForTimeout(100);
  ok('standalone first browser Back at root stays and warns',sp.url()===origin+'/wizard-search/'&&await sp.locator('#wizard-app-back-notice').textContent()==='Press back again to exit');
  await standalone.close();
  const nativeStandalone=await b.newContext(),np=await nativeStandalone.newPage();
  await np.addInitScript(()=>{window.webkit={messageHandlers:{wizardNative:{postMessage(){}}}};});await np.goto(origin+'/wizard-search/');
  await np.locator('#open').click();await np.keyboard.press('Escape');await np.waitForTimeout(100);
  await np.goBack({waitUntil:'domcontentloaded'});await np.waitForTimeout(100);await np.goBack({waitUntil:'domcontentloaded'});await np.waitForTimeout(100);
  ok('standalone native Mac root consumes repeated Back and never offers exit',np.url()===origin+'/wizard-search/'&&await np.evaluate(()=>depth===0&&!document.querySelector('#wizard-app-back-notice')));
  await np.addScriptTag({url:origin+'/wizard-os-home/core/app-capture.js'});
  ok('standalone capture without app metadata has a valid stable owner',await np.evaluate(async()=>{delete document.documentElement.dataset.app;const s=await WizardApp.capture.start({kind:'audio'});const owner=WizAppCapture.getState().appId;const valid=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(owner);await s.stop();const pending=await WizardApp.capture.pending();await WizardApp.capture.ack(pending[0].id);return valid&&owner==='standalone-wizard-search'&&pending.length===1&&(await WizardApp.capture.pending()).length===0}));
  await nativeStandalone.close();
  ok('zero network writes / agent writes',writes.length===0,writes);ok('no external requests escaped local fixture route',receipt.blockedExternal.length===0,receipt.blockedExternal);
 } finally {await b.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify(receipt,null,2));}
 console.log('RECEIPT',path.join(OUT,'receipt.json'),receipt.tests.length+' passed');
})().catch(e=>{receipt.error=String(e.stack);fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify(receipt,null,2));console.error(e);server.close();process.exitCode=1});
async function waitFrame(p,url){await p.waitForFunction(u=>Array.from(document.querySelectorAll('iframe')).some(f=>f.src===u),url);for(let i=0;i<100;i++){const fr=p.frames().find(f=>f.url()===url);if(fr)return fr;await p.waitForTimeout(50)}throw new Error('Missing frame '+url)}
