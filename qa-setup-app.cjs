// Setup host integration: shared phone-connect UI, first-run lifecycle, nested Back and two-skin frame continuity.
// Run against tools/fake-setup-api.cjs. State-machine/timeout coverage also lives in tests/phone-connect*.test.mjs.
const pw = require('./tools/qa-playwright.cjs');
const jsQR = require(process.env.QA_JSQR || 'jsqr');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:9473/wizard-os-home/';
const ORIGIN = new URL(BASE).origin;
const SHOTS = process.env.QA_SHOTS || path.join(process.env.TMPDIR || process.cwd(), 'setup-app-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const results = [];
const ok = (c, name, detail = '') => { results.push({ ok: !!c, name, detail }); c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', name, detail); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fake = async body => (await fetch(ORIGIN + '/__fake/state', { method:'POST', body:JSON.stringify(body) })).json();
const reset = async () => (await fetch(ORIGIN + '/__fake/reset', { method:'POST' })).json();
const log = async () => (await fetch(ORIGIN + '/__fake/log')).json();
const count = (items, method, p, since = 0) => items.filter(e => e.method === method && e.path === p && e.t >= since).length;
const URLS = { wiz:'https://wizard.tail1234.ts.net/', auth:'https://login.tailscale.com/a/example-sign-in' };
async function context(browser, mode) {
  const ctx = await browser.newContext(mode === 'phone' ? {viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'} : {viewport:{width:1440,height:900},deviceScaleFactor:1});
  await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin:ORIGIN});
  const outside = [], errors = [];
  await ctx.route('**/*', r => new URL(r.request().url()).origin === ORIGIN ? r.continue() : (outside.push(r.request().url()), r.fulfill({status:200,body:'<!doctype html><title>external fixture</title>'})));
  await ctx.addInitScript(mode => { localStorage.setItem('wux.shell',mode); localStorage.setItem('wos.coached','true'); localStorage.setItem('wos.tour.v1','true'); },mode);
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  return {ctx,p,outside,errors};
}
async function frame(p) {
  await p.waitForFunction(() => !!document.querySelector('iframe[src*="setup/"]'));
  const f = p.frames().find(f => /\/setup\/(?:index.html)?(?:[?#]|$)/.test(f.url()));
  await f.waitForFunction(() => !!window.__setup); return f;
}
const text = (f,s) => f.locator(s).innerText();
async function open(p,mode) { await p.evaluate(mode => (mode === 'phone' ? __wos : __wux).openApp(WizCore.apps(mode === 'phone' ? 'mobile' : 'desktop').APP.setup),mode); return frame(p); }
async function phone(f) { await f.locator('[data-act="open-phone"]').click(); }
async function step(f,s) { await f.waitForFunction(s => __setup.phone.view?.step === s,s); }
async function change(f,data,s) { await f.locator('[data-act="back"]').click(); await fake(data); await phone(f); if(s) await step(f,s); }
async function pick(p,id) {
  const family = await p.evaluate(id => WosSkin.familyOf(id),id);
  const card = p.locator(`[data-skinfamily="${family}"]:visible`).first();
  if(await card.count() && await card.getAttribute('aria-pressed') !== 'true') await card.click();
  const palette = p.locator(`[data-skinpick="${id}"]:visible`).first();
  if(await palette.count()) await palette.click();
  await p.waitForFunction(id => WosSkin.current === id,id);
  await p.locator('.mz-intro').waitFor({state:'detached'});
}
async function decode(browser,el) {
  const png = await el.screenshot(), p = await browser.newPage();
  const data = await p.evaluate(async b => { const i=new Image();i.src='data:image/png;base64,'+b;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return {w:i.width,h:i.height,d:[...x.getImageData(0,0,i.width,i.height).data]}; },png.toString('base64'));
  await p.close(); return jsQR(new Uint8ClampedArray(data.d),data.w,data.h)?.data;
}
(async()=>{
 const b = await pw.chromium.launch();
 for(const mode of ['phone','desktop']) {
  await reset(); await fake({owner:'Robin'});
  const {ctx,p,outside,errors} = await context(b,mode);
  await p.goto(BASE+(mode === 'desktop' ? 'desktop.html?shell=desktop' : '?shell=phone'));
  const f = await frame(p);
  await f.waitForFunction(() => document.querySelector('.greet'));
  ok((await text(f,'.greet')).includes('Make this Wizard yours.'),`${mode}: first-run Setup greets the owner`);
  await f.waitForFunction(() => __setup.state.seenPosted);
  await sleep(300);
  ok(count(await log(),'POST','/wizard/v1/setup/seen')===1,`${mode}: first-run seen posted exactly once`);
  if(mode==='phone') ok(await p.evaluate(()=>{ const w=Object.values(__wos.wins).find(w=>w.appId==='setup'); return __wos.desks[__wos.idx]?.wins.includes(w.id); }), 'phone: Setup is on the visible desk');
  await phone(f); await step(f,'off');
  ok(await f.locator('[data-pc="start"]').innerText()==='Connect a device',`${mode}: off renders shared Connect control, not removed step markup`);
  await f.locator('[data-pc="start"]').click(); await step(f,'signin');
  await f.waitForFunction(()=>document.querySelector('[data-pc="open"]')?.textContent==='Open again');
  ok(outside.filter(u=>u===URLS.auth).length===1,`${mode}: sign-in opens outside once`);
  ok(!(await f.locator('.step').count()),`${mode}: Setup uses the shared component, no private step UI`);
  await change(f,{phone:{step:'https'}},'https');
  ok((await text(f,'[data-phone-connect]')).includes('HTTPS'),`${mode}: HTTPS guidance`);
  await change(f,{phone:{step:'serving'}},'serving');
  if(mode==='desktop') {
   await f.waitForFunction(()=>document.querySelector('.pc-qr')?.dataset.drawn);
   ok(await decode(b,f.locator('.pc-qr'))==='wizard://connect?origin='+encodeURIComponent(new URL(URLS.wiz).origin),'desktop: rendered QR decodes to native Connect URI');
  } else ok(await f.locator('.pc-qr').count()===0 && await f.locator('[data-pc="out"]').first().isVisible(),'phone: address instead of QR');
  await f.locator('[data-pc="copy"]').first().click();
  ok(await f.evaluate(()=>navigator.clipboard.readText())===new URL(URLS.wiz).origin,`${mode}: Copy uses plain HTTPS origin`);
  await change(f,{phone:{step:'phone_seen'}},'phone_seen');
  ok((await text(f,'.pc-ok')).includes('connected'),`${mode}: connected state`);
  await f.locator('[data-pc="again"]').click();
  ok(await f.locator('[data-pc-flow]').isVisible(),`${mode}: Connect another device opens the shared flow`);
  await f.locator('[data-pc="flow-close"]').click();
  await f.locator('[data-act="menu"]').click();
  if(mode==='phone') { await p.evaluate(()=>window.__wosNativeBack()); ok(await f.locator('#menu').isHidden(),'phone: Back closes menu only'); await f.locator('[data-act="menu"]').click(); }
  await f.locator('[data-act="ask-reset"]').click();
  await f.evaluate(()=>{window.__qaIdentity='setup-kept';});
  if(mode==='phone') {
   for(const skin of ['nebula','obsidian-light']) {
    await p.evaluate(()=>__wos.openSettings('look'));
    await pick(p,skin);
    // One Back only returns Appearance to Settings' category list. Dismiss the outer
    // Settings sheet too before addressing the existing Setup window underneath it.
    for(let i=0;i<3 && await p.locator('#settings').evaluate(e=>e.classList.contains('open'));i++) {
      await p.evaluate(()=>window.__wosNativeBack()); await sleep(250);
    }
    await p.waitForFunction(()=>!document.querySelector('#settings').classList.contains('open'));
    await open(p,mode);
    await f.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
    ok(await f.evaluate(()=>window.__qaIdentity==='setup-kept'&&!document.getElementById('sheet').hidden),`${skin}: document and open disconnect sheet survive skin change`);
    await sleep(600);await p.screenshot({path:path.join(SHOTS,`${mode}-${skin}.jpg`),type:'jpeg',quality:85});
   }
  }
  if(mode==='phone') { await p.evaluate(()=>window.__wosNativeBack()); await f.waitForFunction(()=>document.getElementById('sheet').hidden); } else await f.locator('[data-act="cancel-reset"]').click();
  ok(await f.locator('#sheet').isHidden(),`${mode}: dismiss disconnect without leaving phone screen`);
  await f.locator('[data-act="menu"]').click();await f.locator('[data-act="ask-reset"]').click();await f.locator('[data-act="reset"]').click();await step(f,'off');
  ok(count(await log(),'POST','/wizard/v1/setup/phone/reset')===1,`${mode}: confirmed disconnect resets once`);
  for(const code of [401,403,404]) {
   await change(f,{fail:{'/wizard/v1/setup/phone':code}});
   await f.waitForFunction(code=>__setup.phone.status===(code===404?'missing':'denied'),code);
   ok((await text(f,'[data-phone-connect]')).includes(code===404?'isn’t available':'owner'),`${mode}: ${code} explained by shared component`);
  }
  await change(f,{fail:{},phone:{step:'unavailable'}},'unavailable');
  ok(await f.locator('[data-pc="start"]').count()===0,`${mode}: unavailable offers no dead control`);
  await f.locator('[data-act="back"]').click();await sleep(300);const at=Date.now();await sleep(2300);
  ok(count(await log(),'GET','/wizard/v1/setup/phone',at)===0,`${mode}: no polling on checklist`);
  ok(errors.length===0,`${mode}: no page errors`,errors);
  await p.reload();await sleep(2200);
  ok(!p.frames().some(f=>/\/setup\/index.html/.test(f.url())),`${mode}: second launch does not auto-open Setup`);
  await ctx.close();
 }
 await b.close(); console.log(`${pass} passed, ${fail} failed`);
 if(process.env.QA_RECEIPT)fs.writeFileSync(process.env.QA_RECEIPT,JSON.stringify({suite:'qa-setup-app',base:BASE,pass,fail,results},null,2));
 process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
