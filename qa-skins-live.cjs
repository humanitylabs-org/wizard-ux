// QA: live skins + battery-gated scenery (core/scenery.js, core/skins.js, Settings → Look). James, 12 Oct 2026:
// "keep animated backgrounds only if they don't drain battery when not viewed; animate on the home screen, pause
// when an app is open"; Paper dropped; Nebula (default) animates again under the same gate.
// For EACH of the five skins:
//  a  Home, freshly touched: scenery rAF callbacks > 0 over 2 s (live)
//  b  app open on another desk (deep link ?open=wisdom), app full screen, Settings sheet open, page hidden,
//     Home idle past the timeout (test hook WosScenery.setIdle): scenery rAF == 0 over 3 s, zero running
//     decorative animations (.nebula / skin canvases / stars)
//  c  back on Home (real tap on the dock's Home sigil) resumes; a touch after idle resumes
// Plus: Paper absent (WosSkin.list + picker); real taps in Settings → Look change html[data-skin], persist across
// reload and re-dress an open hosted app (Wisdom) through the appearance host without reloading it; ?view=skin and
// the "change skin" command open Settings at Look; Settings Back closes the sheet and Wizard stays open;
// prefers-reduced-motion never goes live; every non-GET is refused (403) and zero agent writes happen.
// Usage: node qa-skins-live.cjs [origin=http://127.0.0.1:9381/wizard-os-home/]   (QA_WEB_DIR=<repo> serves that tree's shell over the origin)
//   QA_APP=wisdom,wizard-music,… hosted app to open (first one with a URL in the live registry)
//   QA_CHROME=<chrome binary>  QA_SHOTS=<dir>  QA_REQUIRE_HOSTED=1 (Wisdom must re-dress)  QA_REAL_IDLE=1 (also wait the real 45 s)
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/telos/node_modules/playwright'); }
const fs = require('fs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch/skins-live'; fs.mkdirSync(SHOTS, { recursive: true });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const WEB = process.env.QA_WEB_DIR || '';
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
const SKINS = ['nebula', 'grove', 'tide', 'ember', 'signal'];
let pass = 0, fail = 0, skip = 0; const receipt = { origin: URL_, at: new Date().toISOString(), skins: {}, checks: [] };
const ok = (c, n, x = '') => { c ? pass++ : fail++; receipt.checks.push({ ok: !!c, name: n, extra: String(x).slice(0, 300) }); console.log(c ? 'PASS' : 'FAIL', n, x); };
const sk = (n, x = '') => { skip++; receipt.checks.push({ ok: null, name: n, extra: x }); console.log('SKIP', n, x); };

const INIT = () => {
  try { if (location.protocol.startsWith('http')) { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } } catch (e) {}
  // count rAF callbacks; scenery callbacks are the named wosScenery* functions
  const R = window.__raf = { total: 0, scenery: 0, byName: {} };
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) { return orig(function (t) { const n = (cb && cb.name) || 'anon'; R.total++; if (/^wosScenery/.test(n)) R.scenery++; R.byName[n] = (R.byName[n] || 0) + 1; return cb(t); }); };
  // appearance messages a hosted app receives (frames)
  addEventListener('message', e => { const d = e.data; if (d && d.type === 'wizard:appearance' && d.appearance) (window.__appMsgs = window.__appMsgs || []).push(d.appearance.skin); });
  window.__qaBoot = window.__qaBoot || Math.random().toString(36).slice(2);
  if (window.top === window) {
    window.__qaHidden = false;
    const H = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden'), V = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'hidden', { configurable: true, get() { return window.__qaHidden || H.get.call(document); } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get() { return window.__qaHidden ? 'hidden' : V.get.call(document); } });
    window.__qaHide = on => { window.__qaHidden = !!on; document.dispatchEvent(new Event('visibilitychange')); };
  }
};
const DECOR = () => document.getAnimations().filter(a => { const t = a.effect && a.effect.target; return a.playState === 'running' && t && t.closest && (t.closest('.nebula') || t.matches('.skin-bg, #stars')); }).length;

