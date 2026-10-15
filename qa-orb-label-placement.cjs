// Phone label regression. Synthetic native/STT/API fixtures; ZERO real writes.
// QA_WEB_DIR=<tree> QA_OUT=<evidence directory> node qa-orb-label-placement.cjs
const fs = require('fs'), path = require('path');
// Reuse the established isolated recorder + app fixture without running its suite.
const fixture = fs.readFileSync(path.join(__dirname, 'qa-in-app-dictation.cjs'), 'utf8');
const { chromium, boot, tap, sleep, checks, ok } = new Function('require', '__dirname', fixture.slice(0, fixture.indexOf('async function cases(')) + '\nreturn { chromium, boot, tap, sleep, checks, ok };')(require, __dirname);
const OUT = process.env.QA_OUT;
fs.mkdirSync(OUT, { recursive: true });
async function shot(p, name) { await p.screenshot({ path: path.join(OUT, name + '.png') }); }
async function geometry(p, id, corner = false) {
  return p.evaluate(({id, corner}) => {
    const e = document.getElementById(id), r = e.getBoundingClientRect(), d = dock.getBoundingClientRect(), o = orbWrap.getBoundingClientRect();
    return { inside: r.top >= d.top - 1 && r.bottom <= d.bottom + 1, attached: r.bottom >= o.top && r.top <= o.bottom, onScreen: r.left >= 0 && r.right <= innerWidth, pointer: getComputedStyle(e).pointerEvents, height: r.height, rect: r.toJSON(), dock: d.toJSON() };
  }, { id, corner });
}
async function hold(f, move) {
  const {p, context} = f, r = await p.locator('#orbWrap').boundingBox();
  const x = r.x + r.width/2, y = r.y + r.height/2, c = await context.newCDPSession(p);
  const point = (x,y) => [{ x,y,id: 7 }];
  await c.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:point(x,y)});
  await p.waitForFunction(() => __wos.voice === 'command'); await sleep(120);
  if (move === 'jitter') await c.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:point(x+2,y-2)});
  if (move === 'general') {
    const b = await p.locator('#generalVoice').boundingBox();
    await c.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:point(x,b.y+2)});
  }
  return { c, release: async () => { await c.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]}); await c.detach(); } };
}
(async () => {
 const browser = await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try {
  for (const width of [360,412]) {
   const f=await boot(browser), {p}=f; await p.setViewportSize({width,height:892});
   // Real chat/composer, plus generic button display rule: hidden must still win.
   await p.evaluate(() => { __wos.closeSheets(true); const i=__wos.desks.findIndex(d=>d.wins.some(id=>__wos.wins[id].app==='chats')); __wos.goDesk(i,true); __wos.openChat(__wos.desks[i].wins.find(id=>__wos.wins[id].app==='chats'),'qa-0'); });
   await sleep(450); await p.addStyleTag({content:'button { display: inline-flex; }'});
   ok(!await p.locator('#generalVoice').isVisible(), width+' idle has no persistent general bubble');
   await shot(p, width+'-idle');
   await tap(p); await p.waitForFunction(()=>__wos.voice==='listen'); await sleep(450);
   for(const state of ['listen','paused']) {
    if(state==='paused') { await p.locator('#arcPause').tap(); await p.waitForFunction(()=>__wos.voice==='paused'); }
    const g=await geometry(p,'voiceDestination');
    ok(g.inside&&g.attached&&g.onScreen&&g.height<=20&&g.pointer==='none',width+' '+state+' status attached inside dock',g);
    ok(!await p.locator('#generalVoice').isVisible(),width+' '+state+' no general button');
    const hits=await p.evaluate(()=>['arcCancel','arcPause','orbWrap','arcScreen','arcAttach'].every(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
    ok(hits,width+' '+state+' all five control centers unobstructed');
    await shot(p,width+'-'+state);
   }
   await p.locator('#arcCancel').tap(); await sleep(300);
   for(const move of ['none','jitter']) {
    const h=await hold(f,move); await h.release(); await sleep(900);
    ok(await p.evaluate(()=>__wos.V.kind!=='general'&&__wos.voice!=='listen'),width+' '+move+' hold release remains command');
    await p.evaluate(()=>{__wos.cancelVoice(true);__wos.txHide(0);});
   }
   const h=await hold(f,'general');
   ok(await p.locator('#generalVoice').evaluate(e=>e.classList.contains('selected')),width+' deliberate upward slide selects temporary general target');
   await shot(p,width+'-hold'); await h.release(); await sleep(150);
   ok(await p.evaluate(()=>__wos.voice==='listen'&&__wos.V.snap.general&&!__wos.V.snap.conversation&&__qaNativeStore().active?.kind==='command'),width+' release latches same recorder with general destination');
   ok((await p.locator('#voiceDestination').textContent()).includes('Talking to'),width+' general destination remains readable');
   await shot(p,width+'-general');
   // A long sealed app label: geometry plus full accessible destination text.
   await p.evaluate(()=>{__wos.V.snap.conversation={label:'A very long app destination with a detailed item title'};__wos.setVoice('listen');});
   const g=await geometry(p,'voiceDestination');ok(g.inside&&g.onScreen&&g.height<=20,width+' long app label remains bounded',g);
   ok(await p.locator('#orbWrap').getAttribute('aria-label').then(x=>x.includes('detailed item title')),width+' full destination retained accessibly');
   ok(await p.locator('#voiceDestination').evaluate(e=>getComputedStyle(e).color==='rgb(242, 173, 82)'),width+' app destination semantic color preserved');
   await shot(p,width+'-app');
   await p.evaluate(()=>device.style.setProperty('--safe-b','34px')); const safe=await geometry(p,'voiceDestination');ok(safe.inside&&safe.onScreen,width+' safe area status stays in dock');
   await p.evaluate(()=>{__wos.cancelVoice(true);device.style.removeProperty('--safe-b');const d=__wos.desks[__wos.idx];__wos.setFull(d.focus,true);});await sleep(500);
   await tap(p);await p.waitForFunction(()=>__wos.voice==='listen');
   const corner=await geometry(p,'voiceDestination');ok(corner.inside&&corner.attached&&corner.onScreen,width+' corner status follows orb instead of fixed viewport offset',corner);
   await p.setViewportSize({width,height:540});await sleep(300);const keyboard=await geometry(p,'voiceDestination');ok(keyboard.onScreen&&keyboard.inside,width+' keyboard-sized corner stays anchored');await shot(p,width+'-corner');
   await p.evaluate(()=>{__wos.cancelVoice(true);__wos.onBack();__wos.onBack();});ok(p.url().includes('/wizard-os-home/'),width+' nested and root Back keep shell');
   ok(f.errors.length===0,width+' zero page errors',f.errors);
   await f.context.close();
  }
  // A Wisdom-like full-screen reader with controls at the former bubble coordinates.
  const f=await boot(browser),p=f.p;
  await p.evaluate(()=>{__wos.openApp(window.__qaApp);});await sleep(450);
  await p.evaluate(()=>{const d=__wos.desks[__wos.idx];__wos.setFull(d.focus,true);});await sleep(450);
  ok(!await p.locator('#generalVoice').isVisible(),'immersive app reader has no idle general bubble');
  const frame=p.frames().find(f=>f.url().includes('/qa-iching/'));
  await frame.evaluate(()=>{document.body.innerHTML='<h1>Wisdom reader · synthetic fixture</h1><p>Reading content stays unobstructed.</p><button id="read" style="position:fixed;bottom:112px;left:50%;transform:translateX(-50%);width:220px;height:48px" onclick="window.readerTapped=true">Continue reading</button>';});
  await frame.locator('#read').tap({timeout:2000}).catch(()=>{});ok(await frame.evaluate(()=>window.readerTapped===true),'reader control at former idle bubble position receives real tap');await shot(p,'reader-idle');
  await f.context.close();
 } finally { await browser.close();fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify({checks,pass:checks.filter(x=>x.pass).length,fail:checks.filter(x=>!x.pass).length,limitations:['Synthetic recorder/STT/API; no production sends; long app label uses explicit sealed-state fixture']},null,2)); }
 console.log(checks.filter(x=>x.pass).length+' pass '+checks.filter(x=>!x.pass).length+' fail');process.exitCode=checks.some(x=>!x.pass)?1:0;
})().catch(e=>{console.error(e);process.exitCode=2;});
