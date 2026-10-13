// Scoped desktop hotkey acceptance. Every backend write is intercepted.
const fs = require('fs');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');
const BASE = process.argv[2];
const OUT = process.env.QA_OUT || '.';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n) => { console.log(c ? 'PASS' : 'FAIL', n); c ? pass++ : fail++; };
(async () => {
 const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
 const ctx = await b.newContext({ viewport:{width:1512,height:920}, ignoreHTTPSErrors:true, permissions:['microphone'], userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36' });
 const writes=[], errors=[];
 await ctx.route('**/*', r => {
  if (!['GET','HEAD'].includes(r.request().method())) { writes.push(r.request().url()); return r.fulfill({status:200,contentType:'application/json',body:'{}'}); }
  return r.continue();
 });
 const p = await ctx.newPage(); p.on('pageerror',e=>errors.push(String(e)));
 await p.addInitScript(()=>localStorage.setItem('wos.coached','true'));
 await p.goto(BASE); await p.waitForFunction(()=>window.__wux?.live?.ok,{},{timeout:45000});
 await p.keyboard.press('AltRight'); await p.waitForTimeout(350);
 ok(await p.evaluate(()=>__wux.voice)==='idle','Right Option is off on a fresh PWA');
 const buttons = await p.locator('[data-hotkey]').count(); ok(buttons===2,'two top-right hotkey switches');
 if(buttons===2) {
  const opt=p.locator('[data-hotkey="AltRight"]'), cmd=p.locator('[data-hotkey="MetaRight"]');
  ok(await opt.getAttribute('aria-pressed')==='false','dictation visibly off');
  ok(await cmd.getAttribute('aria-pressed')==='true','talk shortcut remains on');
  await p.screenshot({path:OUT+'/hotkeys-off.png'});
  await opt.click(); ok(await opt.getAttribute('aria-pressed')==='true','one click enables Right Option');
  await p.keyboard.press('AltRight'); await p.waitForFunction(()=>__wux.voice==='listen');
  ok(await p.evaluate(()=>document.querySelector('#voicePill').classList.contains('dict')),'enabled Option starts dictation');
  await opt.click(); ok(await p.evaluate(()=>__wux.voice)==='listen','turning off a hotkey keeps the current recording');
  ok(await p.locator('#voiceAct').evaluate(e=>e.tagName)==='BUTTON','current take retains an explicit finish button');
  await p.click('#voiceCancel'); await p.waitForFunction(()=>__wux.voice==='idle');
  await p.keyboard.press('AltRight'); await p.waitForTimeout(250); ok(await p.evaluate(()=>__wux.voice)==='idle','disabled Option cannot restart recording');
  const consumed=await p.evaluate(()=>{const a=new KeyboardEvent('keydown',{code:'AltRight',key:'Alt',altKey:true,bubbles:true,cancelable:true}); const z=new KeyboardEvent('keyup',{code:'AltRight',key:'Alt',bubbles:true,cancelable:true}); return [document.dispatchEvent(a),document.dispatchEvent(z)];});
  ok(consumed.every(Boolean),'disabled Option events remain unconsumed');
  await cmd.click(); await p.keyboard.press('MetaRight'); await p.waitForTimeout(250); ok(await p.evaluate(()=>__wux.voice)==='idle','Command can be paused independently');
  await p.reload(); await p.waitForFunction(()=>window.__wux?.live?.ok,{},{timeout:45000});
  ok(await opt.getAttribute('aria-pressed')==='false'&&await cmd.getAttribute('aria-pressed')==='false','both preferences persist after reload');
  await cmd.click(); await p.keyboard.press('MetaRight'); await p.waitForFunction(()=>__wux.voice==='listen'); ok(true,'reenabling Command restores tap-to-talk');
  await p.click('#voiceCancel'); await p.waitForFunction(()=>__wux.voice==='idle');
  await opt.click(); await p.keyboard.down('AltRight'); await p.keyboard.press('KeyC'); await p.keyboard.up('AltRight'); await p.waitForTimeout(200);
  ok(await p.evaluate(()=>__wux.voice)==='idle','Option chord is never a voice tap');
  await p.keyboard.down('AltRight'); await p.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'wux.hotkeys.v1',newValue:JSON.stringify({AltRight:false,MetaRight:true})}))); await p.keyboard.up('AltRight');
  await p.waitForTimeout(200); ok(await p.evaluate(()=>__wux.voice)==='idle','cross-window disable clears an armed tap');
  ok(await opt.getAttribute('aria-pressed')==='false','other-window preference updates the indicator');
  await p.setViewportSize({width:1000,height:720});
  const fit=await p.evaluate(()=>[...document.querySelectorAll('[data-hotkey]')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=24})); ok(fit,'switches remain visible at 1000px');
  await p.screenshot({path:OUT+'/hotkeys-narrow.png'});
 }
 ok(errors.length===0,'no page errors '+errors.join('|')); ok(writes.filter(u=>/v1\/runs/.test(u)).length===0,'zero agent runs');
 console.log(JSON.stringify({pass,fail,errors,writes})); await b.close(); process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exit(1)});