(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const mkctx = async (extra = {}) => {
    const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: UA, ignoreHTTPSErrors: true, ...extra });
    const writes = [];
    await ctx.route('**/*', r => { const q = r.request();
      // QA_WEB_DIR=<repo>: serve that tree's shell files over the real origin (pre-ship check with real hosted apps).
      if (WEB && q.method() === 'GET') { const u = new URL(q.url()); const m = u.origin === ORIGIN && u.pathname.match(/^\/wizard-os-home\/(.*)$/); if (m) { const f = require('path').join(WEB, 'web', decodeURIComponent(m[1]) || 'index.html'); if (!f.includes('..') && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': TYPES[require('path').extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' } }); } }
      if (q.method() === 'GET' || q.method() === 'HEAD') return r.continue(); writes.push(q.method() + ' ' + new URL(q.url()).pathname); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"qa refuses writes"}' }); });
    await ctx.addInitScript(INIT);
    return { ctx, writes };
  };
  const { ctx, writes } = await mkctx();
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  await p.goto(URL_, { waitUntil: 'load' }); await p.waitForTimeout(3500);

  const st = () => p.evaluate(() => ({ ...WosScenery.state(), skin: document.documentElement.dataset.skin, idx: __wos.idx, sheet: __wos.sheet }));
  const touch = async () => { await p.touchscreen.tap(206, 12); await p.waitForTimeout(150); }; // status bar: a neutral spot, pointerdown re-arms
  async function measure(ms) {
    const a = await p.evaluate(() => ({ s: __raf.scenery, t: __raf.total, n: { ...__raf.byName } })); const m0 = await metrics();
    await p.waitForTimeout(ms);
    const z = await p.evaluate(() => ({ s: __raf.scenery, t: __raf.total, n: { ...__raf.byName } })); const m1 = await metrics();
    const decor = await p.evaluate(DECOR);
    const by = {}; for (const k in z.n) { const d = z.n[k] - (a.n[k] || 0); if (d) by[k] = d; }
    return { scenery: z.s - a.s, total: z.t - a.t, decor, byName: by, taskMs: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000), scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000) };
  }
  const home = async () => { await p.evaluate(() => { __wos.closeSheets(true); if (__wos.idx !== 0) __wos.goDesk(0, true); }); await p.waitForTimeout(900); };
  const tapEl = async sel => { const r = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2; const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; }, sel); if (r) await p.touchscreen.tap(r.x, r.y); return r; };

  // Hosted app to open: Wisdom first (James's brief), else the next appearance-client app in the live registry.
  const APP = await p.evaluate(want => { const A = WizCore.apps('mobile').APPS; for (const id of want) { const a = A.find(x => x.id === id && x.url); if (a) return { id, url: a.url }; } return null; }, (process.env.QA_APP || 'wisdom,wizard-music,topics,wizard-signal').split(','));
  receipt.app = APP; console.log('hosted app:', JSON.stringify(APP));
  if (!APP || APP.id !== 'wisdom') console.log('NOTE: Wisdom has no URL in this registry (GET /wizard/v1/apps) — using', APP && APP.id);
  const openApp = () => p.evaluate(id => WizCore.deeplink.route(location.pathname + '?open=' + id), APP.id);
  const APATH = APP.url.replace(/[#?].*$/, ''); const appRe = { test: u => String(u || '').startsWith(APATH) || String(u || '').includes(APATH) };

  // ---------- Paper is gone ----------
  const list = await p.evaluate(() => WosSkin.list.map(s => s.id));
  ok(JSON.stringify(list.slice(0, 5)) === JSON.stringify(SKINS) && !list.includes('paper'), 'WosSkin.list starts with the five Wizard palettes, no Paper (Mizel palettes follow)', list.join(','));
  ok(await p.evaluate(() => document.documentElement.dataset.skin === 'nebula' && !document.documentElement.style.getPropertyValue('--ink')), 'default is Nebula with no inline tokens');

  // ---------- per skin ----------
  const BOXES = () => ['.home-time', '.home-desk .now-card', '#dock', '#orbWrap', '.statusbar'].map(q => { const e = document.querySelector(q); if (!e) return q + ':none'; const r = e.getBoundingClientRect(); return `${q}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`; });
  let box0 = null;
  for (const id of SKINS) {
    const R = receipt.skins[id] = {};
    await p.evaluate(s => WosSkin.set(s), id); await home(); await touch(); await p.waitForTimeout(700);
    const bx = await p.evaluate(BOXES); if (!box0) box0 = bx;
    ok(JSON.stringify(bx.map(x => x.replace(/^(\.home-time:-?\d+,-?\d+),.*$/, '$1'))) === JSON.stringify(box0.map(x => x.replace(/^(\.home-time:-?\d+,-?\d+),.*$/, '$1'))), `${id}: same layout boxes as Nebula (clock size may follow its typeface)`, JSON.stringify(bx));
    // a: live on Home
    let m = await measure(2000), s = await st(); R.homeLive = { ...m, why: s.why };
    ok(s.live && m.scenery > 0, `${id}: Home touched → live, scenery rAF > 0 over 2 s`, JSON.stringify({ rafs: m.scenery, why: s.why, decor: m.decor }));
    if (id === 'nebula') ok(m.decor === 3, 'nebula: drift running on the 3 nebula blobs while live', m.decor);
    else ok(m.decor === 0 && await p.evaluate(() => +getComputedStyle(document.getElementById('skinA')).opacity > .9), `${id}: skin canvas on, nebula drift paused (hidden sky costs nothing)`, m.decor);
    await p.screenshot({ path: `${SHOTS}/${id}-home.png` });
    // b1: app open on another desk
    await openApp(); await p.waitForTimeout(3000);
    s = await st(); m = await measure(3000); R.appOpen = { ...m, why: s.why };
    ok(s.idx !== 0 && !s.live && m.scenery === 0 && m.decor === 0, `${id}: ${APP.id} open on desk ${s.idx} → frozen (0 scenery rAF / 3 s, 0 decorative animations)`, JSON.stringify({ why: s.why, rafs: m.scenery, decor: m.decor, total: m.total }));
    await p.screenshot({ path: `${SHOTS}/${id}-${APP.id}.png` });
    // b2: that app full screen
    await p.evaluate(() => { const d = __wos.desks[__wos.idx]; if (d.focus) __wos.setFull(d.focus, true); }); await p.waitForTimeout(1200);
    s = await st(); m = await measure(3000); R.fullscreen = { ...m, why: s.why };
    ok(await p.evaluate(() => document.getElementById('device').classList.contains('immersive')) && !s.live && m.scenery === 0 && m.decor === 0, `${id}: full-screen app → frozen`, JSON.stringify({ why: s.why, rafs: m.scenery, decor: m.decor }));
    await p.evaluate(() => { const d = __wos.desks[__wos.idx]; if (d.focus) __wos.setFull(d.focus, false); });
    // c1: back to Home by a real tap on the dock's Home sigil resumes
    await p.waitForTimeout(700);
    const hb = await tapEl('#dock .ddot.dhome'); await p.waitForTimeout(1000);
    s = await st(); m = await measure(2000); R.backHome = { ...m, why: s.why };
    ok(hb && hb.hit && s.idx === 0 && s.live && m.scenery > 0, `${id}: tap Home sigil → Home live again`, JSON.stringify({ idx: s.idx, why: s.why, rafs: m.scenery, hit: hb && hb.hit }));
    // b3: Settings sheet over Home
    await touch(); await p.evaluate(() => __wos.openSettings()); await p.waitForTimeout(800);
    s = await st(); m = await measure(3000); R.settings = { ...m, why: s.why };
    ok(s.sheet === 'settings' && !s.live && m.scenery === 0 && m.decor === 0, `${id}: Settings sheet open → frozen`, JSON.stringify({ why: s.why, rafs: m.scenery, decor: m.decor }));
    await home(); await touch();
    // b4: page hidden
    await p.evaluate(() => __qaHide(true)); await p.waitForTimeout(300);
    s = await st(); m = await measure(3000); R.hidden = { ...m, why: s.why };
    ok(!s.live && s.why === 'hidden' && m.scenery === 0 && m.decor === 0, `${id}: page hidden → frozen`, JSON.stringify({ why: s.why, rafs: m.scenery, decor: m.decor }));
    await p.evaluate(() => __qaHide(false)); await p.waitForTimeout(500);
    ok((await st()).live, `${id}: visible again → live`);
    // b5: Home idle past the timeout (hook shortens 45 s → 1.5 s)
    await p.evaluate(() => WosScenery.setIdle(1500)); await p.waitForTimeout(1900);
    s = await st(); m = await measure(3000); R.idle = { ...m, why: s.why };
    ok(!s.live && s.why === 'idle' && m.scenery === 0 && m.decor === 0, `${id}: Home idle past timeout → frozen`, JSON.stringify({ why: s.why, rafs: m.scenery, decor: m.decor }));
    await touch(); m = await measure(1000);
    ok(m.scenery > 0, `${id}: a touch after idle resumes`, m.scenery);
    await p.evaluate(() => WosScenery.setIdle(45000));
  }
  await p.evaluate(() => WosSkin.set('nebula')); await home();

  // ---------- real 45 s idle (default timeout), optional ----------
  if (process.env.QA_REAL_IDLE) {
    await touch(); await p.waitForTimeout(46000);
    const s = await st(), m = await measure(3000); receipt.realIdle = { ...m, why: s.why };
    ok(!s.live && s.why === 'idle' && m.scenery === 0 && m.decor === 0, 'Nebula: real 45 s idle on Home → frozen', JSON.stringify({ why: s.why, rafs: m.scenery }));
  }

  // ---------- picker: real taps, persistence, hosted-app re-dress ----------
  await openApp(); await p.waitForTimeout(5000);
  const wf = () => p.frames().find(f => f !== p.mainFrame() && appRe.test(new URL(f.url()).pathname));
  let frame = wf(); const boot0 = frame ? await frame.evaluate(() => window.__qaBoot).catch(() => null) : null;
  const themedBefore = await p.evaluate(() => WizAppearance.inspect());
  await p.evaluate(() => WizCore.deeplink.route(location.pathname + '?view=skin')); await p.waitForTimeout(1000);
  const look = await p.evaluate(() => { const g = document.querySelector('#settingsBody [data-stgroup="look"]'), body = document.querySelector('#settingsBody'); if (!g) return null; const a = g.getBoundingClientRect(), c = body.getBoundingClientRect(); return { top: Math.round(a.top - c.top), sheet: __wos.sheet, opts: [...g.querySelectorAll('[data-skinpick]')].map(b => b.dataset.skinpick), sizes: [...g.querySelectorAll('[data-skinpick]')].map(b => { const r = b.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }), shellY: document.scrollingElement.scrollTop }; });
  ok(look && look.sheet === 'settings' && look.top >= -2 && look.top < 120 && look.shellY === 0, '?view=skin opens Settings at Look', JSON.stringify(look));
  ok(look && JSON.stringify(look.opts) === JSON.stringify(SKINS), 'picker shows the five skins, no Paper', look && look.opts.join(','));
  ok(look && look.sizes.every(v => v >= 44), 'every swatch is a ≥44 px touch target', look && look.sizes.join(','));
  await p.screenshot({ path: `${SHOTS}/settings-look.png` });
  const t1 = await tapEl('#settingsBody [data-skinpick="tide"]'); await p.waitForTimeout(900);
  let pk = await p.evaluate(() => ({ skin: document.documentElement.dataset.skin, stored: localStorage.getItem('wos.skin'), pressed: document.querySelector('#settingsBody [data-skinpick="tide"]').getAttribute('aria-pressed'), sheet: __wos.sheet }));
  ok(t1 && t1.hit && pk.skin === 'tide' && pk.stored === 'tide' && pk.pressed === 'true' && pk.sheet === 'settings', 'real tap on Tide: html[data-skin]=tide, saved, checked, sheet stays', JSON.stringify(pk));
  await p.screenshot({ path: `${SHOTS}/settings-look-tide.png` });
  frame = wf();
  const after = await p.evaluate(() => WizAppearance.inspect());
  const msgs = frame ? await frame.evaluate(() => window.__appMsgs || []).catch(() => null) : null;
  const boot1 = frame ? await frame.evaluate(() => window.__qaBoot).catch(() => null) : null;
  receipt.hosted = { themedBefore, after, msgs, sameDoc: !!boot0 && boot0 === boot1 };
  const acked = after.some(x => appRe.test(x.src || '') && x.acked);
  if (acked || process.env.QA_REQUIRE_HOSTED) ok(acked && msgs && msgs[msgs.length - 1] === 'tide' && boot0 && boot0 === boot1, `open ${APP.id} re-dressed to Tide via the appearance host, not reloaded`, JSON.stringify(receipt.hosted).slice(0, 300));
  else sk(`${APP.id} re-dress (appearance client did not load on this origin)`, JSON.stringify(after));
  // Back closes Settings, Wizard stays
  const back = await p.evaluate(() => { const r = window.__wosNativeBack ? window.__wosNativeBack() : __wos.onBack(); return { r, sheet: __wos.sheet, log: (__wos.back.log || []).slice(-1)[0] }; });
  await p.waitForTimeout(400);
  ok(back.sheet === null && /wizard-os-home/.test(p.url()) && await p.evaluate(() => !!document.querySelector('#orbWrap')), 'Back from Settings closes the sheet; Wizard stays open', JSON.stringify(back));
  await p.screenshot({ path: `${SHOTS}/tide-${APP.id}-after-pick.png` }); // the open app, re-dressed in place
  // reload keeps the skin
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(3000);
  ok(await p.evaluate(() => document.documentElement.dataset.skin === 'tide' && WosSkin.current === 'tide'), 'reload keeps Tide');
  // "change skin" command opens Settings at Look (no agent call)
  await home();
  await p.evaluate(() => __wos.handleText('change skin', 'command', false, 300, null)); await p.waitForTimeout(900);
  ok(await p.evaluate(() => __wos.sheet === 'settings' && !!document.querySelector('#settingsBody [data-stgroup="look"]')), '"change skin" command opens Settings → Look');
  // pick Nebula back by real tap
  await tapEl('#settingsBody [data-skinpick="nebula"]'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => document.documentElement.dataset.skin === 'nebula' && localStorage.getItem('wos.skin') === 'nebula' && !document.documentElement.style.getPropertyValue('--ink')), 'tap Nebula: back to the original look, no inline tokens');
  await p.evaluate(() => __wos.closeSheets());

  // ---------- reduced motion never animates ----------
  const c2 = await mkctx({ reducedMotion: 'reduce' }); const p2 = await c2.ctx.newPage();
  await p2.goto(URL_, { waitUntil: 'load' }); await p2.waitForTimeout(3000); await p2.touchscreen.tap(206, 12); await p2.waitForTimeout(300);
  const a2 = await p2.evaluate(() => __raf.scenery); await p2.waitForTimeout(2000);
  const r2 = await p2.evaluate(d => ({ rafs: __raf.scenery, st: WosScenery.state(), decor: eval('(' + d + ')')() }), DECOR.toString());
  ok(r2.rafs - a2 === 0 && !r2.st.live && r2.st.why === 'reduced-motion' && r2.decor === 0, 'prefers-reduced-motion: never live', JSON.stringify({ rafs: r2.rafs - a2, why: r2.st.why }));
  writes.push(...c2.writes);

  const agent = writes.filter(x => /\/v1\/runs|\/api\/sessions|\/hermes\//.test(x));
  ok(agent.length === 0, 'zero agent writes', agent.join(','));
  receipt.refusedWrites = writes;
  ok(errs.length === 0, 'zero page errors', errs.join(' | '));
  receipt.pass = pass; receipt.fail = fail; receipt.skip = skip;
  fs.writeFileSync(`${SHOTS}/receipt.json`, JSON.stringify(receipt, null, 1));
  await b.close(); console.log(`\n${pass} pass, ${fail} fail, ${skip} skip`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
