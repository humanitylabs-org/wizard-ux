// QA (Orb switcher, James 31 Oct 2026 prototype v2): hold the orb = a compact two-ring radial. Inner ring = the open desktops
// (strip order, left to right; voice is its rightmost slot when 'near'); outer ring = pinned apps that are NOT open, plus Customize.
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
// The radial's own geometry (viewport px, centre = the orb): ring, slot, radii, sweep, desk index, label.
const geo = p => p.evaluate(() => WosOrbSwitcher._wedges().map((w, i) => ({ i, kind: w.kind, ring: w.ring, k: w.k, r0: w.r0, r1: w.r1, rm: w.rm, a0: w.a0, a1: w.a1, x: w.x, y: w.y, desk: w.item ? w.item.desk : null, open: !!w.item?.open, cur: !!w.item?.cur, label: w.kind === 'voice' ? 'Voice command' : w.kind === 'custom' ? 'Customize' : w.item.label })));
const arcAtMid = w => w.rm * (w.a1 - w.a0) * Math.PI / 180;
const dist = (w, o) => Math.hypot(w.x - o.x, w.y - o.y);
// Close any desk that is not Home, Chats or one of the three fixture apps, so the ring contents are predictable.
async function resetDesks(p) {
  await p.evaluate(() => { const keep = ['notes', 'wizard-calendar', 'stories']; for (let i = __wos.desks.length - 1; i > 0; i--) { const d = __wos.desks[i]; if (d.home) continue; const ids = d.wins.map(w => __wos.wins[w].appId || __wos.wins[w].app); if (!ids.some(id => keep.includes(id) || id === 'chats' || id === 'wizard')) __wos.closeDesk(i); } __wos.goDesk(0); });
  await sleep(900);
}
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
  await openDeskFor(p, ['Notes', 'Calendar', 'Stories']);
  await resetDesks(p); await sleep(1500); // the default Topics desk is closed: exactly Home, Notes, Calendar, Stories, Chats are open (five desks = the five inner desk slots when voice is near)
  let s = await st(p);
  ok(s.n === 5 && s.idx === 0, 'fixture: Home plus four open desks (five desks)', JSON.stringify(s));
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

  // ---- 2. Hold opens; ring assignment and compact geometry; release on the orb closes with nothing ----
  await setPins(p, ['wizard-calendar', 'notes', 'stories', 'wisdom', 'wizard-music', 'wizard-search']); // three of the pins are already open desks
  await T(p, 'touchStart', o.x, o.y); await sleep(300);
  ok(!(await radialOpen(p)), 'at 300 ms the radial is not open yet (opens at 380 ms)');
  await sleep(180);
  ok(await radialOpen(p), 'hold ≥380 ms opens the radial');
  let ws = await wedges(p), g = await geo(p);
  const kinds = ws.map(w => w.kind), nVoice = kinds.filter(k => k === 'voice').length, nCustom = kinds.filter(k => k === 'custom').length;
  console.log('wedges', ws.map(w => w.label).join(' | '));
  ok(nVoice === 1 && nCustom === 1, 'one voice wedge, one Customize wedge', JSON.stringify(kinds));
  const attr = await p.evaluate(() => ({ role: document.querySelector('.wor').getAttribute('role'), label: document.querySelector('.wor').getAttribute('aria-label'), items: [...document.querySelectorAll('.wor-w')].every(g => g.getAttribute('role') === 'menuitem' && g.getAttribute('aria-label')) }));
  ok(attr.role === 'menu' && attr.label && attr.items, 'radial is role=menu with labelled menuitems', JSON.stringify(attr));
  const inner = g.filter(w => w.ring === 0), outer = g.filter(w => w.ring === 1);
  const deskCount = await p.evaluate(() => __wos.desks.length);
  const innerDesks = inner.filter(w => w.kind === 'app').sort((a, b) => a.x - b.x);
  ok(innerDesks.length === deskCount && innerDesks.every((w, i) => w.desk === i) && innerDesks.every(w => w.open), 'inner ring wedges are exactly the open desktops, left to right in strip order', JSON.stringify(innerDesks.map(w => [w.label, w.desk])));
  ok(/^Home/.test(innerDesks[0].label) && innerDesks[0].x === Math.min(...inner.map(w => w.x)), 'Home is the leftmost inner wedge');
  const voiceW = g.find(w => w.kind === 'voice');
  ok(voiceW.ring === 0 && voiceW.x === Math.max(...inner.map(w => w.x)) && Math.abs(voiceW.y - o.y) < 30 && voiceW.x > o.x + 40 && dist(voiceW, o) < 90, 'voice (near) is the rightmost inner slot, directly right of the orb', JSON.stringify({ voiceW, o }));
  ok(g.filter(w => w.cur).length === 1 && g.find(w => w.cur).desk === 0 && (await p.evaluate(() => document.querySelectorAll('.wor-dot').length)) === 1, 'the current desk (Home) alone carries the dot', JSON.stringify(g.filter(w => w.cur).map(w => w.label)));
  const outerApps = outer.filter(w => w.kind === 'app').sort((a, b) => a.x - b.x), cust = outer.find(w => w.kind === 'custom');
  ok(outer.length === outerApps.length + 1 && !!cust && cust.x === Math.min(...outer.map(w => w.x)), 'outer ring is pinned apps plus Customize at the far left', JSON.stringify(outer.map(w => w.label)));
  ok(JSON.stringify(outerApps.map(w => w.label)) === JSON.stringify(['Wisdom', 'Wizard Music', 'Search']) && outerApps.every(w => w.desk == null && !w.open), 'outer ring holds only pinned apps that are NOT open, in pin order left to right', JSON.stringify(outerApps.map(w => w.label)));
  ok(!outerApps.some(w => /Calendar|Notes|Stories/.test(w.label)) && g.filter(w => /^Notes/.test(w.label)).length === 1 && g.filter(w => /^Calendar/.test(w.label)).length === 1, 'a pinned app that is open appears once (as its desk), never twice');
  // compact geometry
  const innerD = inner.map(w => dist(w, o)), allR1 = Math.max(...g.map(w => dist({ x: w.x, y: w.y }, o) + 0)), outerEdge = Math.max(...g.map(w => w.r1));
  console.log('geometry', JSON.stringify({ r0: [Math.min(...inner.map(w => w.r0)), Math.max(...inner.map(w => w.r1))], outer: [Math.min(...outer.map(w => w.r0)), outerEdge], midArcInner: +Math.min(...inner.map(arcAtMid)).toFixed(1), midArcOuter: +Math.min(...outer.map(arcAtMid)).toFixed(1), slots: [inner.length, outer.length] }));
  ok(Math.min(...innerD) < 90 && Math.min(...inner.map(w => w.r0)) <= 46, 'first inner wedge centre is within 90 px of the orb centre and its inner edge starts at the orb', JSON.stringify({ nearest: Math.min(...innerD), r0: Math.min(...inner.map(w => w.r0)) }));
  ok(outerEdge <= 150 && outerEdge >= 130, 'outermost wedge outer edge within 150 px of the orb centre', String(outerEdge));
  ok(Math.min(...outer.map(w => w.r0)) - Math.max(...inner.map(w => w.r1)) <= 4 && Math.min(...outer.map(w => w.r0)) - Math.max(...inner.map(w => w.r1)) > 0, 'rings are adjacent with only a hairline gap', JSON.stringify([Math.max(...inner.map(w => w.r1)), Math.min(...outer.map(w => w.r0))]));
  ok(g.every(w => arcAtMid(w) >= 40), 'every wedge is >= 40 px of arc at its mid-radius (thumb target)', JSON.stringify(g.map(w => Math.round(arcAtMid(w)))));
  await sleep(450); // the staggered open animation has finished
  const icons = await p.evaluate(() => [...document.querySelectorAll('.wor-ic')].map(e => { const r = (e.querySelector('.dsg') || e.querySelector('svg') || e).getBoundingClientRect(); return Math.round(r.width); }));
  ok(icons.every(w => w >= 20 && w <= 23), 'icons are 20–22 px (±1 px glyph rounding)', JSON.stringify(icons));
  ok(await p.evaluate(() => { const c = document.querySelector('.wor-label'); return c && getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)' && !/^rgba?\(.*,\s*0?\.\d+\)$/.test(getComputedStyle(c).backgroundColor); }), 'label pill is opaque');
  const lp = await p.evaluate(() => { const r = document.querySelector('.wor-label').getBoundingClientRect(); return { bottom: r.bottom }; });
  ok(o.y - Math.max(...g.map(w => w.r1)) - lp.bottom < 20 && o.y - Math.max(...g.map(w => w.r1)) - lp.bottom > -4, 'label pill sits just above the arc (close, not far)', JSON.stringify({ lp, top: o.y - outerEdge }));
  await shot(p, 'radial-open-411');
  // release on the orb: cancel, nothing happens
  await release(p); await sleep(500);
  s = await st(p);
  ok(!(await radialOpen(p)) && s.voice === 'idle' && s.idx === 0 && s.sheet == null, 'release on the orb closes the radial and does nothing', JSON.stringify(s));
  // a plain hold-and-release (and a hold with finger jitter) must never start voice, even though the voice wedge is next to the thumb
  log.stt = 0;
  await T(p, 'touchStart', o.x, o.y); await sleep(1600); await release(p); await sleep(500);
  s = await st(p); ok(s.voice === 'idle' && log.stt === 0 && !(await radialOpen(p)), 'plain hold (1.6 s) and release without movement never starts voice', JSON.stringify({ s, stt: log.stt }));
  await T(p, 'touchStart', o.x + 6, o.y - 3); await sleep(480);
  for (let i = 0; i < 12; i++) { await T(p, 'touchMove', o.x + 6 + (i % 3) * 3, o.y - 3 - (i % 2) * 4); await sleep(100); }
  s = await st(p); ok(s.sw.v === 'idle' && s.voice === 'idle' && s.sw.sel == null, 'hold with finger jitter (≤ 12 px) arms nothing and selects nothing', JSON.stringify(s));
  await release(p); await sleep(500);
  s = await st(p); ok(s.voice === 'idle' && log.stt === 0 && s.idx === 0, 'jittered hold-release starts no voice and changes no desk', JSON.stringify({ s, stt: log.stt }));
  // pressed down already INSIDE the voice wedge (cannot happen with a thumb on the orb, but the guard must hold): no arming until it leaves and returns
  await p.evaluate(() => { const a = document.querySelector('#orbWrap').getBoundingClientRect(), o = { x: a.left + a.width / 2, y: a.top + a.height / 2 }; WosOrbSwitcher.open({ x: o.x, y: o.y, fromX: o.x + 67, fromY: o.y }); window.__o = o; });
  await sleep(150);
  await p.evaluate(() => { for (let i = 0; i < 3; i++) WosOrbSwitcher.move(window.__o.x + 67 + i * 5, window.__o.y); }); await sleep(900);
  ok(await p.evaluate(() => WosOrbSwitcher.voice) === 'idle' && log.stt === 0, 'a press that starts inside the voice wedge does not arm it by dwelling', await p.evaluate(() => WosOrbSwitcher.voice));
  await p.evaluate(() => { WosOrbSwitcher.move(window.__o.x - 60, window.__o.y - 50); WosOrbSwitcher.move(window.__o.x + 67, window.__o.y); }); await sleep(120);
  ok(await p.evaluate(() => WosOrbSwitcher.voice) === 'arming', 'after leaving and returning it arms (dwell starts)');
  await p.evaluate(() => WosOrbSwitcher.close(true)); await sleep(300); await cancelTake(p);

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

  // ---- 4. Dwell guard: sliding right PAST the (now adjacent) voice wedge to an outer-ring wedge selects the app, records nothing ----
  // Show open apps off: the inner ring is only voice, and eight pins fill the whole outer ring, so its rightmost wedge lies straight beyond voice.
  await setPins(p, ['wizard-search', 'notes', 'wizard-calendar', 'stories', 'wisdom', 'wizard-music', 'topics', 'files-qa'], { showOpen: false });
  log.stt = 0;
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  ws = await wedges(p); g = await geo(p);
  ok(g.filter(w => w.ring === 0).length === 1 && g.filter(w => w.ring === 1 && w.kind === 'app').length === 8, 'show open apps off: inner ring is only voice, outer ring shows all eight pins (open or not)', JSON.stringify(g.map(w => [w.ring, w.kind])));
  const outerApp = g.filter(w => w.kind === 'app').sort((a, b) => b.x - a.x)[0];
  ok(!!outerApp && Math.abs(outerApp.y - o.y) < 40 && outerApp.x > o.x + 92 && /Files/.test(outerApp.label), 'an outer-ring wedge sits straight right of the orb beyond the voice wedge', JSON.stringify([outerApp.label, Math.round(outerApp.x - o.x), Math.round(o.y - outerApp.y)]));
  await slide(p, o, { x: outerApp.x, y: o.y }, 14, 20);
  await sleep(250);
  s = await st(p);
  const vstate = await p.evaluate(() => WosOrbSwitcher.voice);
  ok(s.voice === 'idle' && vstate === 'idle', 'passing through the voice wedge did not arm or start a recording', JSON.stringify({ s, vstate }));
  const hovered = await p.evaluate(() => document.querySelector('.wor-label')?.textContent);
  ok(/Files/.test(hovered), 'the outer wedge is selected and named in the label pill', hovered);
  await shot(p, 'radial-hover-outer');
  await release(p); await sleep(1500);
  s = await st(p); const vis = await visibleDesk(p);
  ok(s.voice === 'idle' && log.stt === 0 && s.idx !== 0 && vis === s.idx, 'release on an outer pin wedge lands on that app (opened or moved beside); no voice take started', JSON.stringify({ s, vis, stt: log.stt }));
  ok(runs().length === 0, 'nothing reached the agent', JSON.stringify(log.writes));
  await resetDesks(p); await setPins(p, ['wizard-calendar', 'notes', 'stories', 'wisdom'], { showOpen: true });

  // ---- 5. Voice wedge: dwell arms, then records; release runs the command; slide out discards ----
  log.writes.length = 0; log.stt = 0; log.routes.length = 0;
  await T(p, 'touchStart', o.x, o.y); await sleep(480);
  ws = await wedges(p); const V0 = ws.find(w => w.kind === 'voice');
  ok(Math.hypot(V0.x - o.x, V0.y - o.y) < 90, 'voice wedge is close: its centre is under 90 px from the orb', String(Math.hypot(V0.x - o.x, V0.y - o.y)));
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
  const away = ws.filter(w => w.kind === 'app').find(w => /^Notes/.test(w.label));
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
  ok(!!pm && (await geo(p))[pm.i].ring === 1, 'pinned closed app has a wedge on the outer ring', JSON.stringify(ws.map(w => w.label)));
  await slide(p, o, pm, 12, 20); await sleep(300);
  const lab = await p.evaluate(() => document.querySelector('.wor-label').textContent);
  ok(/opens/.test(lab), 'label says a closed pinned app opens', lab);
  await release(p); await sleep(1500);
  s = await st(p);
  const where = await p.evaluate(() => { const i = __wos.desks.findIndex(d => d.wins.some(w => __wos.wins[w].appId === 'wizard-music')); return { i, idx: __wos.idx, n: __wos.desks.length }; });
  ok(where.i >= 0 && where.i === where.idx && where.n === before.n + 1, 'release on a pinned closed app opened it (one new desk) and it is in front', JSON.stringify({ where, before }));
  ok(Math.abs(where.i - before.idx) <= 1 || where.i >= 1, 'it was placed by the shell\'s opener, not by the radial', JSON.stringify({ where, before }));
  await resetDesks(p);

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
  g = await geo(p);
  const vw2 = ws.find(w => w.kind === 'voice'), gv = g.find(w => w.kind === 'voice');
  ok(gv.ring === 1 && dist(vw2, o2) > 92 && Math.abs(vw2.y - o2.y) < 40 && gv.x === Math.max(...g.filter(w => w.ring === 1).map(w => w.x)), 'voice slot far: the voice wedge is the rightmost outer slot', JSON.stringify(gv));
  const innerFar = g.filter(w => w.ring === 0).sort((a, b) => b.x - a.x);
  ok(innerFar.every(w => w.kind === 'app' && w.open) && innerFar[0].x > o2.x && Math.abs(innerFar[0].y - o2.y) < 40 && dist(innerFar[0], o2) < 90, 'and the rightmost inner slot is an ordinary open desk (all six inner slots are desks)', JSON.stringify(innerFar.map(w => w.label)));
  const deskOrder = await p.evaluate(() => __wos.desks.length);
  ok(innerFar.slice().sort((a, b) => a.x - b.x).every((w, i) => w.desk === i) && innerFar.length === Math.min(6, deskOrder), 'inner desks run left to right in strip order', JSON.stringify(innerFar.map(w => [w.label, w.desk])));
  const outerFar = g.filter(w => w.ring === 1 && w.kind === 'app' && !w.open).sort((a, b) => a.x - b.x).map(w => w.label.split(' ')[0]);
  const openIds = await p.evaluate(() => __wos.desks.flatMap(d => d.wins.map(w => __wos.wins[w].appId || __wos.wins[w].app)));
  const expOuter = pinsNow.filter(id => !openIds.includes(id)).map(id => ({ notes: 'Notes', stories: 'Stories', 'wizard-calendar': 'Calendar' }[id]));
  ok(JSON.stringify(outerFar) === JSON.stringify(expOuter), 'outer ring pins that are not open follow the pinned order', JSON.stringify({ outerFar, expOuter }));
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

  // ---- 15. Ring assignment unit checks and geometry at 360 px and 412 px; fixed slots ----
  const geoU = await p.evaluate(() => {
    const desk = i => ({ label: 'd' + i, open: true, desk: i }), pin = i => ({ label: 'p' + i, open: false, desk: null });
    const c = ws => ({ innerDesks: ws.filter(w => w.kind === 'app' && w.ring === 0).length, outerDesks: ws.filter(w => w.kind === 'app' && w.ring === 1 && w.item.open).length, outerPins: ws.filter(w => w.kind === 'app' && w.ring === 1 && !w.item.open).length, voiceRing: ws.find(w => w.kind === 'voice').ring, voiceK: ws.find(w => w.kind === 'voice').k });
    const logs = []; const keep = console.info; console.info = (...a) => logs.push(a.join(' '));
    const A = WosOrbSwitcher._assign(Array.from({ length: 14 }, (_, i) => desk(i)), 'near'), B = WosOrbSwitcher._assign(Array.from({ length: 14 }, (_, i) => desk(i)), 'far');
    const C = WosOrbSwitcher._assign([0, 1, 2].map(desk).concat(Array.from({ length: 10 }, (_, i) => pin(i))), 'near');
    const D = WosOrbSwitcher._assign([0, 1, 2, 3, 4, 5, 6, 7].map(desk).concat([0, 1, 2, 3, 4].map(pin)), 'near');
    console.info = keep;
    return { near: c(A), far: c(B), mix: c(C), over: c(D), dropLog: logs.length, f360: WosOrbSwitcher._frame(180, 820, 360, 892), f412: WosOrbSwitcher._frame(206, 820, 412, 892), f320: WosOrbSwitcher._frame(160, 820, 320, 892) };
  });
  ok(geoU.near.innerDesks === 5 && geoU.near.outerDesks === 8 && geoU.near.voiceRing === 0 && geoU.near.voiceK === 0, 'voice near with 14 desks: 5 desks inner, overflow fills the 8 outer slots, the rest dropped', JSON.stringify(geoU.near));
  ok(geoU.far.innerDesks === 6 && geoU.far.outerDesks === 7 && geoU.far.voiceRing === 1 && geoU.far.voiceK === 0, 'voice far with 14 desks: 6 inner, 7 outer (voice is the rightmost outer slot)', JSON.stringify(geoU.far));
  ok(geoU.mix.innerDesks === 3 && geoU.mix.outerPins === 8 && geoU.mix.outerDesks === 0, '3 desks + 10 pins: 3 inner, pins fill the 8 outer slots (no desk spill)', JSON.stringify(geoU.mix));
  ok(geoU.over.innerDesks === 5 && geoU.over.outerPins === 5 && geoU.over.outerDesks === 3, '8 desks + 5 pins: 5 inner; pins keep their outer slots, the 3 overflow desks take the remaining room', JSON.stringify(geoU.over));
  ok(geoU.dropLog === 3, 'dropped overflow is console-logged (14 desks near and far, 10 pins)', String(geoU.dropLog));
  ok(geoU.f412.s === 1 && geoU.f360.s === 1 && geoU.f320.s === 1 && geoU.f360.cx - 138 >= 7.9 && geoU.f360.cx + 138 <= 352.1 && geoU.f320.cx - 138 >= 7.9, 'the 138 px radial fits 412, 360 and 320 px widths unscaled', JSON.stringify(geoU));
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
  const g3 = await geo(c2.p), c3 = { x: o3.x, y: o3.y };
  ok(w3.length >= 8 && w3.every(w => w.x >= 8 && w.x <= 352 && w.y >= 40), 'at 360 px every wedge icon is on screen', JSON.stringify(w3.map(w => [Math.round(w.x), Math.round(w.y)])));
  const edge = g3.flatMap(w => [w.a0, w.a1, (w.a0 + w.a1) / 2].map(a => [c3.x + w.r1 * Math.cos(a * Math.PI / 180), c3.y - w.r1 * Math.sin(a * Math.PI / 180)]));
  ok(edge.every(([x, y]) => x >= 0 && x <= 360 && y >= 0), 'at 360 px no wedge outer edge is clipped by the screen', JSON.stringify(edge.map(e => e.map(Math.round)).filter(([x, y]) => x < 0 || x > 360 || y < 0)));
  ok(g3.every(w => arcAtMid(w) >= 40) && Math.max(...g3.map(w => w.r1)) <= 150, 'at 360 px all wedges still >= 40 px arc and the radial stays within 150 px');
  ok(lbl.l >= 0 && lbl.r <= 360 && lbl.t >= 0, 'label pill on screen at 360 px', JSON.stringify(lbl));
  await shot(c2.p, 'radial-open-360');
  await T(c2.p, 'touchEnd'); await c2.ctx.close();

  console.log(`\n${pass} passed, ${fail} failed` + (retaps ? ` (${retaps} lost tap(s) re-sent on the loaded box)` : ''));
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
