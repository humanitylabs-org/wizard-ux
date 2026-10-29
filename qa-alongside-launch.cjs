// Synthetic browser regression: real shell/assets; fixture Setup and session APIs, no real agents.
// Run against tools/fake-setup-api.cjs. QA_BASE and QA_SHOTS override the local origin/output.
const {chromium} = require('./tools/qa-playwright.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.QA_BASE || 'http://127.0.0.1:19473/wizard-os-home/';
const shots = process.env.QA_SHOTS || path.join(process.env.TMPDIR || '.', 'alongside-launch-shots');
fs.mkdirSync(shots, {recursive:true});
(async () => {
 const browser = await chromium.launch(); let checks = 0;
 try {
  for (const mode of ['phone','desktop']) for (const historical of [false,true]) {
   const context = await browser.newContext(mode === 'phone' ? {viewport:{width:390,height:844},isMobile:true,hasTouch:true} : {viewport:{width:1440,height:900}});
   const errors=[]; let seen=0;
   // Optional old renderer for a real-browser red/green empty-history regression.
   if (process.env.QA_CHATS_SOURCE) await context.route('**/wizard-os-home/core/chats.js*', route =>
    route.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.QA_CHATS_SOURCE)}));
   await context.addInitScript(shell => localStorage.setItem('wux.shell',shell), mode);
   await context.route('**/wizard/**', async route => {
    const req=route.request(), u=new URL(req.url());
    if(u.pathname === '/wizard/v1/setup') return route.fulfill({json:{first_run:true,launch_mode:'alongside',items:[{id:'phone',title:'Use Wizard on your phone',state:'done',phone_ready:true}]}});
    if(u.pathname === '/wizard/v1/setup/seen') {seen++;return route.fulfill({json:{ok:true}});}
    if(u.pathname === '/wizard/hermes/api/sessions') {
     const rows=[0,...(historical ? [1,3] : [])].map((days,i)=>({id:'qa_launch_'+i,title:'Synthetic launch '+i,source:'api',updated_at:new Date(Date.now()-days*86400000).toISOString(),message_count:1,wizard_status:'completed'}));
     return route.fulfill({json:{data:rows,has_more:false}});
    }
    if(!['GET','HEAD'].includes(req.method())) return route.fulfill({json:{}});
    return route.continue();
   });
   const page = await context.newPage(); page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(base + (mode==='desktop' ? 'desktop.html?shell=desktop' : '?shell=phone'));
   await page.waitForFunction(()=>window.WosSetupLaunch?.log.includes('alongside:quiet'));
   await page.waitForTimeout(800);
   assert.equal(page.frames().some(f=>/\/setup\//.test(f.url())),false); assert.equal(seen,0);
   assert.equal(await page.evaluate(()=>!!window.WosTour?.active || WosSetupLaunch.tourPending),false); checks+=3;
   await page.evaluate(mode=>{const shell=mode==='phone'?__wos:__wux;shell.openApp(WizCore.apps('mobile').APP.setup);},mode);
   await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.contentWindow?.__setup));
   const frame=page.frames().find(f=>/\/setup\//.test(f.url()));
   await frame.locator('[data-act="open-phone"][data-state="done"]').waitFor();
   assert.match(await frame.locator('#list').innerText(),/Ready to open on your phone/); assert.equal(seen,1); checks+=2;
   if(mode==='phone') {
    await frame.locator('[data-act="tour"]').click();
    await page.waitForFunction(()=>WosTour.active); checks++;
    await page.evaluate(()=>WosTour.finish?.());
   }
   await page.evaluate(mode=>{const shell=mode==='phone'?__wos:__wux;shell.openApp(WizCore.apps('mobile').APP.wizard);},mode);
   await page.waitForSelector('[data-chats]'); await page.waitForTimeout(800);
   for(const section of ['yesterday','pastWeek']) {
    const count=await page.locator(`.ch-sec[data-sec="${section}"]`).count();
    assert.equal(count>0,historical,`${mode} ${section} only present with real rows`); checks++;
   }
   await page.screenshot({path:path.join(shots,`${mode}-${historical?'history':'empty'}.png`)});
   assert.deepEqual(errors,[]);checks++;
   console.log('PASS',mode,historical?'history visible':'empty history hidden','quiet launch + optional Setup');
   await context.close();
  }
  console.log('PASS',checks,'browser assertions');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
