// Run only on Thales. Live GET APIs + source overlay; never forward mutations or beacons.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
if (!os.hostname().toLowerCase().includes('thales') || !process.env.QA_OUT?.startsWith('/Volumes/ThalesMedia/') || !process.env.QA_CHROME) throw Error('Thales/external-volume QA only');
const BASE = process.argv[2], OUT = process.env.QA_OUT, SOURCE = process.env.QA_SOURCE, baseline = process.env.QA_BASELINE === '1';
fs.mkdirSync(OUT,{recursive:true});
process.env.TMPDIR=path.join(OUT,'tmp');fs.mkdirSync(process.env.TMPDIR,{recursive:true});
const checks=[], errors=[], writes=[], reads=[], hashes={}; let browser;
const nap=ms=>new Promise(r=>setTimeout(r,ms));
function ok(pass,name,detail) { checks.push({pass:!!pass,name,detail}); console.log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail)); }
async function shot(p,name) { await nap(150); await p.screenshot({path:path.join(OUT,name+'.png')}); }
async function boot(phone) {
 const ctx=await browser.newContext({serviceWorkers:'block',viewport:phone?{width:390,height:844}:{width:1440,height:900},hasTouch:phone,isMobile:phone,userAgent:phone?'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'});
 await ctx.route('**/*',async route=>{
  const q=route.request(),url=new URL(q.url());
  if(!['GET','HEAD'].includes(q.method())) { writes.push({method:q.method(),url:q.url()}); return route.fulfill({status:403,body:'{}'}); }
  if(SOURCE && url.pathname.startsWith('/wizard-os-home/')) { const rel=url.pathname.slice('/wizard-os-home/'.length)||'index.html',f=path.resolve(SOURCE,'web',rel); if(f.startsWith(path.resolve(SOURCE,'web')+path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) { const body=fs.readFileSync(f);hashes[rel]=crypto.createHash('sha256').update(body).digest('hex'); const ext=path.extname(f),type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.woff2':'font/woff2','.svg':'image/svg+xml'}[ext]||'application/octet-stream'; return route.fulfill({body,contentType:type}); } }
  if(/\/wizard\//.test(url.pathname)) reads.push(q.url()); return route.continue();
 });
 await ctx.addInitScript(()=>{localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.done','1'); navigator.sendBeacon=(url)=>{(window.__qaBeacons ||= []).push(String(url));return false;};});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(BASE+'?view=skin');await p.waitForFunction(m=>m?window.__wos?.live?.ok:window.__wux?.live?.ok,phone,{timeout:60000});await nap(500);
 return {p,ctx};
}
async function open(p,phone,view='skin') { await p.evaluate(v=>WizCore.deeplink.route('/wizard-os-home/?view='+v),view);await nap(120); }
(async()=>{
 browser=await chromium.launch({executablePath:process.env.QA_CHROME});
 for(const phone of [false,true]) {
  const kind=phone?'phone':'desktop',{p,ctx}=await boot(phone),selector=phone?'#settings.open':'#dsettings:not([hidden])';
  if(baseline) { ok(phone?await p.locator('[data-skinpick]').count()===5:await p.locator('[data-skinpick]').count()===0,kind+' live baseline selector',await p.locator('[data-skinpick]').count());await shot(p,kind+'-baseline');await ctx.close();continue; }
  ok(await p.locator(selector).isVisible(),kind+' skin deep link opens Settings');
  ok(await p.locator('[data-skinpick]').count()===5,kind+' same five approved skins');
  ok(await p.evaluate(()=>!!WosSettings && !!WosSkin),kind+' shared modules mounted');
  ok(await p.locator('[data-st=web-update]').count()===1,kind+' common web update check is reachable');
  const features=await p.locator('[data-settings-feature]').evaluateAll(es=>es.map(e=>e.dataset.settingsFeature));
  ok(['unsent','look','voice','cancelled','wizard','usage'].every(x=>features.includes(x)),kind+' all common settings features',features);
  ok(phone?await p.locator('[data-st=everywhere][disabled]').count()===1:await p.locator('[data-st=everywhere]').count()===0,kind+' honest Android capability gate');
  await p.evaluate(()=>WizCore.deeplink.route('/wizard-os-home/?open=wisdom'));
  await p.waitForFunction(()=>WizAppearance.inspect().some(x=>/wisdom/.test(x.src)&&x.acked),null,{timeout:30000});
  const appFrame=p.frames().find(f=>/\/wisdom\//.test(f.url()));
  await appFrame.evaluate(()=>window.__qaSkinDocument='kept');await open(p,phone);
  for(const skin of ['nebula','grove','tide','ember','signal']) {
   await p.click('[data-skinpick='+skin+']');await nap(200);
   const state=await p.evaluate(()=>({skin:document.documentElement.dataset.skin,saved:localStorage.getItem('wos.skin'),bg:getComputedStyle(document.body).getPropertyValue('--bg').trim(),canvases:WosSkin._bg.cv.length,scenery:WosScenery.state()}));
   ok(state.skin===skin && state.saved===skin && state.canvases===2,kind+' '+skin+' applies and persists',state);
   await appFrame.waitForFunction(s=>window.WizardTheme?.current?.skin===s,skin,{timeout:10000});
   const app=await appFrame.evaluate(()=>({skin:WizardTheme.current.skin,base:WizardTheme.current.tokens.base,marker:__qaSkinDocument,bg:getComputedStyle(document.body).backgroundColor}));
   ok(app.skin===skin && app.base===state.bg && app.marker==='kept' && app.bg==='rgba(0, 0, 0, 0)',kind+' '+skin+' styles hosted Wisdom without reload',app);
   await shot(p,kind+'-'+skin);
  }
  await p.reload();await p.waitForFunction(m=>m?window.__wos:window.__wux,phone);await open(p,phone);
  ok(await p.evaluate(()=>WosSkin.current==='signal'),kind+' reload retains selected skin');
  await p.locator('[data-skinpick=signal]').focus();await p.keyboard.press('ArrowLeft');
  ok(await p.evaluate(()=>WosSkin.current==='ember'),kind+' shared keyboard skin navigation');
  // Register exactly once. No shell edits/whitelists. The same render/action runs in either layout.
  await p.evaluate(()=>WosSettings.register({id:'qa-single-registration',aliases:['qa-feature'],html:()=>'<button data-qa-feature>One registration</button>',act:(ctx,el)=>{if(!el.closest('[data-qa-feature]'))return false;window.__qaFeatureWorked=(window.__qaFeatureWorked||0)+1;return true;}}));
  await open(p,phone,'qa-feature');await p.click('[data-qa-feature]');
  ok(await p.evaluate(()=>__qaFeatureWorked===1),kind+' synthetic feature added once is reachable and works');
  // Focus survives polling re-render and remains in the settings dialog.
  await p.locator('[data-skinpick=ember]').focus();await p.evaluate(()=>WosSettings.register({id:'qa-refresh',html:()=>''})); // force live-style re-render
  await p.keyboard.press('Tab');ok(await p.evaluate(()=>!!document.activeElement.closest('[data-settings-root]')),kind+' keyboard focus stays in Settings');
  await p.keyboard.press('Escape');await nap(250);ok(!await p.locator(selector).isVisible(),kind+' Escape closes Settings');
  await open(p,phone,'settings');await p.click('[data-st=help]');await nap(300);await p.evaluate(()=>history.back());await nap(350);
  ok(await p.locator(selector).isVisible(),kind+' nested Help Back returns to Settings');
  await p.evaluate(()=>history.back());await nap(250);ok(!p.isClosed() && p.url().includes('/wizard-os-home/'),kind+' Settings Back retains app');
  await open(p,phone,'settings');await p.click('[data-st=files]');await nap(650);await p.evaluate(()=>history.back());await nap(350);
  ok(await p.locator(selector).isVisible(),kind+' nested Files Back returns to Settings');
  await p.keyboard.press('Escape');
  // Actual live private-agent rows, without messages or API writes.
  await p.evaluate(()=>WosAgents.load());await p.evaluate(()=>WizOpenAgentChats('private'));await nap(600);
  ok(await p.locator('[data-agent-titlebar=private]').count()>0,kind+' private Chats scope still reachable');
  // State-changing actions are isolated local fixtures, never real chats/runs/transcription.
  await p.evaluate(async()=>{
    const item={id:'wos-qa-private',state:'failed',kind:'new',agent:'private',sessionId:'qa-not-a-real-session',text:'QA retained unsent words',files:[],createdAt:Date.now(),durable:true,attempts:99};
    WosOutbox._items.set(item.id,item);
    await new Promise((resolve,reject)=>{const o=indexedDB.open('wos-outbox',1);o.onsuccess=()=>{const t=o.result.transaction('items','readwrite');t.objectStore('items').put(item);t.oncomplete=()=>{o.result.close();resolve();};t.onerror=()=>reject(t.error);};o.onerror=()=>reject(o.error);});
    WosChat.drafts.set('agentnew:private','QA existing private draft',[]);
    window.__qaRetries=[];WosOutbox.retry=id=>__qaRetries.push(id);WosOutbox.retryAll=()=>__qaRetries.push('*');
  });
  await open(p,phone,'unsent');
  await p.click('[data-ubid=wos-qa-private] [data-ub=retry]');
  ok(await p.evaluate(()=>__qaRetries[0]==='wos-qa-private' && WosOutbox.get('wos-qa-private').text==='QA retained unsent words'),kind+' fixture retry reaches common dispatch without losing words');
  await p.click('[data-ubid=wos-qa-private] [data-ub=edit]');await nap(350);
  ok(await p.evaluate(()=>WosOutbox.get('wos-qa-private')?.text==='QA retained unsent words' && WosChat.drafts.get('agentnew:private')?.text==='QA existing private draft'),kind+' editing cannot overwrite existing private draft');
  await p.locator('.win[data-agent=private] textarea').count(); // scope is verified from canonical shell state below
  const privateDraft=await p.evaluate(()=>{const s=window.__wos||window.__wux;return Object.values(s.wins).filter(w=>w.agent==='private'&&w.thread==='__new__').map(w=>({id:w.id,agent:w.agent}));});
  ok(privateDraft.length>0,kind+' unsent Edit opens original private agent, never main',privateDraft);
  await open(p,phone,'unsent');await p.click('[data-ubid=wos-qa-private] [data-ub=delete]');await nap(350);
  ok(await p.evaluate(()=>!WosOutbox.get('wos-qa-private') && WosChat.drafts.get('agentnew:private')?.text==='QA existing private draft'),kind+' explicit fixture Delete preserves unrelated draft');
  await p.evaluate(()=>WosOutbox._items.set('wos-qa-edit',{id:'wos-qa-edit',state:'failed',kind:'new',agent:'',sessionId:'qa-not-a-real-session-2',text:'QA successful retained edit',files:[],createdAt:Date.now(),durable:true,attempts:99}));
  await open(p,phone,'unsent');await p.click('[data-ubid=wos-qa-edit] [data-ub=edit]');await nap(250);
  ok(await p.evaluate(()=>!WosOutbox.get('wos-qa-edit')&&WosChat.drafts.get('new').text==='QA successful retained edit'&&WosChat.drafts.get('agentnew:private').text==='QA existing private draft'),kind+' successful Edit saves words before consuming unsent and preserves other agent draft');
  await open(p,phone,'settings');
  await p.evaluate(async()=>{await WosCancelled.keepWeb(new Blob([new Uint8Array(4096)],{type:'audio/webm'}),16000);WizConfig.transcribe=async()=>({text:'QA cancelled fixture transcript'});WosChat.copyText=async text=>{window.__qaClipboard=text;return true;};});
  await p.click('[data-cx=copy]');await nap(250);
  ok(await p.evaluate(()=>__qaClipboard==='QA cancelled fixture transcript' && WosCancelled.list().length===1),kind+' cancelled fixture transcribes and copies via shared module');
  await p.click('[data-cx=show]');await p.click('[data-cx=show]');
  ok(await p.locator('[data-cxtext]').innerText()==='QA cancelled fixture transcript',kind+' cancelled words hide/show');
  await p.reload();await p.waitForFunction(m=>m?window.__wos:window.__wux,phone);await open(p,phone,'settings');
  ok(await p.evaluate(()=>WosChat.drafts.get('agentnew:private')?.text==='QA existing private draft' && !WosOutbox.get('wos-qa-private') && WosCancelled.list().length===1),kind+' reload retains draft/cancelled record and durable delete');
  await p.click('[data-cx=delete]');await nap(250);ok(await p.evaluate(()=>WosCancelled.list().length===0),kind+' explicit cancelled fixture delete');
  await open(p,phone);await p.setViewportSize({width:360,height:800});await shot(p,kind+'-360');
  ok(await p.locator('[data-skinpick]').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth+1;})),kind+' 360px skin controls do not overflow');
  await p.setViewportSize({width:1000,height:800});await shot(p,kind+'-resized');
  ok(await p.locator('[data-skinpick]').count()===5,kind+' resize keeps shared controls');
  await p.keyboard.press('Escape');
  await p.evaluate(m=>m?__wos.goDesk(0,true):__wux.goHome(),phone);await nap(200);
  const beforeRoot=await p.evaluate(()=>Object.keys((window.__wos||window.__wux).wins).sort());
  await p.evaluate(()=>history.back());await nap(350);
  ok(!p.isClosed()&&p.url().startsWith(BASE)&&await p.evaluate(m=>m?__wos.idx===0:__wux.homeOpen,phone),kind+' single root Back retains Wizard Home');
  ok(JSON.stringify(beforeRoot)===JSON.stringify(await p.evaluate(()=>Object.keys((window.__wos||window.__wux).wins).sort())),kind+' root Back retains hosted windows');
  await ctx.close();
 }
 ok(errors.length===0,'no page errors',errors);
 ok(reads.some(u=>u.includes('/api/sessions')),'real session API exercised');
 ok(!writes.some(w=>/\/v1\/runs|\/api\/sessions$/.test(w.url)),'no conversation/run creation attempted',writes);
})().catch(e=>ok(false,'suite completed',String(e.stack||e))).finally(async()=>{await browser?.close();const result={worker:os.hostname(),commit:process.env.QA_COMMIT||null,node:process.version,chrome:browser?.version(),base:BASE,source:SOURCE||'live',baseline,checks,errors,writes,readCount:reads.length,hashes,pass:checks.filter(x=>x.pass).length,fail:checks.filter(x=>!x.pass).length};fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(result,null,2));console.log('RESULT',result.pass,result.fail);process.exitCode=result.fail?1:0;});
