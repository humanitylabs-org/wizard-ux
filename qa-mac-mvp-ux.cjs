// Isolated browser contracts; fixture backend is explicit, not app/runtime acceptance.
// Run on Thales under worker.lock. QA_WEB, QA_OUT, QA_PLAYWRIGHT, QA_CHROMIUM.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const crypto = require('node:crypto');
const { chromium } = require(process.env.QA_PLAYWRIGHT || '/Users/thales/projects/wisdom-app-migration-20261012/qa-node/node_modules/playwright');
const web = path.resolve(process.env.QA_WEB || path.join(__dirname, 'web'));
const out = process.env.QA_OUT || path.join(__dirname, 'qa-mac-ux'); fs.mkdirSync(out, { recursive: true });
const sourceHashes = Object.fromEntries(['core/apps.js','core/chats.js','core/chats.css','desktop/desktop.js','desktop/desktop.css','store/store.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(web,file))).digest('hex')]));
const checks = [], errors = [], requests = []; let installed = [{info:{id:'hermes-agent'},app:{status:'running'}},{info:{id:'files'},app:{status:'running'}}], failView = true;
const apps = [{id:'hermes-agent', name:'Hermes Agent', type:'agent', summary:'The installed agent'}, {id:'wizard-ai-accounts',name:'AI Accounts',type:'view',summary:'Manage AI accounts'}, {id:'files',name:'Files',type:'view',summary:'Shared files'}];
const shellApps = () => apps.filter(a => a.id !== 'wizard-ai-accounts' || installed.some(x=>x.info.id===a.id)).map(a=>({...a,url:`/apps/${a.id}/`}));
const server = http.createServer(async (req,res) => {
 const u = new URL(req.url,'http://localhost'), p=u.pathname; requests.push({method:req.method,path:p});
 const json = (v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
 if(p==='/wizard/v1/bootstrap') return json({bootstrap:1,settings:{agent:{name:'Wizard'}},capabilities:{app_installation:true},endpoints:{apps:'/wizard/v1/apps'}});
 if(p==='/wizard/v1/apps') return json({apps:shellApps()});
 if(p.includes('/api/apps/installed')) return json({installed});
 if(p.includes('/wizard/v1/index/search')) return json({apps});
 if(p.includes('/wizard/v1/index/tags')) return json({tags:[]});
 if(p==='/wizard/v1/app-lifecycle/session') return json({csrf:'fixture-csrf',expires_in:600});
 if(p.startsWith('/api/app-lifecycle/')) {await new Promise(r=>setTimeout(r,650));const id=decodeURIComponent(p.split('/')[3]).split(':')[0];installed=[...installed.filter(x=>x.info.id!==id),{info:{id},app:{status:'running'}}];return json({success:true});}
 if(p.startsWith('/wizard/hermes/api/sessions')) return json({sessions:[],messages:[],total:0});
 if(p.startsWith('/wizard/')) return json({state:{},models:[]});
 if(p.startsWith('/apps/')) {if(failView) return json({error:'app_unavailable'},503); res.writeHead(200,{'Content-Type':'text/html'}); return res.end('<!doctype html><html><body><h1>Fixture app recovered</h1></body></html>');}
 const relative=p.replace(/^\/wizard-os-home\//,'');const file=path.resolve(web,relative||'index.html');
 if(!file.startsWith(web+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('not found');}
 res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
function check(ok,name,detail){checks.push({name,pass:!!ok,detail});console.log(ok?'PASS':'FAIL',name,detail||'');}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/wizard-os-home/desktop.html`;
 const browser=await chromium.launch({executablePath:process.env.QA_CHROMIUM || '/Users/thales/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
 try {
  for(const native of [false,true]) {
   const context=await browser.newContext({viewport:{width:1100,height:780},serviceWorkers:'block'});
   if(native)await context.addInitScript(()=>{window.webkit={messageHandlers:{wizardNative:{postMessage(){}}}};});
   const p=await context.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(base);await p.waitForFunction(()=>window.__wux);
   const legacy=await p.evaluate(()=>__wux.newWin({app:'frame',appId:'hermes-agent'}).id);
   await p.reload();await p.waitForFunction(()=>window.__wux);
   check(await p.evaluate(id=>__wux.wins[id]?.app==='chats'&&!__wux.wins[id]?.appId,legacy),'obsolete Hermes iframe restores as Chats without deleting its window');
   for(const size of [[1100,780],[720,1100],[1500,1100],[600,600]]) {
    await p.setViewportSize({width:size[0],height:size[1]});
    await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await p.evaluate(()=>Object.values(__wux.wins).forEach(w=>__wux.closeWin(w.id)));
    const rect=await p.evaluate(()=>{__wux.newChat();const ta=document.querySelector('.win.focus .pane-main textarea'),form=ta.closest('form'),box=ta.closest('.wbody');const r=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right};};return {ta:r(ta),form:r(form),box:r(box),logo:r(document.querySelector('#logo')),viewport:innerHeight,value:ta.value};});
    check(rect.ta.height>=38&&rect.form.bottom<=rect.box.bottom+1&&rect.ta.bottom<=rect.viewport,`${native?'native-like':'browser'} composer first paint ${size}`,rect);
    check(native?rect.logo.x>=86:rect.logo.x<20,`${native?'native-like':'browser'} header clearance ${size}`,rect.logo);
    await p.screenshot({path:path.join(out,`${native?'native':'browser'}-${size.join('x')}.png`)});
   }
   await p.locator('.win.focus .pane-main textarea').fill('draft survives resizing');await p.setViewportSize({width:1200,height:850});
   check(await p.locator('.win.focus .pane-main textarea').inputValue()==='draft survives resizing','resize preserves draft');
   await p.evaluate(()=>{__wux.goWs(1);__wux.goWs(0);});check(await p.locator('.win.focus .pane-main textarea').inputValue()==='draft survives resizing','desktop switching preserves draft');
   await p.evaluate(()=>document.querySelector('.win.focus [data-wact="mono"]').click());await p.evaluate(()=>history.back());await p.waitForTimeout(300);check(await p.evaluate(()=>!__wux.ws[0].mono),'Back leaves immersive mode');
   if(!native) {
    await p.evaluate(()=>__wux.openApp(WizCore.apps('desktop').APPS.find(a=>a.id==='app-store')));
    const store=p.frameLocator('iframe[src*="store/index.html"]');await store.locator('[data-kind="apps"]:not(:disabled)').waitFor();await store.locator('[data-kind="apps"]').click();
    await store.locator('[data-get="wizard-ai-accounts"]').click();await p.waitForTimeout(80);
    check(await store.locator('[data-app="wizard-ai-accounts"]').innerText().then(t=>/Checking|Getting|Installing|Working/.test(t)),'Store list immediately acknowledges Get');
    await store.locator('[data-open="wizard-ai-accounts"]').waitFor({timeout:8000}).catch(()=>{});
    check(await store.locator('[data-open="wizard-ai-accounts"]').count()===1,'Store list changes Get to Open without refresh');
    await store.locator('[data-app="wizard-ai-accounts"]').click();check(await store.locator('#detail [data-open="wizard-ai-accounts"]').count()===1,'Store detail shows ready Open');
    await p.screenshot({path:path.join(out,'store-ready.png')});
    const stable=await store.locator('#detail').evaluate(el=>{window.__qaDetail=el.firstElementChild;return true;});
    await p.waitForTimeout(3400);check(stable&&await store.locator('#detail').evaluate(el=>el.firstElementChild===window.__qaDetail),'Unchanged Store poll preserves detail DOM');
    installed=installed.filter(x=>x.info.id!=='wizard-ai-accounts');await p.evaluate(()=>dispatchEvent(new CustomEvent('wizard:apps-changed')));
    await store.locator('#detail [data-get="wizard-ai-accounts"]').waitFor();await store.locator('#detail [data-get="wizard-ai-accounts"]').click();
    check(await store.locator('#detail [aria-busy="true"]').count()===1,'Store detail immediately acknowledges Get');
    await store.locator('#detail [data-open="wizard-ai-accounts"]').waitFor();check(await store.locator('#detail [data-open="wizard-ai-accounts"]').count()===1,'Store detail reaches Open without refresh');
    await p.evaluate(()=>{const w=document.querySelector('iframe[src*="store/index.html"]').contentWindow;w.document.querySelector('#detail [data-back]').click();w.document.querySelector('#results [data-back]').click();w.document.querySelector('[data-kind="agents"]').click();});
    await store.locator('[data-app="hermes-agent"]').click();
    await store.locator('#detail [data-open="hermes-agent"]').click();await p.waitForTimeout(100);
    check(await p.evaluate(()=>!Object.values(__wux.wins).some(w=>w.appId==='hermes-agent')&&Object.values(__wux.wins).some(w=>w.app==='chats')),'Hermes opens supported Chats, not endpoint iframe');
    await p.evaluate(()=>__wux.openApp(WizCore.apps('desktop').APPS.find(a=>a.id==='files')));await p.waitForTimeout(800);
    check(await p.locator('.win.focus .frame-fallback.on').count()===1,'Unavailable JSON replaced with readable recovery');
    await p.screenshot({path:path.join(out,'app-recovery.png')});
    failView=false;
    if(await p.locator('.win.focus [data-frame-retry]').count()) {await p.locator('.win.focus [data-frame-retry]').click();await p.waitForTimeout(400);check(await p.locator('.win.focus .frame-fallback.on').count()===0&&await p.frameLocator('.win.focus iframe').locator('h1').innerText()==='Fixture app recovered','Retry loads actual recovered app');}
   }
   await p.evaluate(()=>{Object.values(__wux.wins).forEach(w=>__wux.closeWin(w.id));history.back();});await p.waitForTimeout(200);check(p.url()===base&&await p.evaluate(()=>!!window.__wux),'root Back retains desktop');
   await context.close();
  }
 }finally{await browser.close();server.close();}
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({host:os.hostname(),web,sourceHashes,fixture:true,nativeBoundary:'wizardNative injected; viewport only, not AppKit',checks,errors,requests},null,2));
 const failed=checks.filter(x=>!x.pass);console.log(JSON.stringify({passed:checks.length-failed.length,failed:failed.length,errors}));if(failed.length||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
