// Browser QA for the browser owner boundary, slice 23 (wizard-os#133): a sandboxed app records again. Real Chromium: a
// shell page with the boundary on (WizShellBoundary set the way shell-token.js does), the real core/browser-boundary.js
// and core/app-services.js, and app pages in sandboxed frames that load the real core/app-client.js and use
// WizardApp.capture. The shell's recorder (core/app-capture.js) is a stand-in that records which app id it was asked
// for and plays a short take (levels, PCM, a WAV chunk).
//  - Without a tap in the app, nothing records (the recorder is never asked).
//  - A real tap starts a recording for the window's installed app id; levels, PCM and chunks reach the app; getInfo,
//    current(), Stop, pending and ack work, and the take's audio arrives as a Blob the app can read.
//  - A recording prepared in a tap starts after the app's own slow work (the tap itself has expired by then).
//  - A reload of the window does not stop the recorder; the new page gets no events until it attaches, then does.
//  - A page outside its window's app path can't record or read takes, even with a real tap.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-capture.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
const APP = who => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{font:14px system-ui;margin:8px}button{font:inherit}</style></head>
<body><button id="rec">Record</button> <button id="prep">Prepare</button> <span id="t">${who}</span><script>
  window.out = { levels: [], pcm: [], chunks: [], states: [] };
  const say = s => { document.getElementById('t').textContent = '${who}: ' + s; };
  const code = e => String((e && e.message) || e);
  const follow = s => { s.onLevel(v => out.levels.push(v)); s.onPcm(f => out.pcm.push(f.pcm && f.pcm.byteLength)); s.onChunk(c => out.chunks.push({ seq: c.seq, blob: c.blob instanceof Blob, size: c.blob && c.blob.size }));
    s.onState(v => out.states.push(v)); };
  window.record = async () => {
    try { const s = window.session = await WizardApp.capture.start({ kind: 'audio', pcm: true, onPcm() {}, meta: { note: 'n1' } }); follow(s); out.started = s.id; say('recording'); }
    catch (e) { out.started = 'error:' + code(e); say(out.started); }
  };
  document.getElementById('rec').onclick = () => { window.recording = record(); };
  document.getElementById('prep').onclick = () => { window.warm = WizardApp.capture.prepare({ kind: 'audio', pcm: true }); out.prepared = !!window.warm.id; };
  window.later = async () => {
    try { const s = window.session = await WizardApp.capture.start({ kind: 'audio', pcm: true, preparedId: window.warm.id }); follow(s); return s.id; }
    catch (e) { return 'error:' + code(e); }
  };
  window.untapped = async () => { try { return (await WizardApp.capture.start({ kind: 'audio' })).id; } catch (e) { return 'error:' + code(e); } };
  window.finish = async () => {
    const info = window.session.getInfo(), current = WizardApp.capture.current();
    const take = await window.session.stop();
    const pending = await WizardApp.capture.pending();
    const text = pending[0] && pending[0].blob ? await pending[0].blob.text() : null;
    let acked; try { await WizardApp.capture.ack(take.id); acked = true; } catch (e) { acked = 'error:' + code(e); }
    say('saved ' + take.durationMs + ' ms');
    return { info, current, take: { id: take.id, blob: take.blob instanceof Blob, size: take.blob.size, meta: take.meta }, pending: pending.length, text, acked, after: (await WizardApp.capture.pending()).length };
  };
  window.reattach = async () => { const s = window.session = await WizardApp.capture.attach(); if (s) follow(s); return s && s.id; };
  window.steal = async () => { try { return JSON.stringify(await WizardApp.capture.pending()); } catch (e) { return 'error:' + code(e); } };
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>
  const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.shellLog = { asked: [] };
  // The shell's recorder (core/app-capture.js), stand-in: one take at a time, keyed by the app id the shell sends.
  let active = null; const takes = new Map(), preps = new Map();
  const changed = () => dispatchEvent(new CustomEvent('wizard-app-capture-state'));
  const wav = () => new Blob(['RIFF-fixture-audio'], { type: 'audio/wav' });
  function session(s) {
    const on = key => fn => { s.l[key].add(fn); return () => s.l[key].delete(fn); };
    return Object.freeze({ id: s.id, reattached: () => !!s.reattached,
      getInfo: () => ({ phase: s.phase, paused: false, durationMs: s.ms, meta: s.meta, hasSystemAudio: false }),
      onLevel: on('level'), onPcm: on('pcm'), onChunk: on('chunk'), onState: on('state'), onWarn: on('warn'),
      chunks: async () => [], setSystemAudio: async () => false, pause: async () => {}, resume: async () => {},
      stop: async () => { clearInterval(s.timer); s.phase = 'stopped'; active = null; const t = { id: s.id, blob: wav(), mime: 'audio/wav', startedAt: s.at, durationMs: s.ms, meta: s.meta, streamChunks: [] };
        takes.set(s.id, { appId: s.appId, t }); changed(); return t; },
      cancel: async () => { clearInterval(s.timer); active = null; changed(); } });
  }
  window.WizAppCapture = Object.freeze({ version: 1,
    getState: () => ({ active: !!active, appId: active && active.appId }),
    capabilities: o => ({ native: null, pcm: true, pause: true, systemAudio: false, systemAudioStart: false, kind: o.kind }),
    current: appId => active && active.appId === appId ? { id: active.id, appId, active: true, recording: true, startedAt: active.at, meta: active.meta, phase: 'recording' } : null,
    prepare: (appId, o) => { shellLog.asked.push(['prepare', appId]); const id = 'prep-' + preps.size; preps.set(id, appId); return Object.freeze({ id, release: () => preps.delete(id) }); },
    start: async (appId, o) => {
      shellLog.asked.push(['start', appId, o.preparedId || null, typeof o.onPcm]);
      if (o.preparedId && preps.get(o.preparedId) !== appId) throw new Error('prepared for another app');
      preps.delete(o.preparedId);
      const s = { id: 'take-' + (shellLog.asked.length), appId, at: Date.now(), ms: 0, phase: 'recording', meta: o.meta || {}, l: { level: new Set(), pcm: new Set(), chunk: new Set(), state: new Set(), warn: new Set() } };
      active = s; changed();
      let n = 0;
      s.timer = setInterval(() => { n++; s.ms += 100; for (const f of s.l.level) f(n / 10); for (const f of s.l.pcm) f({ pcm: new Int16Array(4000).buffer, startMs: s.ms, source: 'me' });
        if (n % 5 === 0) for (const f of s.l.chunk) f({ id: s.id, seq: n / 5 - 1, blob: wav(), startMs: s.ms, source: 'me' }); }, 100);
      s.api = session(s); return s.api;
    },
    attach: async appId => { shellLog.asked.push(['attach', appId]); if (!active || active.appId !== appId) return null; active.reattached = true; return active.api; },
    settle: async () => [],
    pending: async appId => { shellLog.asked.push(['pending', appId]); return [...takes.values()].filter(x => x.appId === appId).map(x => x.t); },
    ack: async (appId, id) => { shellLog.asked.push(['ack', appId]); const x = takes.get(id); if (!x || x.appId !== appId) throw new Error('not_found'); takes.delete(id); },
  });
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } };
  window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{font:14px system-ui}iframe{width:520px;height:46px;border:1px solid #888;display:block}</style></head>
<body><div class="win" id="w1"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<div class="win" id="w2"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/evil/"></iframe></div>
<button id="shellbtn">Shell</button>
<script>
  const [a, b] = document.querySelectorAll('iframe');
  WizAppServices.attach(a, { appId: 'notes', path: '/notes/', isVisible: () => true, isFront: () => true });
  // The second window claims to be "other" but its frame shows a page outside that app's path.
  WizAppServices.attach(b, { appId: 'other', path: '/other/', isVisible: () => true, isFront: () => true });
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = body => { res.setHeader('content-type', 'text/html'); res.end(body); };
  if (u.pathname === '/') return html(SHELL);
  if (u.pathname === '/notes/') return html(APP('Notes'));
  if (u.pathname === '/evil/') return html(APP('Evil'));
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 560, height: 150 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const frameOf = p => page.frames().find(fr => new URL(fr.url()).pathname === p);
  const allReady = () => page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(f => WizBrowserBoundary.ready(f)), null, { timeout: 6000 }).catch(() => {});
  await allReady();
  const notes = () => frameOf('/notes/'), log = () => page.evaluate(() => JSON.parse(JSON.stringify(shellLog)));
  ok(await notes().evaluate(() => self.origin) === 'null', 'the app page is opaque');
  if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-before.png') });
  // No tap: a page alone can't switch the microphone on.
  await page.click('#shellbtn');
  const untapped = await notes().evaluate(() => untapped());
  ok(/^error:.*tap/.test(untapped) && (await log()).asked.length === 0, 'without a tap in the app nothing records: ' + untapped);
  // A real tap in the app window.
  await notes().click('#rec');
  await notes().evaluate(() => window.recording);
  await page.waitForTimeout(1300);
  let out = await notes().evaluate(() => out);
  let l = await log();
  ok(/^take-/.test(out.started) && JSON.stringify(l.asked[0]) === '["start","notes",null,"undefined"]', 'a tap starts a recording for the window\'s app id (no page callback reaches the recorder): ' + JSON.stringify({ started: out.started, asked: l.asked }));
  ok(out.levels.length >= 5 && out.pcm.length >= 5 && out.pcm.every(n => n === 8000), 'levels and PCM reach the app: ' + JSON.stringify({ levels: out.levels.length, pcm: out.pcm.slice(0, 3) }));
  ok(out.chunks.length >= 1 && out.chunks.every(c => c.blob && c.size === 18), 'chunks arrive as audio Blobs: ' + JSON.stringify(out.chunks));
  if (SHOT) await page.screenshot({ path: SHOT });
  const done = await notes().evaluate(() => finish()).catch(e => ({ error: String(e).split('\n')[0], info: {}, take: {} }));
  ok(done.info.phase === 'recording' && done.info.durationMs >= 500 && done.current?.id === out.started && done.current?.recording === true,
    'getInfo and current() show the running recording: ' + JSON.stringify({ info: done.info, current: done.current }));
  ok(done.take.id === out.started && done.take.blob && done.take.size === 18 && done.take.meta?.note === 'n1', 'Stop gives the take with its audio: ' + JSON.stringify(done.take));
  ok(done.pending === 1 && done.text === 'RIFF-fixture-audio' && done.acked === true && done.after === 0, 'pending lists the take, its audio is readable, ack clears it: ' + JSON.stringify(done));
  // Prepared in a tap, started after the tap expired (the app's own slow work in between).
  await notes().click('#prep');
  await page.waitForTimeout(400);
  await page.click('#shellbtn');
  await page.waitForTimeout(5600);
  const later = await notes().evaluate(() => later()).catch(e => 'error:' + String(e).split('\n')[0]);
  l = await log();
  ok(/^take-/.test(later) && l.asked.some(x => x[0] === 'prepare' && x[1] === 'notes') && l.asked.some(x => x[0] === 'start' && /^prep-/.test(String(x[2]))), 'a recording prepared in a tap starts after the app\'s slow work: ' + JSON.stringify({ later, asked: l.asked.slice(-2) }));
  // The shell reloads the window: the recorder keeps going, the new page hears nothing until it attaches.
  await page.evaluate(() => { document.querySelector('#w1 iframe').src = '/notes/?r=1'; });
  await page.waitForFunction(() => document.querySelector('#w1 iframe').contentWindow && WizBrowserBoundary.ready(document.querySelector('#w1 iframe')), null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(700);
  const reloaded = frameOf('/notes/');
  const still = await page.evaluate(() => WizAppCapture.getState().active);
  const quiet = await reloaded.evaluate(() => ({ heard: out.levels.length, current: WizardApp.capture.current() }));
  ok(still === true && quiet.heard === 0 && quiet.current && quiet.current.id === later, 'a reload does not stop the recording; the new page sees it as current but hears nothing yet: ' + JSON.stringify({ still, quiet }));
  const again = await reloaded.evaluate(() => reattach()).catch(e => 'error:' + String(e).split('\n')[0]);
  await page.waitForTimeout(600);
  const heard = await reloaded.evaluate(() => out.levels.length);
  ok(again === later && heard >= 3, 'after attach() the new page follows the same recording: ' + JSON.stringify({ again, heard }));
  await reloaded.evaluate(() => window.session && window.session.stop()).catch(() => {});
  // The page outside its window's app path: refused even with a real tap; the recorder is never asked for it.
  const before = (await log()).asked.length;
  await frameOf('/evil/').click('#rec');
  await frameOf('/evil/').evaluate(() => window.recording);
  const evil = await frameOf('/evil/').evaluate(async () => ({ started: out.started, pending: await steal() }));
  l = await log();
  ok(/^error:/.test(evil.started) && /^error:/.test(evil.pending) && l.asked.length === before && l.asked.every(x => x[1] === 'notes'),
    'a page outside its app\'s path can\'t record or read takes: ' + JSON.stringify({ evil, asked: l.asked.length - before }));
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
