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
 const writes=[], payloads=[], errors=[];
 await ctx.route('**/*', r => {
  if (!['GET','HEAD'].includes(r.request().method())) {
   const url=r.request().url(); writes.push(url); payloads.push({url,body:r.request().postData()});
   const body=/transcribe$/.test(url)?{text:'qa hotkey words',ms:5} : /files\/upload$/.test(url)?{file:{id:'drop_qa_hotkey',filename:'voice.webm',mime:'audio/webm',bytes:2000}} : /v1\/runs$/.test(url)?{run_id:'qa-hotkey-run',status:'queued'} : {};
   return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  }
  return r.continue();
 });
 const p = await ctx.newPage(); p.on('pageerror',e=>errors.push(String(e)));
 await p.addInitScript(()=>localStorage.setItem('wos.coached','true'));
 await p.goto(BASE); await p.waitForFunction(()=>window.__wux?.live?.ok,{},{timeout:45000});
 await p.keyboard.press('AltRight'); await p.waitForTimeout(350);
 ok(await p.evaluate(()=>__wux.voice)==='idle','Right Option is off on a fresh PWA');
 const consumed=await p.evaluate(()=>{const a=new KeyboardEvent('keydown',{code:'AltRight',key:'Alt',altKey:true,bubbles:true,cancelable:true});const z=new KeyboardEvent('keyup',{code:'AltRight',key:'Alt',bubbles:true,cancelable:true});return [document.dispatchEvent(a),document.dispatchEvent(z)];});
 ok(consumed.every(Boolean),'paused Right Option remains unconsumed');
 if (process.env.QA_HOTFIX_ONLY) {
  await p.keyboard.press('MetaRight'); await p.waitForFunction(()=>__wux.voice==='listen'); ok(true,'Right Command still starts talk');
  await p.click('#voiceCancel'); await p.waitForFunction(()=>__wux.voice==='idle');
  await p.keyboard.down('MetaRight'); await p.keyboard.press('AltRight'); await p.keyboard.up('MetaRight'); await p.waitForTimeout(250); ok(await p.evaluate(()=>__wux.voice)==='idle','paused Option still disqualifies a Command chord');
  await p.click('#micBtn'); await p.waitForFunction(()=>__wux.voice==='listen'); ok(true,'manual microphone remains available');
  await p.click('#voiceCancel'); await p.waitForFunction(()=>__wux.voice==='idle');
  ok(errors.length===0,'no page errors'); ok(writes.length===0,'zero writes');
  console.log(JSON.stringify({pass,fail,errors,writes})); await b.close(); process.exitCode=fail?1:0; return;
 }
 const buttons = await p.locator('[data-hotkey]').count(); ok(buttons===2,'two top-right hotkey switches');
 if(buttons===2) {
  const opt=p.locator('[data-hotkey="AltRight"]'), cmd=p.locator('[data-hotkey="MetaRight"]');
  ok(await opt.getAttribute('aria-pressed')==='false','dictation visibly off');
  ok(await cmd.getAttribute('aria-pressed')==='true','talk shortcut remains on');
  await p.screenshot({path:OUT+'/hotkeys-off.png'});
  await p.evaluate(()=>{const t=document.createElement('textarea');t.id='qaHotkeyText';t.value='before after';t.style.cssText='position:fixed;top:60px;left:40px;z-index:99';document.body.append(t);t.focus();t.setSelectionRange(7,7);});
  await opt.click(); ok(await opt.getAttribute('aria-pressed')==='true','one click enables Right Option');
  await p.keyboard.press('AltRight'); await p.waitForFunction(()=>__wux.voice==='listen');
  ok(await p.evaluate(()=>document.querySelector('#voicePill').classList.contains('dict')),'enabled Option starts dictation');
  await opt.click(); ok(await p.evaluate(()=>__wux.voice)==='listen','turning off a hotkey keeps the current recording');
  ok(await p.locator('#voiceAct').evaluate(e=>e.tagName)==='BUTTON','current take retains an explicit finish button');
  await p.waitForTimeout(1500); await p.click('#voiceAct'); await p.waitForFunction(()=>__wux.voice==='idle');
  await p.waitForFunction(()=>document.querySelector('#qaHotkeyText').value.includes('qa hotkey words'));
  ok(await p.locator('#qaHotkeyText').inputValue()==='before qa hotkey wordsafter','paused dictation inserts fixture words at the original cursor');
  ok(writes.some(u=>/transcribe$/.test(u))&&!writes.some(u=>/v1\/runs$/.test(u)),'dictation transcribes and admits no agent run');
  await p.evaluate(()=>document.querySelector('#qaHotkeyText').remove());
  await opt.click(); await p.keyboard.press('AltRight'); await p.waitForFunction(()=>__wux.voice==='listen'); await opt.click();
  await p.click('#voiceCancel'); await p.waitForFunction(()=>__wux.voice==='idle');
  await p.keyboard.press('AltRight'); await p.waitForTimeout(250); ok(await p.evaluate(()=>__wux.voice)==='idle','disabled Option cannot restart recording');
  const consumed=await p.evaluate(()=>{const a=new KeyboardEvent('keydown',{code:'AltRight',key:'Alt',altKey:true,bubbles:true,cancelable:true}); const z=new KeyboardEvent('keyup',{code:'AltRight',key:'Alt',bubbles:true,cancelable:true}); return [document.dispatchEvent(a),document.dispatchEvent(z)];});
  ok(consumed.every(Boolean),'disabled Option events remain unconsumed');
  await cmd.click(); await p.keyboard.press('MetaRight'); await p.waitForTimeout(250); ok(await p.evaluate(()=>__wux.voice)==='idle','Command can be paused independently');
  await p.reload(); await p.waitForFunction(()=>window.__wux?.live?.ok,{},{timeout:45000});
  ok(await opt.getAttribute('aria-pressed')==='false'&&await cmd.getAttribute('aria-pressed')==='false','both preferences persist after reload');
  await cmd.click(); await p.keyboard.press('MetaRight'); await p.waitForFunction(()=>__wux.voice==='listen'); ok(true,'reenabling Command restores tap-to-talk');
  await p.waitForTimeout(1500); await cmd.click(); ok(await p.evaluate(()=>__wux.voice)==='listen','pausing Command preserves its active take');
  await p.click('#voiceAct'); await p.waitForFunction(()=>__wux.voice==='idle');
  for(let i=0;i<40&&!writes.some(u=>/v1\/runs$/.test(u));i++) await p.waitForTimeout(100);
  const run=payloads.find(x=>/v1\/runs$/.test(x.url));
  ok(!!run&&JSON.parse(run.body).input.includes('qa hotkey words'),'paused Command take finishes through Send with fixture transcript');
  ok(writes.some(u=>/files\/upload$/.test(u))&&!!run,'recorded audio and agent admission reach intercepted downstream endpoints');
  await cmd.click();
  await opt.click(); await p.keyboard.down('AltRight'); await p.keyboard.press('KeyC'); await p.keyboard.up('AltRight'); await p.waitForTimeout(200);
  ok(await p.evaluate(()=>__wux.voice)==='idle','Option chord is never a voice tap');
  await p.keyboard.down('AltRight'); await p.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'wux.hotkeys.v1',newValue:JSON.stringify({AltRight:false,MetaRight:true})}))); await p.keyboard.up('AltRight');
  await p.waitForTimeout(200); ok(await p.evaluate(()=>__wux.voice)==='idle','cross-window disable clears an armed tap');
  ok(await opt.getAttribute('aria-pressed')==='false','other-window preference updates the indicator');
  await p.setViewportSize({width:1000,height:720});
  const fit=await p.evaluate(()=>[...document.querySelectorAll('[data-hotkey]')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=24})); ok(fit,'switches remain visible at 1000px');
  await p.screenshot({path:OUT+'/hotkeys-narrow.png'});
  await p.evaluate(()=>localStorage.setItem('wux.hotkeys.v1','broken json')); await p.reload(); await p.waitForFunction(()=>__wux?.live?.ok);
  ok(await opt.getAttribute('aria-pressed')==='false'&&await cmd.getAttribute('aria-pressed')==='true','malformed saved preferences fall back safely');
  await opt.focus(); await p.keyboard.press('Enter'); ok(await opt.getAttribute('aria-pressed')==='true','switch is keyboard accessible');
  const other=await ctx.newPage(); await other.goto(BASE); await other.waitForFunction(()=>__wux?.live?.ok);
  await other.locator('[data-hotkey="AltRight"]').click(); await p.waitForTimeout(200);
  ok(await opt.getAttribute('aria-pressed')==='false','real second window synchronizes a toggle'); await other.close();
  await cmd.click(); await p.click('#micBtn'); await p.waitForFunction(()=>__wux.voice==='listen'); ok(true,'manual talk works with talk hotkey paused'); await p.click('#voiceCancel');
  const native=await b.newContext({viewport:{width:1512,height:920},ignoreHTTPSErrors:true});
  await native.route('**/*',r=>['GET','HEAD'].includes(r.request().method())?r.continue():r.fulfill({status:200,body:'{}'}));
  await native.addInitScript(()=>{localStorage.setItem('wos.coached','true'); window.webkit={messageHandlers:{wizardNative:{postMessage(){}}}};});
  const np=await native.newPage(); await np.goto(BASE+'#native'); await np.waitForFunction(()=>window.__wux?.live?.ok);
  ok(await np.locator('#hotkeySwitches').isHidden(),'PWA switches hidden when the native Mac owns global keys');
  await np.keyboard.press('MetaRight'); await np.waitForTimeout(200); ok(await np.evaluate(()=>__wux.voice)==='idle','native Mac key ownership remains untouched'); await native.close();
 }
 ok(errors.length===0,'no page errors '+errors.join('|')); ok(writes.filter(u=>/v1\/runs$/.test(u)).length===1,'exactly one simulated Send admission; all backend writes intercepted');
 console.log(JSON.stringify({pass,fail,errors,writes})); await b.close(); process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exit(1)});
