// QA: text + photos + voice go as ONE message (legacy Wizard H4, composeVoiceTurnText). James (10 Oct 2026):
// "when I paste a link in the text box and I send you a voice note and send them together, they're not being sent
// together. They should both be sent together. The images and the text and the voice note should all be sent
// together." Repro in the run queue: a voice note went in at 13:23:40, the pasted link 21 s later as its own message.
// Usage: QA_WEB_DIR=<repo> node qa-voice-seal.cjs [url]. Real Wizard reads; every write is intercepted.
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const URL_ = process.argv[2] || 'http://127.0.0.1:8923/wizard-os-home/';
const W = process.env.QA_WEB_DIR || '';
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LINK = 'https://hermes-agent.nousresearch.com/docs/reference/automation-blueprints-catalog';
const SAID = 'Google released a new model, Argon. I want you to do a deep dive on the benchmarks';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function boot(b, desktop = false) {
  const ctx = await b.newContext(desktop ? { viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, permissions: ['microphone'] }
    : { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = []; const R = { sttDelay: 0, words: SAID, up: 0 };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (!process.env.QA_SERVED && W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
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
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { const st = String(e.stack || ''); if (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st)) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_ + (desktop ? 'desktop.html' : ''), { waitUntil: 'domcontentloaded' });
  if (desktop) { await p.waitForFunction(() => window.__wux && window.__wux.live?.sessions?.length > 2, null, { timeout: 30000 }); await p.waitForTimeout(800); return { ctx, p, writes, errs, R }; }
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.__wos.live.sessions.length > 2, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
  return { ctx, p, writes, errs, R };
}
const chatsWin = p => p.evaluate(() => __wos.desks[1].wins.find(id => __wos.wins[id].app === 'chats'));
const runsOf = ws => ws.filter(w => /\/v1\/runs$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
const steersOf = ws => ws.filter(w => /\/v1\/runs\/[^/]+\/steer$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
const sends = ws => [...runsOf(ws), ...steersOf(ws)];
const routes = ws => ws.filter(w => w.u === '/route');
const pickThread = p => p.evaluate(() => __wos.live.sessions.filter(s => !s.archived)[0].id);
const draftOf = (p, sid) => p.evaluate(k => JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}')[k] || null, 'direct:' + sid);
const sealedKeys = p => p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}')).filter(k => k.startsWith('sealed:')));
const compose = wid => `[data-chats="${wid}"] .ch-compose`;
// Focused-field tap is now dictation (qa-in-app-dictation.cjs). This suite explicitly tests AGENT voice.
async function tapOrb(p) {
  await p.evaluate(() => { if (__wos.voice === 'idle') document.activeElement?.blur(); });
  const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2);
}
async function openIdle(p, wid, X) {
  await p.evaluate(([w, x]) => { __wos.openChat(w, x); const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, [wid, X]);
  await p.waitForTimeout(700);
}
// Paste the link into the composer, as James did (typed into the textarea, firing input like a paste).
async function pasteLink(p, wid, text = LINK) {
  const ta = p.locator(`${compose(wid)} textarea`);
  await ta.click(); await ta.fill(text); await p.waitForTimeout(200);
}
async function attachShots(p, wid, n = 2) {
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(`${compose(wid)} [data-chattach]`)]);
  await fc.setFiles(Array.from({ length: n }, (_, i) => ({ name: `Screenshot_seal_${i + 1}.png`, mimeType: 'image/png', buffer: PNG })));
  await p.waitForFunction(w => { const c = __wos.chats.ch(w); return (c.files || []).length >= 1 && (c.files || []).every(f => f.id && !f.uploading); }, wid, { timeout: 8000 }).catch(() => {});
  return p.evaluate(w => (__wos.chats.ch(w).files || []).map(f => f.id), wid);
}
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(200); } return null; };


const phrases = [SAID, 'Search for flights to Bangkok and book the cheapest', 'Music', 'play Home Tides', 'open calendar', 'Ask AI why is the sky blue', 'food', 'navigate to Bangkok', 'next desk', 'help'];
(async () => {
 const b = await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 for (const desktop of [false,true]) {
  const {ctx,p,writes,errs,R}=await boot(b,desktop);
  await p.evaluate(() => {
   window.__qaActions=[];
   const ex=WosCommands.execute;WosCommands.execute=(c,...args)=>{__qaActions.push(c.action);return ex(c,...args);};
   if(window.WosMusic) WosMusic.run=(c,done)=>{done?.(true);return true;};
  });
  for(const where of ['home','list']) for(const phrase of phrases) {
   R.words=phrase;
   await p.waitForFunction(d => (d ? __wux.voice : __wos.voice) === 'idle', desktop, {timeout:20000});
   await p.evaluate(({desktop,where})=>{
    const x=desktop?__wux:__wos;
    if(!desktop)x.closeSheets(true);else x.closePalette();
    while(x.links?.isOpen())x.links.close();
    for(const id of Object.keys(x.wins)) if(x.wins[id].app!=='chats') x.closeWin(id);
    if(desktop){ if(where==='home')x.goHome();else {x.openThread(x.live.sessions[0].id);x.escStep();} }
    else {if(where==='home')x.goDesk(x.HOME,true);else {x.openWizardThread(x.live.sessions[0].id);x.onBack();}}
    document.activeElement?.blur();window.__qaActions=[];
   },{desktop,where});
   await sleep(450);writes.length=0;
   if(desktop)await p.keyboard.press('MetaRight');else await tapOrb(p);
   await p.waitForFunction(d=>(d?__wux.voice:__wos.voice)==='listen',desktop,{timeout:20000});
   await sleep(1500);
   if(desktop)await p.keyboard.press('MetaRight');else await tapOrb(p);
   await until(()=>sends(writes).length || p.evaluate(()=>__qaActions.length),15000);await sleep(500);
   const label=`${desktop?'desktop talk key':'phone tap'} ${where} ${JSON.stringify(phrase)}`;
   const actions=await p.evaluate(()=>__qaActions);
   ok(actions.length===0,label+' zero local actions',actions);
   ok(routes(writes).length===0,label+' zero router calls',routes(writes));
   const all=sends(writes);ok(all.length===1&&(all[0].input||'').includes(phrase),label+' exactly one agent write with transcript',all);
   if(!desktop)ok(await p.locator('#txChips [data-hold]').count()===0,label+' no hold card');
   await p.evaluate(async desktop=>{const x=desktop?__wux:__wos;for(const it of x.outbox.unsent())await x.outbox.remove(it.id);},desktop);
  }
  // Same transcripts on explicit command surfaces still execute the grammar.
  for(const phrase of phrases.filter(t=>!['food','help'].includes(t))){
   writes.length=0;await p.evaluate(()=>window.__qaActions=[]);
   if(desktop)await p.evaluate(t=>__wux.localCommand(t),phrase);
   else await p.evaluate(t=>__wos.handleText(t,'command',false,0,null),phrase);
   await sleep(100);
   ok((await p.evaluate(()=>__qaActions.length))===1,`${desktop?'desktop explicit':'phone held'} ${JSON.stringify(phrase)} executes command`);
   ok(sends(writes).length===0,'explicit command does not message the agent');
  }
  ok(errs.length===0,`${desktop?'desktop':'phone'} no page errors`,errs);
  if(process.env.QA_SHOTS)await p.screenshot({path:process.env.QA_SHOTS+`/tap-agent-${desktop?'desktop':'phone'}.png`});
  await ctx.close();
 }
 console.log(`\n${pass}/${pass+fail} passed`);await b.close();process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(2);});
