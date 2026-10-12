// QA: every app opens on its own new desk beside the one in front (shell rule, James 12 Oct 2026),
// including Usuals by voice ("open usuals"), which used to split into the desk in front.
// Usage: node qa-apps-own-desk.cjs [origin=http://127.0.0.1:9466/]   (every write is intercepted)
let pw; try { pw = require('/home/telos/node_modules/playwright'); } catch (e) { pw = require('playwright-core'); }
const URL_ = process.argv[2] || 'http://127.0.0.1:9466/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch/apps-own-desk';
require('fs').mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url());
    if (u.pathname.startsWith('/qa-page/')) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>QA</title><body>QA page</body>' });
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && u.origin === ORIGIN) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    // Usuals is listed only on the phone: stand in for the native bridge (read-only list, no Grab).
    window.WizardOSNative = Object.assign(window.WizardOSNative || {}, {
      usuals: () => JSON.stringify({ list: [{ id: 'u1', name: 'Kra pao', shop: 'QA shop', steps: [1, 2, 3] }], blocker: '', state: {} }),
      usualsMatch: () => '', usualsRun: () => '', usualsTeach: () => '',
    });
  });
  await p.goto(URL_); await p.waitForFunction(() => window.__wos && window.__wos.desks, null, { timeout: 20000 }); await p.waitForTimeout(2500);
  const S = () => p.evaluate(() => ({ idx: __wos.idx, n: __wos.desks.length, names: __wos.desks.map(d => d.home ? 'Home' : d.wins.map(id => __wos.wins[id].app + (__wos.wins[id].appId ? ':' + __wos.wins[id].appId : '')).join('+')) }));
  const snap = () => ({ snap: { view: null } }); // voice-shaped opts: a spoken command with no aim

  // 1. "Open usuals" by voice from the Chats desk (a window already there): own desk beside, not a split.
  await p.evaluate(() => __wos.goDesk(1, true)); await p.waitForTimeout(500);
  let s0 = await S();
  await p.evaluate(o => __wos.execute({ action: 'open_app', app: 'usuals' }, 'open usuals', o), snap()); await p.waitForTimeout(900);
  let s = await S();
  ok(s.n === s0.n + 1 && s.idx === s0.idx + 1 && s.names[s.idx] === 'usuals', 'voice "open usuals" from Chats: new desk right beside, Usuals alone on it', JSON.stringify({ s0, s }));
  ok(s.names[s0.idx] === s0.names[s0.idx], 'the Chats desk is untouched (no split)', JSON.stringify({ s0, s }));
  await p.screenshot({ path: `${SHOTS}/01-usuals-own-desk.png` });

  // 2. Saying it again while Usuals is open: goes to it, no second desk.
  await p.evaluate(() => __wos.goDesk(1, true)); await p.waitForTimeout(400);
  s0 = await S();
  await p.evaluate(o => __wos.execute({ action: 'open_app', app: 'usuals' }, 'open usuals', o), snap()); await p.waitForTimeout(700);
  s = await S();
  ok(s.n === s0.n && s.names[s.idx] === 'usuals', 'second "open usuals": goes to the open Usuals desk, no duplicate', JSON.stringify({ s0, s }));
  await p.evaluate(() => __wos.closeWin(__wos.desks[__wos.idx].focus)); await p.waitForTimeout(500);

  // 3. From Home: Usuals opens on the desk right beside Home.
  await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(500);
  s0 = await S();
  await p.evaluate(o => __wos.execute({ action: 'open_app', app: 'usuals' }, 'open usuals', o), snap()); await p.waitForTimeout(800);
  s = await S();
  ok(s.n === s0.n + 1 && s.idx === 1 && s.names[1] === 'usuals', 'from Home: Usuals opens on its own desk right beside Home', JSON.stringify({ s0, s }));
  await p.evaluate(() => __wos.closeWin(__wos.desks[__wos.idx].focus)); await p.waitForTimeout(500);

  // 4. Sweep: every app opened by voice from a desk that already holds a window gets a fresh desk of its own.
  const appIds = await p.evaluate(async () => {
    __wos.openSheet('launcher'); await new Promise(r => setTimeout(r, 600));
    const m = new Map(); document.querySelectorAll('[data-app]').forEach(e => m.set(e.dataset.app, e.querySelector('.nm')?.firstChild?.textContent?.trim() || e.dataset.app)); const xs = [...m.entries()];
    __wos.closeSheets(true); return xs;
  });
  const skip = new Set(['side-button', 'v-inbox', 'wizard', 'chats']); // side key / inbox sheet / Chats (one shared Chats desk)
  // Each case: an opener as James triggers it. Single-instance apps already open are reused (jump to their desk).
  const cases = appIds.filter(([id]) => !skip.has(id)).map(([id, nm]) => [`${id} ("open ${nm}")`, `__wos.execute({ action: 'open_app', app: ${JSON.stringify(nm)} }, 'open ${nm}', o)`]);
  cases.push(['wizard app (frame)', `__wos.openApp({ id: 'qa-frame', kind: 'wizard', url: '/qa-page/frame/', name: 'QA Frame' }, {}, o)`]);
  cases.push(['android app', `__wos.openApp({ id: 'qa-native', kind: 'native', name: 'QA Native' }, {}, o)`]);
  cases.push(['maps search', `__wos.execute({ action: 'maps_search', query: 'coffee' }, 'map coffee', o)`]);
  cases.push(['directions', `__wos.execute({ action: 'directions', destination: 'airport' }, 'directions to airport', o)`]);
  const tested = [];
  for (const [id, code] of cases) {
    await p.evaluate(() => __wos.goDesk(1, true)); await p.waitForTimeout(300);
    s0 = await S();
    const r = await p.evaluate(([code, o]) => { const before = new Set(Object.keys(__wos.wins)); (new Function('o', code))(o); return [...Object.keys(__wos.wins)].filter(x => !before.has(x)); }, [code, snap()]);
    await p.waitForTimeout(500);
    s = await S();
    const front = await p.evaluate(() => { const d = __wos.desks[__wos.idx]; return { alone: d.wins.length === 1, app: __wos.wins[d.focus]?.app }; });
    ok(s.idx !== s0.idx && s.names[s0.idx] === s0.names[s0.idx] && front.alone && (r.length ? s.n === s0.n + 1 : s.n === s0.n),
      `open ${id}: lands alone on its own desk (${r.length ? 'new desk beside' : 'already open, jumped to it'}), desk in front untouched`, JSON.stringify({ r, s0: s0.names, s: s.names, front }));
    tested.push(id);
    if (r[0]) await p.evaluate(w => __wos.closeWin(w), r[0]); await p.waitForTimeout(250);
  }
  ok(tested.length >= 8, `sweep covered ${tested.length} openers`, JSON.stringify(appIds));
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed · apps: ${tested.join(', ')}`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
