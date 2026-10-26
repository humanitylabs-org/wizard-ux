/* Real forum-only phone-profile acceptance. No live origin or live data is used. */
const {chromium}=require(process.env.PLAYWRIGHT_DIR||'playwright');
const {spawn}=require('node:child_process'),{createInterface}=require('node:readline');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=process.env.PIN_EVIDENCE;assert(out,'PIN_EVIDENCE required');fs.mkdirSync(out,{recursive:true});
const fixture=spawn(process.env.PYTHON||'python3',[path.join(__dirname,'qa-pin-offline-fixture.py')],{env:process.env,stdio:['ignore','pipe',fs.openSync(path.join(out,'fixture.log'),'w')]});
let browser,context,page,frame;const errors=[],checks={name:'wizard pin opens wisdom offline'};
async function appFrame(){await page.waitForSelector('#singleApp iframe');return (await page.$('#singleApp iframe')).contentFrame();}
async function back(){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('wizard:back')));await page.waitForTimeout(250);}
(async()=>{
  const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('fixture timeout')),45000);fixture.once('exit',c=>{clearTimeout(t);reject(Error('fixture exited '+c))});createInterface({input:fixture.stdout}).once('line',s=>{clearTimeout(t);resolve(JSON.parse(s))});});
  checks.fixture=info;assert(info.temporary_copy.includes('wizard-pin-'));assert(new URL(info.url).hostname==='localhost');
  browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'});
  await context.tracing.start({screenshots:true,snapshots:true});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(info.url);frame=await appFrame();await frame.waitForSelector('.wb-home');
  await frame.waitForFunction(()=>document.querySelector('[data-offline-status]')?.textContent.startsWith('Ready offline'),null,{timeout:600000});
  checks.shellReady=await page.evaluate(()=>WizOfflineSession.ready);assert(checks.shellReady);
  checks.workers=await page.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,script:r.active?.scriptURL,state:r.active?.state})));
  assert.equal(checks.workers.length,2);assert(checks.workers.every(r=>r.state==='activated'));
  assert(await frame.evaluate(()=>navigator.serviceWorker.controller?.scriptURL.endsWith('/wisdom/sw.js')),'pinned Wisdom frame is controlled (not unregistered on load)');
  const data=await frame.evaluate(async()=>await(await fetch('api/wisdom')).json());checks.onlineCollections=data.collections.length;assert.equal(data.collections.length,35);
  await page.evaluate(async()=>{const c=await caches.open('sibling-pin-sentinel');await c.put('/sentinel',new Response('untouched'));});
  await page.screenshot({path:path.join(out,'online-ready.png')});
  // Abort ALL browser/worker network, not merely navigator.onLine. Stop the disposable
  // HTTP server too, so a browser routing limitation cannot accidentally supply data.
  let aborted=0;await context.route('**/*',r=>{aborted++;return r.abort('internetdisconnected');});
  await context.setOffline(true);fixture.kill('SIGTERM');await new Promise(resolve=>fixture.once('exit',resolve));
  await page.reload({waitUntil:'domcontentloaded'});frame=await appFrame();await frame.waitForSelector('.wb-home');
  assert(await page.evaluate(()=>!document.querySelector('#desks')),'offline host never paints workspace');
  await frame.locator('.wb-discovery .wb-browse-card').click();await frame.waitForSelector('.wb-browse');
  checks.offlineCollections=await frame.locator('.wb-browse-body .wb-cover').count();assert.equal(checks.offlineCollections,35);
  await page.screenshot({path:path.join(out,'offline-35-collections.png')});
  const byId=new Map(data.entries.map(e=>[e.id,e]));let selected;
  for(const c of data.collections){const e=c.entries.filter(id=>id!==c.overview).map(id=>byId.get(id)).find(e=>e&&(e.art||data.thinkers.find(t=>t.id===e.thinker)?.portrait));if(e){selected={c,e};break;}}
  assert(selected,'chapter with art in the actual copied library');
  const {c,e}=selected;
  await frame.locator(`.wb-browse-body [data-wisdom-route="/collection/${c.id}"]`).first().click();await frame.waitForSelector('.wb-collection');
  await frame.locator(`[data-wisdom-route="/read/${e.id}/${c.id}"]`).first().click();await frame.waitForSelector('.wb-reader');
  await frame.waitForFunction(()=>[...document.querySelectorAll('.wb-reader img')].some(i=>i.complete&&i.naturalWidth>0));
  checks.chapter={collection:c.id,entry:e.id,art:await frame.locator('.wb-reader img').first().evaluate(i=>({src:i.getAttribute('src'),naturalWidth:i.naturalWidth})),words:await frame.locator('.wb-flow').innerText().then(t=>t.split(/\s+/).length)};
  assert(checks.chapter.words>20);await page.screenshot({path:path.join(out,'offline-chapter-with-art.png')});
  await back();await frame.waitForSelector('.wb-collection');checks.nestedBack='chapter → collection';
  for(let i=0;i<6;i++)await back();
  assert.equal(page.url(),info.url);assert(await frame.evaluate(()=>Wisdom.atRoot()));assert(await page.locator('#singleApp iframe').isVisible());checks.rootBackStaysInApp=true;
  checks.skins=[];
  for(const skin of ['grove','tide']){await page.evaluate(s=>WosSkin.set(s),skin);await page.waitForTimeout(250);assert(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'offline-skin-'+skin+'.png')});checks.skins.push(skin);}
  assert.equal(await page.evaluate(async()=>await(await(await caches.open('sibling-pin-sentinel')).match('/sentinel')).text()),'untouched');
  checks.cacheNames=await page.evaluate(()=>caches.keys());assert(checks.cacheNames.every(k=>k.startsWith('wisdom-')||k.startsWith('wizard-os-home-')||k==='sibling-pin-sentinel'));
  checks.abortedRequests=aborted;checks.transport='route-abort all + browser offline + fixture server stopped';checks.errors=errors;assert.deepEqual(errors,[]);
  checks.status='passed';fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
})().catch(async e=>{checks.status='failed';checks.failure={message:e.message,stack:e.stack};checks.errors=errors;if(page)await page.screenshot({path:path.join(out,'FAIL.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(checks,null,2));console.error(e);process.exitCode=1;}).finally(async()=>{if(context){await context.tracing.stop({path:path.join(out,'trace.zip')}).catch(()=>{});await context.close();}if(browser)await browser.close();fixture.kill('SIGTERM');});
