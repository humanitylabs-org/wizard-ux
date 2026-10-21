// Tap = message, long press = command (James, 21 Oct 2026).
// Real fake-mic orb/talk-key capture on Home and Chats list, both shells.
// Transcription and all writes are intercepted fixtures; installed apps/session reads are real.
// Music execution is acknowledged locally to avoid playing production audio.
// Usage: QA_WEB_DIR=<repo> node qa-tap-voice-to-agent.cjs [url]. QA_SERVED=1 disables asset overlay.
const {chromium} = require(process.env.QA_PLAYWRIGHT || 'playwright');
const URL_ = process.argv[2] || 'http://127.0.0.1:8923/wizard-os-home/';
const W = process.env.QA_WEB_DIR || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SAID = 'Google released a new model, Argon. I want you to do a deep dive on the benchmarks';

async function boot(b, desktop = false) {
  const ctx = await b.newContext(desktop ? { viewport: { width: 1440, height: 900 }, serviceWorkers:'block', ignoreHTTPSErrors: true, permissions: ['microphone'] }
    : { viewport: { width: 412, height: 892 }, serviceWorkers:'block', deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = []; const R = { sttDelay: 0, words: SAID, up: 0 };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    if(new URL(u).pathname==='/wizard/v1/apps' && q.method()==='GET'){
      const res=await r.fetch(), data=await res.json();
      data.apps.push({id:'qa-voice-receiver',name:'QA Voice Receiver',url:'/qa-voice-receiver/',kind:'wizard',receives_voice_input:true});
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    }
    if(new URL(u).pathname==='/qa-voice-receiver/')return r.fulfill({status:200,contentType:'text/html',body:`<!doctype html><textarea id="field">Draft: </textarea><script src="/wizard-os-home/core/app-client.js"></script><script>window.received=[];WizardApp.voiceInput.register({snapshot:()=>({label:'QA app voice'}),receive:async (m,authorize)=>{authorize();received.push(m);return {accepted:true,request_id:m.request_id};}});WizardApp.ready({name:'QA Voice Receiver'}).then(()=>window.qaReady=true);</script>`});
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (!process.env.QA_SERVED && W && m && q.method() === 'GET') {
      const f = m[1] || 'index.html', p = require('path').join(W, 'web', f);
      if (require('fs').existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: require('fs').readFileSync(p) });
    }
    if (/\/transcribe$/.test(u) && q.method() === 'POST') { await sleep(R.sttDelay); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: R.words, ms: 5 }) }).catch(() => {}); }
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) { writes.push({ u: '/route', body: q.postData() || '' }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cmd: { route: 'agent' }, ms: 5 }) }); }
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https?:\/\/[^/]+/, ''), body: q.postData() || '', h: q.headers() });
      if (/\/files\/upload$/.test(u)) {
        const mime = q.headers()['x-wizard-mime'] || '', name = q.headers()['x-wizard-filename'] || 'f';
        const id = /^audio\//.test(mime) ? `drop_qavoice${++R.up}` : `drop_qaimg${++R.up}`;
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file: { id, filename: name, mime, bytes: 70 } }) });
      }
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { id: 'qa-fake-session' } }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    }
    if (!['GET','HEAD'].includes(q.method())) return r.fulfill({status:403,contentType:'application/json',body:'{"error":"QA fences every other write"}'});
    if (!new URL(u).pathname.startsWith('/wizard-os-home/') && !new URL(u).pathname.startsWith('/wizard/')) return r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>QA app frame</title>'});
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { const st = String(e.stack || ''); if (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st)) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_ + (desktop ? 'desktop.html?shell=desktop' : '?shell=phone'), { waitUntil: 'commit' });
  if (desktop) { await p.waitForFunction(() => window.__wux && window.__wux.live?.sessions?.length > 2, null, { timeout: 30000 }); await p.waitForTimeout(800); return { ctx, p, writes, errs, R }; }
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.__wos.live.sessions.length > 2, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
  return { ctx, p, writes, errs, R };
}
const runsOf = ws => ws.filter(w => /\/v1\/runs$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
const steersOf = ws => ws.filter(w => /\/v1\/runs\/[^/]+\/steer$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
const sends = ws => [...runsOf(ws), ...steersOf(ws)];
const routes = ws => ws.filter(w => w.u === '/route');
// Focused-field tap is now dictation (qa-in-app-dictation.cjs). This suite explicitly tests AGENT voice.
async function tapOrb(p) {
  await p.evaluate(() => { if (__wos.voice === 'idle') document.activeElement?.blur(); });
  const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2);
}
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(200); } return null; };


