// Focused read-only Thales QA. Candidate: QA_WEB_DIR=<repo>; live: omit it.
// QA_ORIGIN must be the real private ingress; all non-GET/HEAD requests are blocked.
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const BASE = process.env.QA_ORIGIN;
if (!BASE) throw new Error('QA_ORIGIN required');
const OUT = process.env.QA_OUT;
fs.mkdirSync(OUT, { recursive: true });
const changed = new Set(['app.js', 'desktop/desktop.js', 'core/apps.js', 'system/index.html', 'system/system.js']);
let pass = 0, fail = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); pass++; results.push({name, ok:true}); console.log('PASS', name); }
  catch (e) { fail++; results.push({name, ok:false, error:String(e)}); console.log('FAIL', name, String(e)); }
}
async function context(browser, phone, mode = '') {
  const ctx = await browser.newContext({serviceWorkers:'block', ignoreHTTPSErrors:true,
    ...(phone ? {viewport:{width:412,height:892},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36'} : {viewport:{width:1440,height:900}})});
  const blocked = [];
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (!['GET','HEAD'].includes(req.method())) {blocked.push(u.pathname); return route.fulfill({status:403,body:'QA blocks writes'});}
    if (mode === 'overview-failed' && u.pathname.endsWith('/system/v1/overview')) return route.fulfill({status:503,body:'QA overview failure'});
    if (u.pathname === '/wizard/v1/apps' && ['absent','apps-failed','no-view'].includes(mode)) {
      if (mode === 'apps-failed') return route.fulfill({status:503,body:'QA apps failure'});
      return route.fulfill({json:{apps:mode === 'no-view' ? [{id:'wizard-supervisor',name:'Supervisor',url:''}] : []}});
    }
    const f = u.pathname.replace(/^\/wizard-os-home\//,'');
    if (process.env.QA_WEB_DIR && changed.has(f)) {
      const file = path.join(process.env.QA_WEB_DIR,'web',f);
      return route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':'application/javascript',body:fs.readFileSync(file)});
    }
    return route.continue();
  });
  await ctx.addInitScript(() => {try {
    localStorage.setItem('wos.coached','true');
    localStorage.setItem('wos.recent',JSON.stringify(['wizard-supervisor','wizard']));
  } catch {}});
  return {ctx,blocked};
}
(async () => {
 const browser = await chromium.launch({executablePath:process.env.QA_CHROME});
 try {
  for (const phone of [true,false]) {
   const shell = phone?'phone':'desktop', {ctx,blocked} = await context(browser,phone);
   const p = await ctx.newPage(), errors=[]; p.on('pageerror', e=>errors.push(String(e)));
   await p.goto(BASE+'?open=system');
   await p.waitForFunction(()=>window.__wos||window.__wux);
   await p.waitForFunction(()=>WizCore.apps('desktop').APP['wizard-supervisor']);
   await check(shell+' real shell and session reads', async()=> {
     assert.equal(await p.evaluate(()=>document.documentElement.dataset.shell),shell);
     await p.waitForFunction(()=> {const l=window.__wos?.live || window.__wux?.live;return l?.ok && l.sessions?.length > 0;});
   });
   const sys = p.frameLocator('iframe[src*="system/index.html"]').first();
   await sys.locator('#s-apps').waitFor({timeout:20000});
   await check(shell+' lifecycle copy', async()=> {
     assert((await sys.locator('#s-apps .st').allTextContents()).some(t=>t.includes('Backend running')));
     assert.match(await sys.locator('#s-apps .hint').innerText(),/reported backend lifecycle status/);
     assert.doesNotMatch(await sys.locator('#s-apps .hint').innerText(),/no screen of their own/);
   });
   await check(shell+' Maintenance opens installed Supervisor', async()=> {
     await sys.locator('[data-supervisor]').click({timeout:3000});
     await p.frameLocator('iframe[src*="supervisor-prototype"]').first().locator('body').waitFor();
     await p.frameLocator('iframe[src*="supervisor-prototype"]').first().locator('.scope').waitFor({state:'visible'});
     assert((await p.frameLocator('iframe[src*="supervisor-prototype"]').first().locator('body').innerText()).includes('Supervisor'));
     await p.screenshot({path:path.join(OUT,shell+'-supervisor.png')});
   });
   await p.goto(BASE+'?open=wizard-supervisor');
   await p.frameLocator('iframe[src*="supervisor-prototype"]').first().locator('.scope').click();
   await check(shell+' nested app Back retains shell', async()=> {
     await p.evaluate(()=>history.back()); await p.waitForTimeout(500);
     assert(p.url().includes('/wizard-os-home/'));
     assert(await p.evaluate(()=>!!(window.__wos||window.__wux)));
   });
   await check(shell+' registry and name lookup retain Supervisor', async()=> {
     assert(await p.evaluate(()=>{const r=WizCore.apps('desktop');return !!r.APP['wizard-supervisor'] && r.findApp('Supervisor')?.id==='wizard-supervisor';}));
   });
   if (phone) {
     await p.evaluate(()=>__wos.openSheet('launcher')); await p.locator('#search').waitFor({state:'visible'});
     await check('phone normal and Recent Apps exclude Supervisor',async()=>assert.equal(await p.locator('#launcherBody [data-app="wizard-supervisor"]').count(),0));
     await p.fill('#search','Supervisor');
     await check('phone Apps search excludes Supervisor',async()=>assert.equal(await p.locator('#launcherBody [data-app="wizard-supervisor"]').count(),0));
   } else {
     await p.evaluate(()=>__wux.openPicker());
     await check('desktop Apps selector excludes Supervisor',async()=>assert(!(await p.locator('#palList').innerText()).includes('Supervisor')));
     await p.fill('#palInput','Supervisor');
     await check('desktop Apps selector search excludes Supervisor',async()=>assert.equal(await p.locator('#palList .pal-app .nm').filter({hasText:'Supervisor'}).count(),0));
     await p.evaluate(()=>{__wux.closePalette(); __wux.openPalette();});
     await p.fill('#palInput','Supervisor');
     await check('desktop command palette Apps excludes Supervisor',async()=>assert.equal(await p.locator('#palList [role="group"]').filter({has:p.locator('.pal-grp', {hasText:/^Apps$/})}).locator('.pal-it').filter({hasText:'Supervisor'}).count(),0));
     // Also inspect rendered row labels (palette's Ask command may still mention the query).
     await check('desktop no Supervisor app row in palette',async()=>assert(!(await p.locator('#palList').innerHTML()).includes('Prototype system supervisor')));
   }
   await p.screenshot({path:path.join(OUT,shell+'-apps-search.png')});
   await p.goto(BASE+'?open=wizard-supervisor');
   await check(shell+' existing cold deep link opens Supervisor',async()=> {
     await p.frameLocator('iframe[src*="supervisor-prototype"]').first().locator('body').waitFor({timeout:15000});
     await p.frameLocator('iframe[src*="supervisor-prototype"]').first().locator('.scope').waitFor({state:'visible'});
     assert((await p.frameLocator('iframe[src*="supervisor-prototype"]').first().locator('body').innerText()).includes('Supervisor'));
   });
   await p.goto(BASE+'?open=system');
   await sys.locator('#s-apps').waitFor();
   await check(shell+' System Maintenance visible after reopening',async()=> {
     await sys.locator('[data-supervisor]').waitFor({state:'visible',timeout:3000});
     await p.waitForFunction(()=> {const l=window.__wos?.live || window.__wux?.live;return l?.ok && l.sessions?.length > 0;});
     await p.screenshot({path:path.join(OUT,shell+'-system.png')});
   });
   await check(shell+' focused System node Back clears focus and retains shell',async()=> {
     const node=sys.locator('[data-node]').first(); await node.click();
     assert(await sys.locator('#focus').isVisible());
     await p.evaluate(()=>history.back()); await p.waitForTimeout(500);
     assert.equal(await sys.locator('#focus').isVisible(),false);
     assert(await p.evaluate(()=>!!(window.__wos||window.__wux)));
   });
   await check(shell+' root Back retains shell',async()=> {
     await p.evaluate(()=>window.__wux ? __wux.goHome() : __wos.goDesk(0,true));
     await p.waitForTimeout(350); await p.evaluate(()=>history.back()); await p.waitForTimeout(350);
     assert(p.url().includes('/wizard-os-home/'));
     assert(await p.evaluate(()=>!!(window.__wos||window.__wux)));
   });
   await p.goto(BASE+'?open=wizard');
   await check(shell+' real Chats rows render',async()=> {
     await p.waitForFunction(()=> {const l=window.__wos?.live || window.__wux?.live;return l?.ok && l.sessions?.length > 0;});
     await p.locator('[data-chopen]').first().waitFor({state:'visible'});
   });
   await check(shell+' no page errors',async()=>assert.deepEqual(errors,[]));
   await check(shell+' zero agent run attempts',async()=>assert(!blocked.some(u=>/\/v1\/runs$/.test(u))));
   await ctx.close();
  }
  for (const mode of ['overview-failed','absent','apps-failed','no-view']) {
   const {ctx}=await context(browser,true,mode);const p=await ctx.newPage();
   await p.goto(BASE+'system/index.html'); await p.waitForTimeout(1500);
   await check(mode+' availability isolation',async()=> {
     assert.equal(await p.locator('#maintenance').isVisible(),mode==='overview-failed');
     if(mode==='overview-failed') assert.match(await p.locator('#sections').innerText(),/isn’t reachable/);
   });
   await ctx.close();
  }
 } finally {await browser.close(); fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({pass,fail,assetMode:process.env.QA_WEB_DIR?'candidate overlay':'live served',results},null,2));}
 console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
