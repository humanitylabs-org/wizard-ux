const QA_ROOT = require('node:path').resolve(__dirname, '../..'); // repo root (this script lives in qa/scripts/)
// QA: the phone's four-section bar retires the radial Orb switcher (wizard-ux#1958; it was the pins-only radial of
// James, 1 Nov 2026). With the bar on (every phone since #1956), holding the dock orb is the plain hold-to-command: no
// radial, a command take, "open calendar" opens Calendar, nothing reaches the agent. Settings > Phone has no Orb
// switcher row, saved radial pins stay untouched in storage, a saved "short takes run as commands" no longer applies
// (a tap is a message take), and an old wizard/orb-radial tweak choice changes nothing. 412 and 360 px.
// Usage: node qa-orb-radial.cjs   (QA_WEB_DIR=<tree with web/>, QA_SHOTS=<dir> for screenshots, QA_CHROME=<chrome>)
// Self-contained: every Wizard request is answered by this file (shell served from the tree, everything else stubbed);
// every non-GET Wizard write is recorded and refused, and the suite asserts nothing reached the agent (/v1/runs).
const { chromium } = require('../../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('../../tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || QA_ROOT;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const THREADS = Array.from({ length: 4 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview', last_active: NOW / 1000 - i * 600, started_at: NOW / 1000 - i * 600 - 60 }));
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const R = { words: 'open calendar', cmd: { route: 'agent' } };
const log = { writes: [], routes: [], stt: 0, uploads: 0 }, allRunRequests = [];
const APPS = [['wizard-search', 'Search'], ['notes', 'Notes'], ['wizard-calendar', 'Calendar'], ['stories', 'Stories'], ['wisdom', 'Wisdom'], ['wizard-music', 'Wizard Music'], ['topics', 'Topics'], ['files-qa', 'Files']];
// What would reach the agent: a run, a new session. (The take's own audio custody upload is not a message.)
const runs = () => allRunRequests;

async function boot(b, vp = { width: 412, height: 892 }, seed = {}, enable = true) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'], serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' });
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (m !== 'GET' && /\/v1\/runs|\/sessions$/.test(u.pathname)) allRunRequests.push(m + ' ' + u.pathname);
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
  await ready(p, enable);
  return { ctx, p };
}
async function ready(p) {
  await p.waitForFunction(() => window.__wos?.live?.ok && window.WosExperience && !WosExperience.state.busy && window.WizCore?.phoneSections, null, { timeout: 30000 });
  await p.waitForFunction(() => window.WizCore.apps && document.querySelector('#search'), null, { timeout: 10000 });
  await sleep(1200);
}
const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
// Real touch events (pointerType touch), so the suite exercises what a thumb does.
const T = (p, type, x, y) => p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
async function orbXY(p) { const r = await p.locator('#orbWrap').boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
const radialShown = p => p.evaluate(() => !!document.querySelector('.wor') || document.body.classList.contains('wor-open') || !!window.WosOrbSwitcher?.isOpen);
const st = p => p.evaluate(() => ({ voice: __wos.voice, kind: __wos.V.kind, sheet: __wos.sheet }));
const SAVED = JSON.stringify({ pins: ['wizard-calendar', 'notes'], voiceSlot: 'far', holdMs: 450, quickTakes: true });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
  for (const oldChoice of [true, false]) {
    const { ctx: oldCtx, p: old } = await boot(b, undefined, { 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, off: {}, preset: 'none', mix: { 'wizard/orb-radial': oldChoice } }) });
    const oo = await orbXY(old); await T(old, 'touchStart', oo.x, oo.y); await sleep(650);
    ok(!await radialShown(old) && (await st(old)).voice === 'command', 'old wizard/orb-radial choice ' + oldChoice + ': a hold is a command, never the radial');
    await T(old, 'touchEnd'); await sleep(300); await old.evaluate(() => __wos.cancelVoice(true)); await oldCtx.close();
  }
  for (const vp of [{ width: 412, height: 892 }, { width: 360, height: 780 }]) {
    const tag = vp.width + 'px';
    log.stt = 0; log.writes.length = 0;
    const { ctx, p } = await boot(b, vp, { 'wos.orbSwitcher.v1': SAVED });
    ok(await p.evaluate(() => WizCore.phoneSections.on()), tag + ': the four-section bar is on');
    ok(await p.evaluate(() => !window.WosOrbSwitcher?.active() && !window.WosOrbSwitcher?.available), tag + ': the radial is off while the bar is on');
    let o = await orbXY(p);
    // Hold: the plain hold-to-command.
    await T(p, 'touchStart', o.x, o.y); await sleep(700);
    let s = await st(p);
    ok(!await radialShown(p), tag + ': holding the orb opens no radial');
    ok(s.voice === 'command' && s.kind === 'command', tag + ': holding the orb starts a command take', JSON.stringify(s));
    await shot(p, 'orb-hold-command-' + tag);
    await sleep(600); await T(p, 'touchEnd');
    await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 15000 }).catch(() => {}); await sleep(1500);
    const front = await p.evaluate(() => { const d = __wos.desks[__wos.idx]; return d.wins.map(w => __wos.wins[w].appId || __wos.wins[w].app); });
    ok(log.stt === 1, tag + ': release finishes the take (one transcription)', String(log.stt));
    ok(front.includes('wizard-calendar'), tag + ': "open calendar" ran as a command and Calendar is in front', JSON.stringify(front));
    ok(await p.evaluate(() => WizCore.phoneSections.current() === 'apps'), tag + ': spoken "open <app>" lands in the Apps section');
    // A jittered hold is still a command, still no radial.
    await p.evaluate(() => __wos.goDesk(0)); await sleep(700); o = await orbXY(p);
    await T(p, 'touchStart', o.x, o.y); await sleep(450); await T(p, 'touchMove', o.x + 3, o.y - 3); await sleep(300);
    ok(!await radialShown(p) && (await st(p)).voice === 'command', tag + ': a jittered hold is still a command, no radial');
    await T(p, 'touchEnd'); await sleep(300); await p.evaluate(() => __wos.cancelVoice(true)); await sleep(600);
    // Tap: a plain take even though the saved radial option said short takes run as commands.
    await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 8000 }).catch(() => {});
    await T(p, 'touchStart', o.x, o.y); await sleep(60); await T(p, 'touchEnd'); await sleep(600);
    s = await st(p);
    ok(['listen', 'paused'].includes(s.voice) && s.kind !== 'command', tag + ': a tap starts a message take', JSON.stringify(s));
    ok(await p.evaluate(() => !(window.WosOrbSwitcher?.active() && WosOrbSwitcher.get().quickTakes) && JSON.parse(localStorage.getItem('wos.orbSwitcher.v1')).quickTakes === true), tag + ': saved "short takes run as commands" no longer applies');
    await p.evaluate(() => __wos.cancelVoice(true)); await sleep(700);
    // Swipe up still opens the App selector.
    await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 8000 }).catch(() => {});
    await T(p, 'touchStart', o.x, o.y); for (let i = 1; i <= 8; i++) { await T(p, 'touchMove', o.x, o.y - 150 * i / 8); await sleep(12); } await T(p, 'touchEnd'); await sleep(600);
    ok((await st(p)).sheet === 'launcher', tag + ': swipe up opens the App selector');
    await p.evaluate(() => __wos.closeSheets()); await sleep(400);
    // Settings > Phone: no Orb switcher row.
    await p.evaluate(() => __wos.openSheet('settings')); await sleep(500);
    const phonePage = p.locator('[data-st-page=phone]');
    if (await phonePage.count()) { await phonePage.first().click(); await sleep(500); }
    ok(await p.locator('[data-orbsw], [data-orbsw-open]').count() === 0, tag + ': Settings > Phone has no Orb switcher row');
    await shot(p, 'settings-phone-' + tag);
    await p.evaluate(() => __wos.closeSheets()); await sleep(300);
    ok(await p.evaluate(s => localStorage.getItem('wos.orbSwitcher.v1') === s, SAVED), tag + ': saved radial pins stay untouched in storage');
    ok(p.errs.length === 0, tag + ': no browser JS errors', JSON.stringify(p.errs));
    await ctx.close();
  }
  ok(runs().length === 0, 'zero /v1/runs or new session writes throughout all scenarios', JSON.stringify(runs()));
  console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
