// Chats pull-to-refresh + "Not up to date" bar (James, 21 Oct 2026: "Give me a swipe down to refresh gesture. I'm
// staring at this chat list and I don't think it's up to date" / "if there's an error connecting and my chats are out
// of date, the UX should display something"). Self-contained fake Wizard on https://wizard.test; every write is
// refused. Real touch input through CDP. Asserts: a pull at the top re-reads the list now, with "Release to refresh",
// "Refreshing…" and "Up to date" states; a short pull, a sideways drag and a pull from a scrolled list do nothing;
// rows still open after a pull; a failed read says "Not up to date · last updated …" with the Troubleshooter; a list
// older than a minute says so; a hung read gives up (30 s) and says so; no page errors.
// Usage: QA_TREE=<repo> [QA_PLAYWRIGHT=<playwright>] [QA_FALLBACK_WEB=<web dir>] [QA_SKIP_HANG=1] node qa-chats-pull-refresh.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname, FALLBACK = process.env.QA_FALLBACK_WEB || require('node:path').join(require('./tools/qa-paths.cjs').repoRoot, 'web');
const OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('');
const PAGE_MS = 1200;
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' ' + JSON.stringify(d) : ''}`); };
const N = 60, now = Date.now() / 1000;
const S = Array.from({ length: N }, (_, i) => ({ id: `s${i}`, title: `Thread ${i}`, source: 'wizard-mobile', message_count: 4, last_active: now - 600 - i * 3600, started_at: now - 600 - i * 3600, archived: false, hidden: false, status: null, preview: `preview ${i}` }));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const reads = []; let writes = 0, mode = 'ok';
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== 'wizard.test') return r.abort();
    if (!['GET', 'HEAD'].includes(q.method())) { writes++; return r.fulfill({ status: 403, contentType: 'application/json', body: '{}' }); }
    if (u.pathname === '/wizard/hermes/api/sessions') {
      reads.push(Date.now());
      if (mode === 'fail') return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"down"}}' });
      if (mode === 'hang') { await sleep(40000); return r.abort().catch(() => {}); }
      const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 100;
      if (u.searchParams.get('agent')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [], has_more: false }) });
      await sleep(PAGE_MS);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: S.slice(off, off + lim), limit: lim, offset: off, has_more: off + lim < N, snapshot: 'snap' }) }).catch(() => {});
    }
    if (u.pathname === '/wizard/thread-seen') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: 1, threads: {} } }) });
    if (u.pathname.startsWith('/wizard/') || u.pathname.startsWith('/troubleshoot')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m) {
      const rel = m[1] || 'index.html'; let f = path.join(TREE, 'web', rel);
      if (!fs.existsSync(f)) f = path.join(FALLBACK, rel);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : rel.endsWith('.png') ? 'image/png' : rel.endsWith('.svg') ? 'image/svg+xml' : rel.endsWith('.json') ? 'application/json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(f) });
    }
    return r.fulfill({ status: 404, body: '' });
  });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.WizCore?.apps, null, { timeout: 20000 });
  await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')));
  const wid = await p.waitForFunction(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.id || '', null, { timeout: 10000 }).then(h => h.jsonValue());
  const W = `[data-chats="${wid}"]`;
  await p.waitForSelector(`${W} .ch-row[data-chopen]`, { timeout: 30000 });
  await p.waitForFunction(() => !WizLive.loading, null, { timeout: 20000 });
  await sleep(500);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 1 })) });
  const box = async () => p.evaluate(s => { const r = document.querySelector(s + ' .ch-list > .ch-scroll').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 30 }; }, W);
  const state = () => p.evaluate(s => ({ ptrH: document.querySelector(s + ' .ch-ptr')?.getBoundingClientRect().height ?? -1, ptrText: document.querySelector(s + ' .ch-ptr')?.innerText || '', sync: document.querySelector(s + ' .ch-sync')?.innerText || '', top: document.querySelector(s + ' .ch-scroll')?.scrollTop }), W);
  async function drag(dx, dy, { hold = null, steps = 14 } = {}) {
    const o = await box(); await touch('touchStart', [[o.x, o.y]]);
    let mid = null;
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[o.x + dx * i / steps, o.y + dy * i / steps]]); await sleep(16); if (i === steps && hold) mid = await state(); }
    const t = Date.now(); await touch('touchEnd', []); return { t, mid };
  }
  const readsAfter = (t, ms = 700) => reads.filter(x => x >= t && x < t + ms).length;
  const waitIdle = () => p.waitForFunction(() => !WizLive.loading, null, { timeout: 40000 }).catch(() => {});

  // 1. Full pull at the top.
  await waitIdle(); await p.evaluate(s => { document.querySelector(s + ' .ch-scroll').scrollTop = 0; }, W);
  const pull = await drag(0, 240, { hold: true });
  ok(pull.mid && pull.mid.ptrH >= 40 && /Release to refresh/.test(pull.mid.ptrText), 'while pulling: indicator open and says "Release to refresh"', pull.mid);
  await sleep(450);
  ok(readsAfter(pull.t) >= 1, 'releasing re-reads the list now', reads.filter(x => x >= pull.t).map(x => x - pull.t));
  const busy = await state();
  ok(/Refreshing/.test(busy.sync), 'shows "Refreshing…" while the read runs', busy.sync);
  await p.screenshot({ path: path.join(OUT, 'ptr-refreshing.png') });
  await waitIdle(); await sleep(450);
  const done = await state();
  ok(/Up to date/.test(done.sync), 'then flashes "Up to date"', done.sync);
  await sleep(2000);
  const after = await state();
  ok(!after.sync && after.ptrH === 0, 'then the bar and indicator clear', after);

  // 2. Gestures that must not refresh.
  await waitIdle(); await sleep(300);
  const short = await drag(0, 50); await sleep(600);
  ok(readsAfter(short.t) === 0, 'a short pull does not refresh', readsAfter(short.t));
  await waitIdle(); await sleep(300);
  const side = await drag(-200, 30); await sleep(600);
  ok(readsAfter(side.t) === 0, 'a sideways drag does not refresh', readsAfter(side.t));
  await p.evaluate(s => { const x = document.querySelector(s + ' .ch-row[data-chopen]'); x && (x.style.transform = ''); }, W);
  await waitIdle(); await sleep(400);
  await p.evaluate(s => { document.querySelector(s + ' .ch-scroll').scrollTop = 400; }, W);
  const sc = await p.evaluate(s => document.querySelector(s + ' .ch-scroll').scrollTop, W);
  const mid = await drag(0, 240); await sleep(600);
  ok(sc > 0 && readsAfter(mid.t) === 0, 'a downward drag in a scrolled list scrolls instead of refreshing', { sc, reads: readsAfter(mid.t) });
  await p.evaluate(s => { document.querySelector(s + ' .ch-scroll').scrollTop = 0; }, W);

  // 3. Rows still open after a pull.
  await waitIdle(); await sleep(400);
  await p.tap(`${W} .ch-row[data-chopen]`);
  const opened = await p.waitForFunction(id => !!__wos.wins[id]?.thread, wid, { timeout: 8000 }).then(() => true, () => false);
  ok(opened, 'tapping a row after a pull still opens the thread');
  await p.evaluate(id => window.WizCore.chats?.openChat?.(id, null) ?? null, wid).catch(() => {});
  await p.waitForFunction(s => !!document.querySelector(s + ' .ch-list'), W, { timeout: 8000 }).catch(() => {});
  if (!(await p.$(`${W} .ch-list`))) { await p.keyboard.press('Escape'); await p.waitForSelector(`${W} .ch-list`, { timeout: 8000 }).catch(() => {}); }

  // 4. A failed read: "Not up to date · last updated …" with the Troubleshooter, also after a pull.
  mode = 'fail'; await waitIdle();
  const fp = await drag(0, 240); await sleep(300); await waitIdle(); await sleep(700);
  const failed = await p.evaluate(s => ({ sync: document.querySelector(s + ' .ch-sync')?.innerText || '', ts: !!document.querySelector(s + ' .ch-sync [data-chtroubleshoot]'), rows: document.querySelectorAll(s + ' .ch-row[data-chopen]').length }), W);
  ok(readsAfter(fp.t) >= 1 && /Not up to date/.test(failed.sync) && /last updated/.test(failed.sync) && failed.ts, 'a failed read says "Not up to date · last updated …" with the Troubleshooter', failed);
  for (const skin of ['nebula', 'tide']) { await p.evaluate(k => window.WosSkin?.set?.(k), skin); await sleep(500); await p.screenshot({ path: path.join(OUT, `ptr-offline-${skin}.png`), clip: { x: 0, y: 0, width: 412, height: 360 } }); }
  await p.evaluate(() => window.WosSkin?.set?.('nebula'));
  mode = 'ok'; await p.evaluate(() => WizLive.refresh()); await waitIdle(); await sleep(500);
  ok(!(await state()).sync, 'a good read clears the warning', (await state()).sync);

  // 5. An old list (no read for 5 minutes) says so.
  await p.evaluate(() => { WizLive.at = Date.now() - 5 * 60000; WizLive.emit(); }); await sleep(300);
  const stale = await state();
  ok(/Not up to date/.test(stale.sync) && /5 min ago/.test(stale.sync), 'a list older than a minute says "Not up to date · last updated 5 min ago"', stale.sync);
  await p.screenshot({ path: path.join(OUT, 'ptr-stale.png'), clip: { x: 0, y: 0, width: 412, height: 360 } });
  await p.evaluate(() => WizLive.refresh()); await waitIdle(); await sleep(400);

  // 6. A hung read gives up and says so.
  if (!process.env.QA_SKIP_HANG) {
    mode = 'hang'; await waitIdle();
    const t0 = Date.now(); p.evaluate(() => WizLive.refresh()).catch(() => {});
    const gaveUp = await p.waitForFunction(() => WizLive.error === 'offline', null, { timeout: 45000 }).then(() => Date.now() - t0, () => -1);
    await sleep(400);
    const hung = await state();
    ok(gaveUp > 0 && gaveUp < 36000 && /Not up to date/.test(hung.sync), 'a hung read gives up within ~30 s and says "Not up to date"', { gaveUp, sync: hung.sync });
    mode = 'ok';
  }
  console.log('writes refused (informational):', writes);
  ok(errs.length === 0, 'no page errors', errs);
  console.log(`${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
