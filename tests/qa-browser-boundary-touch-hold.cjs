// Browser QA for the browser owner boundary, slice 29 (wizard-os#133): hold to record on a touch screen in a sandboxed
// app. The browser counts a touch as a tap only when the finger lifts, so an app that starts recording on touch-down
// (like a messenger's hold-to-talk button) had its start refused ("Recording needs a tap in the app"). Real Chromium
// with real touch input (CDP Input.dispatchTouchEvent): a shell page with the boundary on, the real
// core/browser-boundary.js and core/app-services.js, and an app page in a sandboxed frame that loads the real
// core/app-client.js. The shell's recorder is the same stand-in as tests/qa-browser-boundary-capture.cjs.
//  - Hold: touch-down starts a recording for the window's app; while the finger is down the app gets nothing of it;
//    when the finger lifts the app's Stop gives the take, with the audio recorded during the hold.
//  - A page alone never gets audio: an app that stops a held take itself while the finger is still down (no tap ever
//    came) gets no take, no audio and no pending take; the recording is discarded.
//  - Press to start: after the finger lifts, the app hears the recording live.
//  - A start with no finger down and no tap is still refused, and the recorder is never asked.
// Playwright's evaluate counts as a user gesture (it activates the page), so nothing is evaluated from just before a
// press until after the finger lifts, and each press waits for the last evaluate's activation to expire (5 s).
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-touch-hold.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{font:15px system-ui;margin:8px}button{font:inherit;padding:14px 22px;touch-action:none;user-select:none}#t{display:block;margin-top:8px}</style></head>
<body><button id="hold">Hold to talk</button> <button id="auto">Hold (stops itself)</button> <button id="press">Press to record</button><span id="t">Ready</span><script>
  window.out = { levels: [], pcm: [], chunks: [], warns: [], log: [] };
  const say = s => { document.getElementById('t').textContent = s; };
  const code = e => String((e && e.message) || e);
  const follow = s => { s.onLevel(v => out.levels.push(v)); s.onPcm(f => out.pcm.push(f.pcm && f.pcm.byteLength));
    s.onChunk(c => out.chunks.push({ seq: c.seq, blob: c.blob instanceof Blob })); s.onWarn(w => out.warns.push(String(w))); };
  const begin = async () => {
    try { const s = window.session = await WizardApp.capture.start({ kind: 'audio', pcm: true, meta: { note: 'hold' } }); follow(s); out.started = s.id; say('Recording…'); }
    catch (e) { out.started = 'error:' + code(e); say(out.started); }
  };
  // Hold to talk: record while the finger is down, send on release (a messenger voice note).
  const hold = document.getElementById('hold');
  hold.addEventListener('pointerdown', e => { e.preventDefault(); out.log.push('down:' + e.pointerType + ':' + navigator.userActivation.isActive); window.starting = begin(); });
  hold.addEventListener('pointerup', async () => {
    await window.starting; if (!window.session) return;
    out.heardBeforeLift = out.levels.length + out.pcm.length + out.chunks.length;
    try { const t = await window.session.stop(); out.take = { id: t.id, blob: t.blob instanceof Blob, size: t.blob && t.blob.size, meta: t.meta }; say('Sent a ' + t.durationMs + ' ms voice note'); }
    catch (e) { out.take = 'error:' + code(e); say(out.take); }
  });
  hold.addEventListener('contextmenu', e => e.preventDefault());
  // A page that stops the held take itself, with the finger still down: no tap ever came.
  document.getElementById('auto').addEventListener('pointerdown', e => { e.preventDefault(); window.starting = begin();
    setTimeout(async () => { await window.starting; try { const t = await window.session.stop(); out.take = { id: t.id, size: t.blob && t.blob.size }; } catch (e) { out.take = 'error:' + code(e); }
      try { out.pending = (await WizardApp.capture.pending()).length; } catch (e) { out.pending = 'error:' + code(e); } }, 1000); });
  // Press to record: touch-down starts it, the recording goes on after the finger lifts.
  document.getElementById('press').addEventListener('pointerdown', e => { e.preventDefault(); window.starting = begin(); });
  window.untapped = async () => { try { return (await WizardApp.capture.start({ kind: 'audio' })).id; } catch (e) { return 'error:' + code(e); } };
  window.reset = () => { window.out = { levels: [], pcm: [], chunks: [], warns: [], log: [] }; window.session = null; };
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
<style>body{font:14px system-ui}iframe{width:520px;height:120px;border:1px solid #888;display:block}</style></head>
<body><div class="win" id="w1"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<button id="shellbtn">Shell</button>
<script>
  const [a] = document.querySelectorAll('iframe');
  WizAppServices.attach(a, { appId: 'notes', path: '/notes/', isVisible: () => true, isFront: () => true });
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = body => { res.setHeader('content-type', 'text/html'); res.end(body); };
  if (u.pathname === '/') return html(SHELL);
  if (u.pathname === '/notes/') return html(APP);
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
  const context = await browser.newContext({ viewport: { width: 560, height: 190 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  await page.waitForFunction(() => WizBrowserBoundary.ready(document.querySelector('iframe')), null, { timeout: 6000 }).catch(() => {});
  const app = () => page.frames().find(fr => new URL(fr.url()).pathname === '/notes/');
  const log = () => page.evaluate(() => JSON.parse(JSON.stringify(shellLog)));
  const out = () => app().evaluate(() => JSON.parse(JSON.stringify(out)));
  const quiet = () => page.waitForTimeout(5600); // the last evaluate's user activation expires
  // Where a button is on the screen (no evaluate: Playwright reads the layout).
  const spot = async sel => { const b = await app().locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 1 }] });
  // Hold to talk: finger down, hold 1.5 s, lift.
  const h = await spot('#hold');
  await quiet();
  await touch('touchStart', h);
  await page.waitForTimeout(1500);
  if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-hold.png') });
  await touch('touchEnd', h);
  await page.waitForTimeout(1500);
  let o = await out();
  const asked = (await log()).asked;
  ok(/^take-/.test(o.started) && o.log[0] === 'down:touch:false' && JSON.stringify(asked[0]) === '["start","notes",null,"undefined"]',
    'touch-down (no tap yet) starts a recording for the window\'s app: ' + JSON.stringify({ started: o.started, log: o.log, asked: asked[0] }));
  ok(o.heardBeforeLift === 0, 'while the finger is down the app gets nothing of it yet: ' + o.heardBeforeLift);
  ok(o.take && o.take.id === o.started && o.take.blob && o.take.size === 18 && o.take.meta?.note === 'hold', 'lifting the finger sends the voice note with its audio: ' + JSON.stringify(o.take));
  ok(o.pcm.length >= 10 && o.chunks.length >= 2 && o.warns.length === 0, 'the audio recorded during the hold reaches the app once the finger lifts: ' + JSON.stringify({ pcm: o.pcm.length, chunks: o.chunks.length, warns: o.warns }));
  if (SHOT) await page.screenshot({ path: SHOT });
  await app().evaluate(() => WizardApp.capture.ack(out.take.id)).catch(() => {});
  // The page stops the held take itself while the finger is down: no tap, so no audio, and nothing left to collect.
  await app().evaluate(() => reset());
  const at = await spot('#auto');
  await quiet();
  await touch('touchStart', at);
  await page.waitForTimeout(1800);
  await touch('touchEnd', at);
  await page.waitForTimeout(800);
  o = await out();
  const still = await page.evaluate(() => WizAppCapture.getState().active);
  ok(/^take-/.test(o.started) && /^error:.*tap/.test(o.take) && o.pcm.length === 0 && o.chunks.length === 0 && o.pending === 0 && still === false && /discarded/.test(o.warns.join(' ')),
    'a held take the page stops without a tap is discarded; the page gets no audio: ' + JSON.stringify({ started: o.started, take: o.take, pcm: o.pcm.length, chunks: o.chunks.length, pending: o.pending, active: still, warns: o.warns }));
  // Press to record: the finger lifts at once, the recording goes on and the app hears it live.
  await app().evaluate(() => reset());
  const p = await spot('#press');
  await quiet();
  await touch('touchStart', p); await page.waitForTimeout(250); await touch('touchEnd', p);
  await page.waitForTimeout(900);
  const a = await out();
  await page.waitForTimeout(600);
  const b = await out();
  ok(/^take-/.test(a.started) && b.levels.length > a.levels.length && b.pcm.length > a.pcm.length, 'press to record: after the finger lifts the app hears it live: ' + JSON.stringify({ started: a.started, levels: [a.levels.length, b.levels.length] }));
  await app().evaluate(() => window.session && window.session.stop()).catch(() => {});
  // No finger down, no tap: still refused before the recorder.
  const before = (await log()).asked.length;
  await page.click('#shellbtn');
  const untapped = await app().evaluate(() => untapped());
  ok(/^error:.*tap/.test(untapped) && (await log()).asked.length === before, 'with no finger down and no tap nothing records: ' + untapped);
  ok(await app().evaluate(() => self.origin) === 'null', 'the app page is opaque');
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
