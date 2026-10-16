// Thales-only browser acceptance. Candidate asset interception is NOT deployment evidence.
// PW=<playwright module> QA_URL=<existing Wizard shell> QA_ROOT=<checkout>
// QA_SNAPSHOT=<redacted candidate installed endpoint capture> QA_OUT=<external evidence dir>
const {chromium}=require(process.env.PW),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=process.env.QA_ROOT || process.cwd(),out=process.env.QA_OUT,base=process.env.QA_URL;
const snapshot=JSON.parse(fs.readFileSync(process.env.QA_SNAPSHOT));
(async()=>{
 fs.mkdirSync(out,{recursive:true}); const browser=await chromium.launch({headless:true}); const result={candidate:true,host:require('os').hostname(),widths:[],mutations:[]};
 try { for(const width of [390,1440]) {
  const ctx=await browser.newContext({viewport:{width,height:940},serviceWorkers:'block',...(width===390?{isMobile:true,hasTouch:true}: {})});
  let mode='live',lastCatalog; const errors=[];
  await ctx.route('**/wizard-os-home/store/*',async r=>{
   const file=path.basename(new URL(r.request().url()).pathname);
   if(!['index.html','store.js','store.css','store-status.mjs'].includes(file)) return r.continue();
   await r.fulfill({status:200,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(root,'web/store',file))});
  });
  await ctx.route('**/store-data/wizard/v1/installed-apps',r=>r.fulfill({status:mode==='outage'?503:200,contentType:'application/json',body:JSON.stringify(snapshot)}));
  await ctx.route('**/store-data/wizard/v1/index/search?*',async r=>{
   const res=await r.fetch();const doc=await res.json();lastCatalog=doc;
   if(mode==='conflict') for(const a of doc.apps) if(a.id==='cinequeue') a.conflict=true;
   if(mode==='removed') for(const a of doc.apps) if(a.id==='wisdom') a.releases=a.releases.filter(x=>x.channel!=='alpha');
   await r.fulfill({response:res,json:doc});
  });
  await ctx.route('**/wizard-os-home/store-install/**',r=>{result.mutations.push(r.request().url());return r.abort();});
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  const openStore=async()=>{
   await p.goto(base+'?open=app-store');
   await p.waitForFunction(()=>Array.from(document.querySelectorAll('iframe')).some(f=>f.src.includes('/store/index.html')));
   const f=p.frames().find(f=>f.url().includes('/store/index.html'));
   await f.locator('[data-kind="apps"]:not([disabled])').waitFor();
   await f.locator('[data-kind="apps"]').click(); return f;
  };
  let f=await openStore();
  const list=await f.locator('.row').evaluateAll(rows=>rows.map(r=>({key:r.dataset.app,name:r.querySelector('.tx b').textContent,alpha:r.querySelector('.alpha-badge')?.textContent,action:r.querySelector('.get').textContent})));
  assert.ok(!list.some(a=>a.key.startsWith('wizard-ux|') || a.key.startsWith('wizard-shell|')));
  assert.ok(list.filter(a=>a.alpha).every(a=>a.alpha==='Alpha'));
  const firstStandard=list.findIndex(a=>!a.alpha);assert.ok(firstStandard<0 || list.slice(firstStandard).every(a=>!a.alpha));
  assert.ok(list.some(a=>a.alpha));
  const opens=[['wizard-calendar','calendar','/wizard-calendar/'],['wizard-music','wizard-music','/wizard-music/'],['cinequeue','cinequeue-next','/cinequeue-next/'],['wisdom','wisdom','/wisdom/'],['wizard-shopping','wizard-shopping','/alpha-wizard-shopping/']];
  for(const [id,target] of opens) assert.equal(list.find(a=>a.key.startsWith(id+'|'))?.action,'Open',id);
  const badgeStyle=await f.locator('.alpha-badge').first().evaluate(e=>({size:getComputedStyle(e).fontSize,bg:getComputedStyle(e).backgroundColor}));assert.equal(badgeStyle.size,'14px');
  await p.screenshot({path:path.join(out,`apps-${width}.png`),fullPage:true});
  const opened=[];
  for(const [id,target,url] of opens) {
   if(opened.length) f=await openStore();
   await f.locator(`.row[data-app^="${id}|"] .tx`).click();
   await f.locator(`#detail [data-open="${target}"]`).waitFor();
   if(id==='cinequeue') await p.screenshot({path:path.join(out,`movies-${width}.png`),fullPage:true});
   await f.locator(`#detail [data-open="${target}"]`).click();
   await p.waitForFunction(url=>Array.from(document.querySelectorAll('iframe')).some(f=>new URL(f.src,location.href).pathname.startsWith(url)),url);
   const app=p.frames().find(x=>new URL(x.url() || 'about:blank').pathname.startsWith(url));
   await app.locator('body').waitFor();assert.ok((await app.locator('body').innerText()).trim().length>0);
   opened.push({id,target,url:app.url()});
  }
  // Reload returns to real installed releases, not a forced older Alpha selection.
  f=await openStore();await p.reload();
  await p.waitForFunction(()=>Array.from(document.querySelectorAll('iframe')).some(f=>f.src.includes('/store/index.html')));
  f=p.frames().find(f=>f.url().includes('/store/index.html'));await f.locator('[data-kind="apps"]:not([disabled])').click();
  await f.locator('.row[data-app^="wisdom|"] .tx').click();
  assert.equal(await f.locator('#detail .get').first().innerText(),'Open');
  const installedChoice=await f.locator('#release-choice').inputValue();assert.ok(installedChoice.startsWith('owner-private:'));
  const alpha=lastCatalog.apps.find(a=>a.id==='wisdom').releases.find(r=>r.channel==='alpha');
  await f.locator('#release-choice').selectOption(`${alpha.source}:${alpha.commit}`);
  assert.equal(await f.locator('#detail [data-get]').innerText(),'Switch release');
  await f.locator('#detail [data-get]').click();const request=await f.locator('#toast').innerText();assert.ok(request.includes(alpha.commit) && request.includes('Switch release for') && request.includes('--update'));
  await f.locator('#refresh').click();await f.locator('#refresh:not([disabled])').waitFor();assert.equal(await f.locator('#release-choice').inputValue(),`${alpha.source}:${alpha.commit}`);
  assert.equal(await f.locator('#detail [data-get]').innerText(),'Switch release');
  assert.equal(await f.locator('#detail .alpha-badge').innerText(),'Alpha');
  assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.screenshot({path:path.join(out,`switch-${width}.png`),fullPage:true});
  await f.locator('#release-choice').selectOption(installedChoice);assert.equal(await f.locator('#detail .get').first().innerText(),'Open');
  // Canonical hosted Back hook must close detail, then list, without leaving Store.
  assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true);assert.equal(await f.locator('#results').isVisible(),true);
  assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),true);assert.equal(await f.locator('#discover').isVisible(),true);
  assert.ok(p.frames().some(x=>x.url().includes('/store/index.html')));
  mode='outage';await f.locator('#refresh').click();await f.locator('#refresh:not([disabled])').waitFor();await f.locator('[data-kind="apps"]').click();
  assert.equal(await f.locator('[data-get]').count(),0);assert.ok((await f.locator('#source-status').innerText()).includes('incomplete'));
  mode='conflict';await f.locator('#refresh').click();await f.locator('#refresh:not([disabled])').waitFor();
  const conflict=f.locator('.row[data-app^="cinequeue|"]');assert.equal(await conflict.locator('[data-open]').count(),0);assert.equal(await conflict.locator('[data-get]').count(),0);assert.equal(await conflict.locator('.get').innerText(),'Resolve conflict');
  // Selected release disappearing on refresh blocks, rather than replacing its exact pin.
  mode='live';await f.locator('#refresh').click();await f.locator('#refresh:not([disabled])').waitFor();await f.locator('.row[data-app^="wisdom|"] .tx').click();await f.locator('#release-choice').selectOption(`${alpha.source}:${alpha.commit}`);
  mode='removed';await f.locator('#refresh').click();await f.locator('#refresh:not([disabled])').waitFor();assert.equal(await f.locator('#detail [data-get]').count(),0);assert.ok((await f.locator('#release-choice').innerText()).includes('no longer available'));
  assert.deepEqual(errors,[]);result.widths.push({width,list,badgeStyle,opened,refresh_selection:true,unknown_no_get:true,conflict_no_open:true,removed_pin_blocked:true,back_stays:true,errors});await ctx.close();
 }
 // Actual browser Back in standalone mode keeps Store open.
 const c=await browser.newContext();await c.route('**/wizard-os-home/store/*',async r=>{const file=path.basename(new URL(r.request().url()).pathname);if(!['index.html','store.js','store.css','store-status.mjs'].includes(file))return r.continue();return r.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(root,'web/store',file))});});
 await c.route('**/store-data/wizard/v1/installed-apps',r=>r.fulfill({json:snapshot}));
 const page=await c.newPage();await page.goto(base+'store/index.html');await page.locator('[data-kind="apps"]:not([disabled])').click();await page.locator('.row .tx').first().click();await page.goBack();assert.equal(await page.locator('#results').isVisible(),true);assert.ok(page.url().includes('/store/index.html'));result.standalone_back=true;await c.close();
 assert.deepEqual(result.mutations,[]);fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
