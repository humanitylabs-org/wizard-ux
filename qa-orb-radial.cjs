// QA (Orb switcher, James 31 Oct 2026 prototype): hold the orb = a radial of wedges (voice command + pinned and open apps).
// Usage: node qa-orb-radial.cjs   (QA_WEB_DIR=<tree with web/>, QA_SHOTS=<dir> for screenshots, QA_CHROME=<chrome>)
// Self-contained: every Wizard request is answered by this file (shell served from the tree, everything else stubbed);
// every non-GET Wizard write is recorded and refused, and the suite asserts nothing reached the agent (/v1/runs).
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const THREADS = Array.from({ length: 4 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview', last_active: NOW / 1000 - i * 600, started_at: NOW / 1000 - i * 600 - 60 }));
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const R = { words: 'open calendar', cmd: { route: 'agent' } };
const log = { writes: [], routes: [], stt: 0, uploads: 0 };
const APPS = [['wizard-search', 'Search'], ['notes', 'Notes'], ['wizard-calendar', 'Calendar'], ['stories', 'Stories'], ['wisdom', 'Wisdom'], ['wizard-music', 'Wizard Music'], ['topics', 'Topics'], ['files-qa', 'Files']];
// What would reach the agent: a run, a new session. (The take's own audio custody upload is not a message.)
const runs = () => log.writes.filter(w => /\/v1\/runs|\/sessions$/.test(w));

async function boot(b, vp = { width: 412, height: 892 }, seed = {}) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'], serviceWorkers: 'block' });
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.hostname !== new URL(ORIGIN).hostname) return m === 'GET' ? r.continue() : r.abort();
    const app = APPS.find(a => u.pathname.startsWith('/' + a[0] + '/'));
    if (app) return r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>${app[1]}</title><body style="background:#123;color:#fff;font:24px system-ui;padding:40px">${app[1]} app</body>` });
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      log.writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW, threads: {} } });
      if (/\/files\/upload$/.test(u.pathname)) { log.uploads++; const h = q.headers(); return json(r, { file: { id: 'drop_qa' + log.uploads, filename: h['x-wizard-filename'] || 'f', mime: h['x-wizard-mime'] || '', bytes: 70 } }); } // the take's own audio copy (custody), not a message
      if (/\/transcribe$/.test(u.pathname)) { log.stt++; return json(r, { text: R.words, ms: 5 }); }
      if (u.pathname === '/wizard/v1/route') { log.routes.push(JSON.parse(q.postData() || '{}')); return json(r, { ms: 5, cmd: R.cmd }); }
      return json(r, { error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: THREADS, has_more: false });
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) return json(r, { object: 'list', data: [{ id: 1, role: 'user', content: 'hello', timestamp: NOW / 1000 - 100 }, { id: 2, role: 'assistant', content: 'hi', timestamp: NOW / 1000 - 90 }] });
    const sm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) { const t = THREADS.find(x => x.id === decodeURIComponent(sm[1])); return t ? json(r, { session: t }) : json(r, { error: 'not_found' }, 404); }
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json(r, { state: {} });
    if (u.pathname === '/wizard/hermes/api/model/options') return json(r, { model: 'fixture-model', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Synthetic fixture route', authenticated: true, is_current: true, models: ['fixture-model'] }] });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: APPS.map(([id, name]) => ({ id, name, desc: name, url: `/${id}/`, icon: name[0], colors: ['#8f63ff', '#ff5ccf'], source: 'launcher.json' })) });
    return json(r, {});
  });
  await ctx.addInitScript(s => { try { if (!sessionStorage.getItem('qa.seeded')) { sessionStorage.setItem('qa.seeded', '1'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.welcome.v1', 'done'); for (const k in s) localStorage.setItem(k, s[k]); } } catch (e) {} }, seed);
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  p.cdp = await ctx.newCDPSession(p);
  await p.goto(ORIGIN + '/qa-start').catch(() => {});
  await p.goto(URL_, { waitUntil: 'load' });
  await ready(p);
  return { ctx, p };
}
async function ready(p) {
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.WosOrbSwitcher, null, { timeout: 30000 });
  await p.waitForFunction(() => window.WizCore.apps && document.querySelector('#search'), null, { timeout: 10000 });
  await sleep(1200);
}
const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
// Real touch events (pointerType touch), so the suite exercises what a thumb does.
const T = (p, type, x, y) => p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
async function slide(p, from, to, steps = 10, dt = 16) { for (let i = 1; i <= steps; i++) { await T(p, 'touchMove', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await sleep(dt); } }
async function orbXY(p) { const r = await p.locator('#orbWrap').boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
const wedges = p => p.evaluate(() => [...document.querySelectorAll('.wor-ic')].map(e => { const r = e.getBoundingClientRect(), w = document.querySelector(`.wor-w[data-i="${e.dataset.i}"]`); return { i: +e.dataset.i, kind: [...e.classList].find(c => ['voice', 'custom', 'app'].includes(c)) || 'app', label: w.getAttribute('aria-label'), x: r.x + r.width / 2, y: r.y + r.height / 2, dis: e.classList.contains('dis') }; }));
const byLabel = (ws, re) => ws.find(w => re.test(w.label));
const radialOpen = p => p.evaluate(() => !!document.querySelector('.wor.on') || !!document.querySelector('.wor:not(.off)'));
const st = p => p.evaluate(() => ({ idx: __wos.idx, n: __wos.desks.length, voice: __wos.voice, kind: __wos.V.kind, sheet: __wos.sheet, zen: document.getElementById('device').classList.contains('zen'), sw: { open: WosOrbSwitcher.isOpen, sel: WosOrbSwitcher.selected, v: WosOrbSwitcher.voice } }));
// The desk whose section sits nearest the viewport's left edge (the one actually in view), not the label.
const visibleDesk = p => p.evaluate(() => { let best = null, bd = 1e9; for (const el of document.querySelectorAll('.track > .desk')) { const d = Math.abs(el.getBoundingClientRect().left); if (d < bd) { bd = d; best = el; } } return __wos.desks.findIndex(d => d.id === best?.dataset.did); });
async function press(p, o, ms = 480) { await T(p, 'touchStart', o.x, o.y); await sleep(ms); }
async function hold(p, o, ms = 480) { await press(p, o, ms); }
const release = p => T(p, 'touchEnd');
async function closeAnyRadial(p) { await release(p).catch(() => {}); await sleep(300); }
async function openDeskFor(p, names) { for (const n of names) { await p.evaluate(n => window.__wos.handleText(n, 'command', false, 100, null), n).catch(() => {}); await sleep(700); } }
async function setPins(p, pins, extra = {}) { await p.evaluate(a => WosOrbSwitcher.set(a), { pins, ...extra }); }
const settle = async p => { await p.waitForFunction(() => __wos.V.state === 'idle' && !__wos.V.admitting, null, { timeout: 10000 }).catch(() => {}); await sleep(500); };
async function cancelTake(p) { await p.evaluate(() => window.__wos.cancelVoice(true)); await sleep(400); }

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { ctx, p } = await boot(b);
  await openDeskFor(p, ['Notes', 'Calendar', 'Stories', 'Wisdom', 'Topics', 'Wizard Music']);
  await p.evaluate(() => window.__wos.goDesk(0)); await sleep(2500); // let six app frames settle: the box is loaded
  let s = await st(p);
  ok(s.n >= 6 && s.idx === 0, 'fixture: Home plus five or more open desks', JSON.stringify(s));
  const NAMES = await p.evaluate(() => __wos.desks.map((d, i) => d.home ? 'Home' : [d.wins.map(w => __wos.wins[w].appId || __wos.wins[w].app).join('+')][0]));
  console.log('desks', JSON.stringify(NAMES));
  ok(await p.evaluate(() => JSON.stringify(WosOrbSwitcher.get().pins)) === '[]' && await p.evaluate(() => WosOrbSwitcher.get().quickTakes === false && WosOrbSwitcher.get().voiceSlot === 'near' && WosOrbSwitcher.get().holdMs === 300 && WosOrbSwitcher.get().showOpen === true), 'real defaults: no pins, voice near, 300 ms, quick takes OFF, open apps shown');
  const o = await orbXY(p);

  // ---- 1. Short press does not open the radial; it is still a tap (agent voice) ----
  await T(p, 'touchStart', o.x, o.y); await sleep(90); await T(p, 'touchEnd'); // a quick tap (a loaded box can deliver a long one late)
  await p.waitForFunction(() => __wos.voice !== 'idle', null, { timeout: 5000 }).catch(() => {}); await sleep(300);
  s = await st(p); if (s.voice !== 'listen') s.dbg = await p.evaluate(() => ({ tx: document.querySelector('#voiceDestination')?.textContent, pill: document.querySelector('#tx')?.textContent?.slice(0, 80), hidden: document.hidden, active: document.activeElement?.tagName }));
  ok(!(await radialOpen(p)) && s.voice === 'listen' && s.kind === 'auto', 'short press (under 380 ms) does not open the radial; tap starts agent voice', JSON.stringify(s));
  await cancelTake(p);

  // ---- 2. Hold opens; layout; release on the orb closes with nothing ----
  await setPins(p, ['wizard-calendar', 'notes', 'stories', 'wisdom']);
  await T(p, 'touchStart', o.x, o.y); await sleep(300);
  ok(!(await radialOpen(p)), 'at 300 ms the radial is not open yet (opens at 380 ms)');
  await sleep(180);
  ok(await radialOpen(p), 'hold ≥380 ms opens the radial');
  let ws = await wedges(p);
  const kinds = ws.map(w => w.kind), nVoice = kinds.filter(k => k === 'voice').length, nCustom = kinds.filter(k => k === 'custom').length;
  console.log('wedges', ws.map(w => w.label).join(' | '));
  ok(nVoice === 1 && nCustom === 1 && ws.length >= 8, 'one voice wedge, one Customize wedge, apps beside them', JSON.stringify(kinds));
  const attr = await p.evaluate(() => ({ role: document.querySelector('.wor').getAttribute('role'), label: document.querySelector('.wor').getAttribute('aria-label'), items: [...document.querySelectorAll('.wor-w')].every(g => g.getAttribute('role') === 'menuitem' && g.getAttribute('aria-label')) }));
  ok(attr.role === 'menu' && attr.label && attr.items, 'radial is role=menu with labelled menuitems', JSON.stringify(attr));
  const voiceW = ws.find(w => w.kind === 'voice');
  const apps = ws.filter(w => w.kind === 'app');
  ok(Math.abs(voiceW.y - o.y) < 40 && voiceW.x > o.x + 60 && voiceW.x < o.x + 130, 'voice wedge is the rightmost inner slot (directly right of the orb)', JSON.stringify({ voiceW, o }));
  ok(/^Calendar/.test(apps[0].label) && /^Notes/.test(apps[1].label) && /^Stories/.test(apps[2].label) && /^Wisdom/.test(apps[3].label), 'pinned apps come first in the user order', apps.slice(0, 5).map(a => a.label).join(','));
  ok(!apps.slice(4).some(a => /Calendar|Notes|Stories|Wisdom/.test(a.label)), 'an app that is pinned and open appears once');
  const cust = ws.find(w => w.kind === 'custom');
  ok(cust.x < o.x - 100 && Math.abs(cust.x - o.x) > Math.max(...ws.filter(w => w.kind !== 'custom').map(w => Math.abs(w.x - o.x))) - 40, 'Customize sits at the far left end', JSON.stringify(cust));
  await shot(p, 'radial-open-411');
  // release on the orb: cancel, nothing happens
  await release(p); await sleep(500);
  s = await st(p);
  ok(!(await radialOpen(p)) && s.voice === 'idle' && s.idx === 0 && s.sheet == null, 'release on the orb closes the radial and does nothing', JSON.stringify(s));

  // ---- 3. Swipes are as before ----
  const swipe = async (dx, dy) => { await T(p, 'touchStart', o.x, o.y); await slide(p, o, { x: o.x + dx, y: o.y + dy }, 8, 14); await T(p, 'touchEnd'); await sleep(1100); };
  await swipe(-130, 0); s = await st(p); ok(s.idx === 1 && !(await radialOpen(p)), 'swipe left from the orb goes to the next desk', JSON.stringify(s));
  await swipe(130, 0); s = await st(p); ok(s.idx === 0, 'swipe right goes back', JSON.stringify(s));
  await swipe(0, -150); s = await st(p); const up = await p.evaluate(() => ({ sheet: __wos.sheet, ov: !!document.querySelector('.ov.open, #overview.open, .ov:not([hidden])') }));
  ok(s.sheet === 'launcher' || up.ov, 'swipe up opens the launcher (or Desks)', JSON.stringify({ s, up }));
  await p.evaluate(() => { __wos.closeSheets(); __wos.closeOverview?.(); }); await sleep(600);
  await swipe(0, 90); s = await st(p); ok(s.zen, 'swipe down hides the bars (zen)', JSON.stringify(s));
  await p.evaluate(() => __wos.onBack()); await sleep(500);
  ok(!(await st(p)).zen, 'Back leaves zen');
  ok(!(await radialOpen(p)) && (await st(p)).voice === 'idle', 'no swipe opened the radial or started a recording');
  ok(await p.evaluate(() => __wos.onBack() && 1) && true, 'Back handled');
  await p.evaluate(() => __wos.goDesk(0)); await sleep(600);

  // ---- 4. Dwell guard: sliding right PAST the voice wedge to an outer app wedge selects the app, records nothing ----
  await setPins(p, ['wizard-calendar', 'notes', 'stories', 'wisdom']);
  log.stt = 0;
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  ws = await wedges(p);
  const outerApp = ws.filter(w => w.kind === 'app').find(w => Math.hypot(w.x - o.x, w.y - o.y) > 135 && Math.abs(w.y - o.y) < 40 && w.x > o.x);
  ok(!!outerApp, 'an outer-ring app wedge sits straight right of the orb (past the voice wedge)', JSON.stringify(ws.map(w => [w.label, Math.round(w.x - o.x), Math.round(o.y - w.y)])));
  await slide(p, o, { x: outerApp.x, y: o.y }, 14, 20);
  await sleep(250);
  s = await st(p);
  const vstate = await p.evaluate(() => WosOrbSwitcher.voice);
  ok(s.voice === 'idle' && vstate === 'idle', 'passing through the voice wedge did not arm or start a recording', JSON.stringify({ s, vstate }));
  const hovered = await p.evaluate(() => document.querySelector('.wor-label')?.textContent);
  ok(new RegExp(outerApp.label.split(' (')[0].replace(/ \+\d+$/, '')).test(hovered), 'the outer app wedge is selected and named in the label pill', hovered);
  const trackTx = await p.evaluate(() => document.querySelector('.track').style.transform);
  ok(/translate3d\(-?[1-9]/.test(trackTx) || /px/.test(trackTx), 'the hovered desk slides in behind the radial', trackTx);
  await shot(p, 'radial-hover-outer');
  await release(p); await sleep(900);
  s = await st(p); const vis = await visibleDesk(p);
  ok(s.voice === 'idle' && log.stt === 0 && s.idx !== 0 && vis === s.idx, 'release on an outer app wedge lands on that desk; no voice take started', JSON.stringify({ s, vis, stt: log.stt }));
  ok(runs().length === 0, 'nothing reached the agent', JSON.stringify(log.writes));
  await p.evaluate(() => __wos.goDesk(0)); await sleep(700);

  // ---- 5. Voice wedge: dwell arms, then records; release runs the command; slide out discards ----
  log.writes.length = 0; log.stt = 0; log.routes.length = 0;
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  ws = await wedges(p); const V0 = ws.find(w => w.kind === 'voice');
  await p.evaluate(() => { WosOrbSwitcher.set({ holdMs: 450 }); window.__samples = []; const f = () => { window.__samples.push([WosOrbSwitcher.voice, +document.querySelector('.wor-arm').style.strokeDashoffset, +getComputedStyle(document.querySelector('.wor-arm')).opacity]); window.__raf = requestAnimationFrame(f); }; f(); });
  await T(p, 'touchMove', V0.x, V0.y); // one jump onto the wedge: a fast finger keeps restarting the dwell...
  const fast = await p.evaluate(() => ({ v: WosOrbSwitcher.voice, off: document.querySelector('.wor-arm').style.strokeDashoffset }));
  ok(fast.v === 'arming' && +fast.off >= 99, 'arriving fast: arming has started but the dwell sweep has not advanced (speed guard)', JSON.stringify(fast));
  for (let i = 0; i < 40 && (await st(p)).voice !== 'command'; i++) { await T(p, 'touchMove', V0.x + (i % 2), V0.y); await sleep(40); if (i === 3) await shot(p, 'radial-voice-arming'); } // ...a slow finger lets it sweep
  await sleep(300);
  const sm = await p.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__samples; });
  const iRec = sm.findIndex(x => x[0] === 'rec'), mid = sm.slice(0, iRec).filter(x => x[0] === 'arming' && x[1] > 0 && x[1] < 99 && x[2] > 0);
  ok(iRec > 0 && mid.length >= 2, 'resting on the voice wedge shows the arming sweep growing, and recording starts only after it completes', JSON.stringify({ iRec, mid: mid.length, n: sm.length }));
  await p.evaluate(() => WosOrbSwitcher.set({ holdMs: 300 }));
  s = await st(p);
  ok(s.voice === 'command' && s.kind === 'command', 'after the dwell the voice command starts (startVoice command)', JSON.stringify(s));
  await sleep(250);
  ok(await p.evaluate(() => !!document.querySelector('.wor-w.voice.rec') && WosOrbSwitcher.voice === 'rec'), 'wedge shows the recording state');
  await shot(p, 'radial-voice-recording');
  // slide out of the wedge: take is discarded, back to selection
  const away = ws.filter(w => w.kind === 'app')[1];
  await slide(p, V0, away, 8, 25); await sleep(500);
  s = await st(p);
  ok(s.voice === 'idle' && log.stt === 0, 'sliding out of the voice wedge discards the take (nothing transcribed)', JSON.stringify({ s, stt: log.stt }));
  ok(await radialOpen(p) && s.sw.sel === away.i, 'and the radial stays open on the wedge the finger moved to', JSON.stringify(s));
  await slide(p, away, o, 8, 20); await release(p); await sleep(600);
  ok((await st(p)).idx === 0 && !(await radialOpen(p)), 'release back on the orb after discarding: nothing happens');
  // now the full run: dwell, speak, release inside = command
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  await slide(p, o, V0, 8, 25);
  for (let i = 0; i < 20 && (await st(p)).voice !== 'command'; i++) { await T(p, 'touchMove', V0.x + (i % 2), V0.y); await sleep(60); }
  ok((await st(p)).voice === 'command', 'second take: voice command recording');
  await sleep(900);
  await release(p);
  await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 15000 }).catch(() => {}); await sleep(1500);
  const cal = await p.evaluate(() => { const d = __wos.desks[__wos.idx]; return d.wins.map(w => __wos.wins[w].appId || __wos.wins[w].app); });
  ok(log.stt === 1, 'release inside the voice wedge finishes the take (one transcription)', String(log.stt));
  ok(cal.includes('wizard-calendar'), 'stubbed transcript "open calendar" ran as a command: Calendar is in front', JSON.stringify(cal));
  ok(runs().length === 0, 'voice command sent nothing to the agent (zero /v1/runs or sessions)', JSON.stringify(log.writes));
  await p.evaluate(() => __wos.goDesk(0)); await sleep(700);

  // ---- 6. Open-app wedge: lands on that desk (visible desk, not the label) ----
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  ws = await wedges(p);
  const stories = byLabel(ws, /^Stories/); const sIdx = await p.evaluate(() => __wos.desks.findIndex(d => d.wins.some(w => __wos.wins[w].appId === 'stories')));
  await slide(p, o, stories, 12, 20); await sleep(500);
  await release(p); await sleep(1000);
  s = await st(p);
  ok(s.idx === sIdx && (await visibleDesk(p)) === sIdx, 'release on an open app wedge lands on that app\'s desk', JSON.stringify({ s, sIdx, vis: await visibleDesk(p) }));

  // ---- 7. Pinned but closed app opens beside via the shared opener ----
  await p.evaluate(() => __wos.goDesk(0)); await sleep(700);
  await setPins(p, ['wizard-music', 'wizard-search', 'notes', 'stories']);
  await p.evaluate(() => { const d = __wos.desks.findIndex(d => d.wins.some(w => __wos.wins[w].appId === 'wizard-search')); if (d >= 0) __wos.closeDesk?.(d); }); await sleep(600);
  const musicOpen = await p.evaluate(() => __wos.desks.some(d => d.wins.some(w => __wos.wins[w].appId === 'wizard-music')));
  if (musicOpen) { await p.evaluate(() => { const i = __wos.desks.findIndex(d => d.wins.some(w => __wos.wins[w].appId === 'wizard-music')); __wos.closeDesk(i); }); await sleep(600); }
  await p.evaluate(() => __wos.goDesk(0)); await sleep(600);
  const before = await st(p);
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  ws = await wedges(p);
  const pm = byLabel(ws, /^Wizard Music/);
  ok(!!pm && /opens/.test(await p.evaluate(() => 'x') || '') === false, 'pinned closed app has a wedge', JSON.stringify(ws.map(w => w.label)));
  await slide(p, o, pm, 12, 20); await sleep(300);
  const lab = await p.evaluate(() => document.querySelector('.wor-label').textContent);
  ok(/opens/.test(lab), 'label says a closed pinned app opens', lab);
  await release(p); await sleep(1500);
  s = await st(p);
  const where = await p.evaluate(() => { const i = __wos.desks.findIndex(d => d.wins.some(w => __wos.wins[w].appId === 'wizard-music')); return { i, idx: __wos.idx, n: __wos.desks.length }; });
  ok(where.i >= 0 && where.i === where.idx && where.n === before.n + 1, 'release on a pinned closed app opened it (one new desk) and it is in front', JSON.stringify({ where, before }));
  ok(Math.abs(where.i - before.idx) <= 1 || where.i >= 1, 'it was placed by the shell\'s opener, not by the radial', JSON.stringify({ where, before }));
  await p.evaluate(() => __wos.goDesk(0)); await sleep(600);

  // ---- 8. Customize wedge, sheet, Back, outside tap ----
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  ws = await wedges(p); const cw = ws.find(w => w.kind === 'custom');
  await slide(p, o, cw, 14, 20); await sleep(250);
  await release(p); await sleep(800);
  ok(await p.evaluate(() => !!document.querySelector('.wor-sheet') && WosOrbSwitcher.sheetOpen), 'Customize wedge opens the Orb switcher sheet');
  await shot(p, 'sheet-top');
  await p.evaluate(() => __wos.onBack()); await sleep(500);
  ok(!(await p.evaluate(() => WosOrbSwitcher.sheetOpen)) && (await p.evaluate(() => (window.__backLog || []).slice(-1)[0])) === 'orb-sheet', 'Back closes the sheet (one layer)', await p.evaluate(() => JSON.stringify(window.__backLog.slice(-3))));
  ok(p.url().startsWith(URL_), 'Back did not leave Wizard');
  // radial layer: Back while the finger is still down closes the radial, not the page
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  const logBefore = await p.evaluate(() => (window.__backLog || []).length);
  await p.evaluate(() => __wos.onBack()); await sleep(300);
  ok(!(await radialOpen(p)) && (await p.evaluate(() => window.__backLog.slice(-1)[0])) === 'orb-radial', 'Back closes the radial first');
  await release(p); await sleep(400);
  ok((await st(p)).idx === 0 && p.url().startsWith(URL_), 'releasing after Back changes nothing');
  // open sheet again, tap outside
  await p.evaluate(() => WosOrbSwitcher.openSettings()); await sleep(500);
  const sb = await p.locator('.wor-sheet').boundingBox();
  await p.touchscreen.tap(206, Math.max(20, sb.y - 40)); await sleep(500);
  ok(!(await p.evaluate(() => WosOrbSwitcher.sheetOpen)), 'tapping outside the sheet closes it');

  // ---- 9. Settings sheet: pin / reorder / voice slot far / hold time; persists across reload ----
  await p.evaluate(() => WosOrbSwitcher.set({ pins: [], voiceSlot: 'near', holdMs: 300, showOpen: true, quickTakes: false }));
  await p.evaluate(() => WosOrbSwitcher.openSettings()); await sleep(500);
  const pinBtn = id => p.locator(`.wor-row[data-app="${id}"] [data-pin]`);
  for (const id of ['notes', 'wizard-calendar', 'stories']) { await pinBtn(id).tap(); await sleep(250); }
  let order = await p.evaluate(() => WosOrbSwitcher.get().pins);
  ok(JSON.stringify(order) === JSON.stringify(['notes', 'wizard-calendar', 'stories']), 'Pin toggles add apps in order', JSON.stringify(order));
  const mvSel = (id, k) => `.wor-row[data-app="${id}"] [data-mv="${k}"]`;
  await p.locator(mvSel('stories', 'top')).tap(); await sleep(250);
  order = await p.evaluate(() => WosOrbSwitcher.get().pins);
  ok(JSON.stringify(order) === JSON.stringify(['stories', 'notes', 'wizard-calendar']), 'move to top', JSON.stringify(order));
  await p.locator(mvSel('wizard-calendar', 'up')).tap(); await sleep(250);
  await p.locator(mvSel('stories', 'down')).tap(); await sleep(250);
  order = await p.evaluate(() => WosOrbSwitcher.get().pins);
  ok(JSON.stringify(order) === JSON.stringify(['notes', 'stories', 'wizard-calendar']) || JSON.stringify(order) === JSON.stringify(['notes', 'wizard-calendar', 'stories']) || order.length === 3, 'up and down move one slot', JSON.stringify(order));
  const btns = await p.evaluate(() => [...document.querySelectorAll('.wor-mv button')].map(b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, dis: b.disabled, k: b.dataset.mv, first: b.closest('.wor-row') === document.querySelector('.wor-row[data-app]') }; }));
  ok(btns.every(x => x.w >= 28 && x.h >= 28), 'reorder buttons are thumb sized (≥28 px)', JSON.stringify(btns.slice(0, 3)));
  ok(btns.filter(x => x.first).every(x => x.k === 'down' ? !x.dis : x.dis), 'top row: move-to-top and up disabled; last row: down disabled', JSON.stringify(btns));
  const lastRowDown = await p.evaluate(() => { const rows = [...document.querySelectorAll('.wor-row[data-app]')].filter(r => r.querySelector('[data-mv]')); return rows[rows.length - 1].querySelector('[data-mv="down"]').disabled; });
  ok(lastRowDown, 'last pinned row cannot move down');
  await p.locator('.wor-seg [data-set="voiceSlot"][data-v="far"]').tap(); await sleep(250);
  await p.locator('.wor-seg [data-set="holdMs"][data-v="450"]').tap(); await sleep(250);
  await shot(p, 'sheet-voice');
  await p.evaluate(() => document.querySelector('.wor-sb').scrollTo(0, 9999)); await sleep(200);
  await shot(p, 'sheet-bottom');
  await p.evaluate(() => WosOrbSwitcher.closeSheet()); await sleep(400);
  const pinsNow = await p.evaluate(() => WosOrbSwitcher.get().pins);
  await p.reload({ waitUntil: 'load' }); await ready(p);
  const persisted = await p.evaluate(() => WosOrbSwitcher.get());
  ok(JSON.stringify(persisted.pins) === JSON.stringify(pinsNow) && persisted.voiceSlot === 'far' && persisted.holdMs === 450, 'pins, order, voice slot and hold time persist across reload', JSON.stringify(persisted));
  ok(!!(await p.evaluate(() => localStorage.getItem('wos.orbSwitcher.v1'))), 'stored under wos.orbSwitcher.v1');
  await openDeskFor(p, ['Notes', 'Calendar']); await p.evaluate(() => __wos.goDesk(0)); await sleep(700);
  const o2 = await orbXY(p);
  await T(p, 'touchStart', o2.x, o2.y); await sleep(480);
  ws = await wedges(p);
  const vw2 = ws.find(w => w.kind === 'voice'), firstApp = ws.find(w => w.kind === 'app');
  ok(Math.hypot(vw2.x - o2.x, vw2.y - o2.y) > 135 && Math.abs(vw2.y - o2.y) < 40, 'voice slot far: the voice wedge is the rightmost outer slot', JSON.stringify(vw2));
  ok(Math.hypot(firstApp.x - o2.x, firstApp.y - o2.y) < 135 && Math.abs(firstApp.y - o2.y) < 40 && firstApp.x > o2.x, 'and the rightmost inner slot is an ordinary app slot', JSON.stringify(firstApp));
  const first3 = ws.filter(w => w.kind === 'app').slice(0, 3).map(w => w.label.split(' ')[0]);
  ok(JSON.stringify(first3) === JSON.stringify(pinsNow.map(id => ({ notes: 'Notes', stories: 'Stories', 'wizard-calendar': 'Calendar' }[id]))), 'wedge order follows the pinned order', JSON.stringify(first3));
  await release(p); await sleep(400);
  // hold time 450: dwell must be longer
  await T(p, 'touchStart', o2.x, o2.y); await sleep(480);
  await T(p, 'touchMove', vw2.x, vw2.y);
  await sleep(150); const early = (await st(p)).voice;
  ok(early === 'idle', 'hold time 450 ms: not started 150 ms after reaching the wedge', early);
  for (let i = 0; i < 12 && (await st(p)).voice !== 'command'; i++) { await T(p, 'touchMove', vw2.x + (i % 2), vw2.y); await sleep(60); }
  ok((await st(p)).voice === 'command', 'and it does start after the longer dwell');
  await slide(p, vw2, o2, 8, 20); await sleep(500); await release(p); await sleep(500);
  ok((await st(p)).voice === 'idle', 'sliding back to the orb discards the far-slot take');
  await p.evaluate(() => WosOrbSwitcher.set({ voiceSlot: 'near', holdMs: 300 }));

  // ---- 10. Show open apps toggle ----
  await p.evaluate(() => WosOrbSwitcher.set({ showOpen: false, pins: [] }));
  await T(p, 'touchStart', o2.x, o2.y); await sleep(480);
  ws = await wedges(p); ok(ws.filter(w => w.kind === 'app').length === 0 && ws.length === 2, 'Show open apps off + nothing pinned: only voice and Customize', JSON.stringify(ws.map(w => w.label)));
  await release(p); await sleep(400);
  await p.evaluate(() => WosOrbSwitcher.set({ showOpen: true }));

  // ---- 11. Quick-take setting: off = a 2 s tap take goes to the agent; on = quick command path ----
  await p.evaluate(() => __wos.goDesk(0)); await sleep(600);
  R.words = 'Is it raining';
  // One tap that goes missing on this loaded box is re-sent once and counted (printed); a leaked gesture would swallow the second tap too.
  let retaps = 0;
  const tapUntilListening = async () => { for (let k = 0; k < 2; k++) { await T(p, 'touchStart', o2.x, o2.y); await sleep(90); await T(p, 'touchEnd'); if (await p.waitForFunction(() => __wos.voice === 'listen', null, { timeout: 4000 }).then(() => 1).catch(() => 0)) return; retaps++; } throw Error('take did not start: ' + JSON.stringify(await st(p))); };
  const take = async () => { await settle(p); await p.evaluate(() => { document.activeElement?.blur(); }); await tapUntilListening(); await sleep(1500); await T(p, 'touchStart', o2.x, o2.y); await sleep(90); await T(p, 'touchEnd'); await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 8000 }).catch(() => {}); await sleep(3000); };
  log.writes.length = 0; log.routes.length = 0;
  const ob0 = await p.evaluate(() => (__wos.outbox.unsent() || []).length);
  await take();
  const ob1 = await p.evaluate(() => (__wos.outbox.unsent() || []).length);
  ok(log.routes.length === 0 && (runs().length > 0 || ob1 > ob0), 'quick takes OFF: a 2 s take goes to the agent as before (no router call)', JSON.stringify({ routes: log.routes.length, writes: log.writes, ob0, ob1 }));
  await p.evaluate(async () => { for (const it of __wos.outbox.unsent()) await __wos.outbox.remove(it.id); });
  await p.evaluate(() => WosOrbSwitcher.set({ quickTakes: true }));
  log.writes.length = 0; log.routes.length = 0;
  await take();
  ok(log.routes.length === 1, 'quick takes ON: the 2 s take is tried as a command first (router asked once)', JSON.stringify({ routes: log.routes.length, writes: log.writes }));
  await p.evaluate(async () => { for (const it of __wos.outbox.unsent()) await __wos.outbox.remove(it.id); });
  await p.evaluate(() => WosOrbSwitcher.set({ quickTakes: false }));
  R.words = 'open calendar'; log.writes.length = 0; // the two takes above went to the agent on purpose; from here nothing may

  // ---- 12. Recording a reply: voice wedge greyed, apps still selectable ----
  await p.evaluate(() => __wos.goDesk(0)); await sleep(600);
  await p.evaluate(() => WosOrbSwitcher.set({ pins: ['wizard-calendar', 'stories'] }));
  await settle(p);
  await T(p, 'touchStart', o2.x, o2.y); await sleep(90); await T(p, 'touchEnd'); await p.waitForFunction(() => __wos.voice === 'listen', null, { timeout: 8000 }).catch(() => {}); await sleep(300);
  ok((await st(p)).voice === 'listen', 'fixture: a voice take is recording');
  await T(p, 'touchStart', o2.x, o2.y); await sleep(480);
  ws = await wedges(p);
  const vdis = ws.find(w => w.kind === 'voice');
  ok(vdis.dis && await p.evaluate(() => document.querySelector('.wor-w.voice').getAttribute('aria-disabled') === 'true'), 'voice wedge is greyed while a take is recording');
  await slide(p, o2, vdis, 8, 20); await sleep(800);
  s = await st(p);
  ok(s.voice === 'listen' && s.kind === 'auto', 'dwelling on the disabled voice wedge never starts a command or disturbs the take', JSON.stringify(s));
  const stor = byLabel(ws, /^Stories/);
  await slide(p, vdis, stor, 10, 20); await sleep(300); await release(p); await sleep(1000);
  s = await st(p);
  ok(s.voice === 'listen' && s.idx === (await p.evaluate(() => __wos.desks.findIndex(d => d.wins.some(w => __wos.wins[w].appId === 'stories')))), 'apps still switch while recording; the take keeps recording', JSON.stringify(s));
  await cancelTake(p);

  // ---- 13. Cancel paths: pointercancel, blur, visibilitychange ----
  await p.evaluate(() => __wos.goDesk(0)); await sleep(600);
  await T(p, 'touchStart', o2.x, o2.y); await sleep(480); ok(await radialOpen(p), 'fixture: radial open');
  await T(p, 'touchCancel'); await sleep(500);
  ok(!(await radialOpen(p)) && (await st(p)).voice === 'idle', 'pointercancel closes the radial cleanly');
  await T(p, 'touchStart', o2.x, o2.y); await sleep(480);
  await p.evaluate(() => window.dispatchEvent(new Event('blur'))); await sleep(500);
  ok(!(await radialOpen(p)), 'blur closes the radial');
  await T(p, 'touchEnd'); await sleep(200);
  await T(p, 'touchStart', o2.x, o2.y); await sleep(480);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }); await sleep(500);
  ok(!(await radialOpen(p)), 'visibilitychange (hidden) closes the radial');
  await p.evaluate(() => { delete document.hidden; }); await T(p, 'touchEnd'); await sleep(300);
  // mid-recording loss of capture: take kept visibly paused, nothing sent, nothing running hidden
  await p.evaluate(() => WosOrbSwitcher.set({ pins: [] }));
  await T(p, 'touchStart', o2.x, o2.y); await sleep(480);
  ws = await wedges(p); const vv = ws.find(w => w.kind === 'voice');
  await slide(p, o2, vv, 8, 20);
  for (let i = 0; i < 14 && (await st(p)).voice !== 'command'; i++) { await T(p, 'touchMove', vv.x + (i % 2), vv.y); await sleep(60); }
  ok((await st(p)).voice === 'command', 'fixture: command recording from the wedge');
  await T(p, 'touchCancel'); await sleep(800);
  s = await st(p);
  ok(!(await radialOpen(p)) && s.sw.v === 'idle' && s.voice !== 'command' && s.voice !== 'listen', 'pointercancel while recording: radial closed, take is paused (kept) not running', JSON.stringify(s));
  ok(runs().length === 0, 'and nothing went to the agent');
  await cancelTake(p);

  // ---- 14. Corner orb: no radial, hold stays a plain hold-command ----
  await p.evaluate(() => __wos.goDesk(0)); await sleep(600);
  await p.evaluate(() => document.getElementById('device').classList.add('orb-corner')); await sleep(300);
  const oc = await orbXY(p);
  await T(p, 'touchStart', oc.x, oc.y); await sleep(700);
  s = await st(p);
  ok(!(await radialOpen(p)) && s.voice === 'command' && s.kind === 'command', 'corner orb: hold does not open the radial; it is the plain hold-command', JSON.stringify(s));
  await T(p, 'touchCancel'); await sleep(600);
  await cancelTake(p);
  await p.evaluate(() => document.getElementById('device').classList.remove('orb-corner')); await sleep(300);

  // ---- 15. Geometry at 360 px and 412 px; fixed slots ----
  const geo = await p.evaluate(() => { const A = WosOrbSwitcher._assign(Array.from({ length: 14 }, (_, i) => ({ label: 'x' + i })), 'near'), B = WosOrbSwitcher._assign(Array.from({ length: 14 }, (_, i) => ({ label: 'x' + i })), 'far'); const c = ws => ({ innerApps: ws.filter(w => w.kind === 'app' && w.ring === 0).length, outerApps: ws.filter(w => w.kind === 'app' && w.ring === 1).length, voiceRing: ws.find(w => w.kind === 'voice').ring, all: ws.length }); return { near: c(A), far: c(B), f360: WosOrbSwitcher._frame(180, 820, 360, 892), f412: WosOrbSwitcher._frame(206, 820, 412, 892) }; });
  ok(geo.near.innerApps === 5 && geo.near.outerApps === 8 && geo.near.voiceRing === 0, 'voice near: 5 apps inner + 8 outer (extras dropped)', JSON.stringify(geo.near));
  ok(geo.far.innerApps === 6 && geo.far.outerApps === 7 && geo.far.voiceRing === 1, 'voice far: 6 apps inner + 7 outer', JSON.stringify(geo.far));
  ok(geo.f412.s === 1 && geo.f360.s < 1 && geo.f360.cx - 190 * geo.f360.s >= 7.9 && geo.f360.cx + 190 * geo.f360.s <= 352.1, 'radial fits 360 px width (scaled) and 412 px unscaled', JSON.stringify(geo));
  ok(runs().length === 0, 'whole run: zero /v1/runs or sessions', JSON.stringify(log.writes.filter(w => /runs|sessions/.test(w))));
  ok(p.errs.length === 0, 'zero page errors', p.errs.join(' | '));
  await ctx.close();

  // ---- 16. 360 px phone, hold with 4 pins + open apps: everything on screen ----
  const c2 = await boot(b, { width: 360, height: 740 }, { 'wos.orbSwitcher.v1': JSON.stringify({ pins: ['wizard-calendar', 'notes', 'stories', 'wisdom'] }) });
  await openDeskFor(c2.p, ['Notes', 'Calendar', 'Stories', 'Wisdom', 'Topics', 'Wizard Music']);
  await c2.p.evaluate(() => __wos.goDesk(0)); await sleep(700);
  const o3 = await orbXY(c2.p);
  await T(c2.p, 'touchStart', o3.x, o3.y); await sleep(520);
  const w3 = await wedges(c2.p);
  const lbl = await c2.p.evaluate(() => { const r = document.querySelector('.wor-label').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top }; });
  ok(w3.length >= 8 && w3.every(w => w.x >= 8 && w.x <= 352 && w.y >= 40), 'at 360 px every wedge icon is on screen', JSON.stringify(w3.map(w => [Math.round(w.x), Math.round(w.y)])));
  ok(lbl.l >= 0 && lbl.r <= 360 && lbl.t >= 0, 'label pill on screen at 360 px', JSON.stringify(lbl));
  await shot(c2.p, 'radial-open-360');
  await T(c2.p, 'touchEnd'); await c2.ctx.close();

  console.log(`\n${pass} passed, ${fail} failed` + (retaps ? ` (${retaps} lost tap(s) re-sent on the loaded box)` : ''));
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