const phrases = [SAID, 'Search for flights to Bangkok and book the cheapest', 'Music', 'play Home Tides', 'open calendar', 'Ask AI why is the sky blue', 'food', 'navigate to Bangkok', 'next desk', 'help'];
(async () => {
 const b = await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 for (const desktop of (process.env.QA_SHELL ? [process.env.QA_SHELL==='desktop'] : [false,true])) {
  const {ctx,p,writes,errs,R}=await boot(b,desktop);
  await p.evaluate(() => {
   window.__qaActions=[];
   const ex=WosCommands.execute;WosCommands.execute=(c,...args)=>{__qaActions.push(c.action);return ex(c,...args);};
   if(window.WosMusic) WosMusic.run=(c,done)=>{done?.(true);return true;};
  });
  for(const where of (process.env.QA_RECEIVER_ONLY?[]:['home','list'])) for(const phrase of phrases.slice(0,Number(process.env.QA_LIMIT)||phrases.length)) {
   R.words=phrase;
   await p.waitForFunction(d => (d ? __wux.voice : __wos.voice) === 'idle', desktop, {timeout:20000});
   await p.evaluate(({desktop,where})=>{
    const x=desktop?__wux:__wos;
    if(!desktop)x.closeSheets(true);else x.closePalette();
    while(x.links?.isOpen())x.links.close();
    for(const id of Object.keys(x.wins)) if(x.wins[id].app!=='chats') x.closeWin(id);
    const chat=Object.values(x.wins).find(w=>w.app==='chats');
    if(desktop){ if(where==='home')x.goHome();else {x.goWs(x.ws.findIndex(d=>d.wins.includes(chat.id)));chat.thread=null;x.chats.openChat(chat.id,null);x.focusWin(chat.id);} }
    else {if(where==='home')x.goDesk(x.HOME,true);else {x.goDesk(x.desks.findIndex(d=>d.wins.includes(chat.id)),true);x.openChat(chat.id,null);x.focusWin(chat.id);}}
    document.activeElement?.blur();window.__qaActions=[];
   },{desktop,where});
   await sleep(450);writes.length=0;
   ok(await p.evaluate(({desktop,where})=>{const x=desktop?__wux:__wos;if(where==='home')return desktop?x.homeOpen:x.idx===x.HOME;const d=(desktop?x.ws:x.desks)[desktop?x.cur:x.idx],w=x.wins[d.focus];return (!desktop||!x.homeOpen)&&w?.app==='chats'&&!w.thread;},{desktop,where}),`${desktop?'desktop':'phone'} capture starts on ${where}`);
   if(desktop)await p.keyboard.press('MetaRight');else await tapOrb(p);
   await p.waitForFunction(d=>(d?__wux.voice:__wos.voice)==='listen',desktop,{timeout:20000});
   await sleep(1500);
   if(desktop)await p.keyboard.press('MetaRight');else await tapOrb(p);
   await until(()=>sends(writes).length || p.evaluate(()=>__qaActions.length),15000);await sleep(500);
   const label=`${desktop?'desktop talk key':'phone tap'} ${where} ${JSON.stringify(phrase)}`;
   const actions=await p.evaluate(()=>__qaActions);
   ok(actions.length===0,label+' zero local actions',actions);
   ok(routes(writes).length===0,label+' zero router calls',routes(writes));
   const all=sends(writes);ok(all.length===1&&(all[0].input||'').includes(phrase),label+' exactly one agent write with transcript',all.length?all:await p.evaluate(d=>({voice:(d?__wux:__wos).voice,tx:document.querySelector('#txText')?.textContent,unsent:(d?__wux:__wos).outbox.unsent().map(x=>({state:x.state,error:x.error,text:x.text}))}),desktop));
   if(!desktop)ok(await p.locator('#txChips [data-hold]').count()===0,label+' no hold card');
   await p.evaluate(async desktop=>{const x=desktop?__wux:__wos;for(const it of x.outbox.unsent())await x.outbox.remove(it.id);},desktop);
  }
  // Same transcripts on explicit command surfaces still execute the grammar.
  for(const phrase of (process.env.QA_RECEIVER_ONLY?[]:phrases.filter(t=>!['food','help'].includes(t)))){
   writes.length=0;await p.evaluate(()=>window.__qaActions=[]);
   if(desktop)await p.evaluate(t=>__wux.localCommand(t),phrase);
   else await p.evaluate(t=>__wos.handleText(t,'command',false,0,null),phrase);
   await sleep(100);
   ok((await p.evaluate(()=>__qaActions.length))===1,`${desktop?'desktop explicit':'phone held'} ${JSON.stringify(phrase)} executes command`);
   ok(sends(writes).length===0,'explicit command does not message the agent');
  }
  // Installed, registered app-owned input is delivery, not command parsing.
  await p.evaluate(d=>{const x=d?__wux:__wos;if(!d)x.closeSheets(true);while(x.links?.isOpen())x.links.close();x.openApp(WizCore.apps(d?'desktop':'mobile').APP['qa-voice-receiver']);},desktop);
  const frame=await until(()=>p.frames().find(f=>f.url().includes('/qa-voice-receiver/')));
  await frame.waitForFunction(()=>window.qaReady);
  R.words='open calendar';writes.length=0;await p.evaluate(()=>window.__qaActions=[]);
  await p.evaluate(d=>{document.activeElement?.blur();return d?__wux.talk('start'):__wos.startVoice('auto');},desktop);
  await sleep(1200);await p.evaluate(d=>d?__wux.talk('send'):__wos.finishVoice(),desktop);
  await frame.waitForFunction(()=>received.length===1);
  ok(await frame.evaluate(()=>received[0].text==='open calendar'),`${desktop?'desktop':'phone'} registered app receives command-shaped transcript exactly once`);
  ok(sends(writes).length===0&&routes(writes).length===0&&(await p.evaluate(()=>__qaActions.length))===0,'registered app delivery bypasses agent, commands and router');
  // Focused-field dictation is also deliberately not a command.
  await p.waitForFunction(d=>(d?__wux.voice:__wos.voice)==='idle',desktop);
  await frame.locator('#field').focus();R.words='play Home Tides';writes.length=0;
  await p.evaluate(d=>d?__wux.dictate('start'):__wos.startVoice('dictation'),desktop);await sleep(1200);
  await p.evaluate(d=>d?__wux.dictate('send'):__wos.finishVoice(),desktop);
  await frame.waitForFunction(()=>document.querySelector('#field').value.includes('play Home Tides'));
  ok((await frame.locator('#field').inputValue()).includes('play Home Tides'),`${desktop?'desktop':'phone'} focused-field dictation inserts command-shaped text`);
  ok(sends(writes).length===0&&routes(writes).length===0&&(await frame.evaluate(()=>received.length))===1,'dictation neither sends nor runs commands');
  ok(errs.length===0,`${desktop?'desktop':'phone'} no page errors`,errs);
  if(process.env.QA_SHOTS)await p.screenshot({path:process.env.QA_SHOTS+`/tap-agent-${desktop?'desktop':'phone'}.png`});
  await ctx.close();
 }
 console.log(`\n${pass}/${pass+fail} passed`);await b.close();process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
