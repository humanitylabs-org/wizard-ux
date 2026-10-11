// QA: Home cards (James, 11 Oct 2026). Yesterday opens beside Home like any app (even when an old review desk
// sits far down the strip); Unread and Working open the Chats window filtered to just those threads; Back clears
// the filter and lands back on Home; the example-phrase chips are gone from Home and empty desks.
// Usage: node qa-home-cards.cjs [origin=http://127.0.0.1:9431/wizard-os-home/]   (every write is intercepted)
let pw; try { pw = require('/home/telos/node_modules/playwright'); } catch (e) { pw = require('playwright-core'); }
const URL_ = process.argv[2] || 'http://127.0.0.1:9431/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch/home-cards';
require('fs').mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url());
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && u.origin === ORIGIN) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {} });
  await p.goto(URL_); await p.waitForFunction(() => window.__wos && window.__wos.desks, null, { timeout: 20000 });
  await p.waitForFunction(() => window.WizLive && window.WizLive.ok, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const S = () => p.evaluate(() => ({ idx: __wos.idx, names: __wos.desks.map(d => d.home ? 'Home' : d.wins.map(id => __wos.wins[id].app).join('+')) }));
  const home = async () => { await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(700); };
  const tapCard = async act => { await p.locator(`.home-desk [data-act="${act}"]`).tap(); await p.waitForTimeout(900); };
  const pressBack = async () => { await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(700); };

  await home();
  ok(await p.locator('.home-desk .say, .home-desk .hint-row').count() === 0, 'Home: no example-phrase chips');
  ok(await p.locator('.empty-desk .say').count() === 0, 'empty desks: no example-phrase chips');
  await p.screenshot({ path: `${SHOTS}/01-home.png` });

  // Park a review desk far down the strip, as the bug had it (third desk and beyond).
  await p.evaluate(() => { __wos.goDesk(1, true); __wos.openWin({ app: 'frame', appId: 'link', url: '/wizard-os-home/', title: 'Filler' }); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { __wos.goDesk(__wos.desks.length - 1, true); __wos.openWin({ app: 'review', z: { level: 'day', day: '2026-10-10' } }); });
  await p.waitForTimeout(800);
  let s = await S(); const farAt = s.names.indexOf('review');
  ok(farAt >= 3, 'setup: an old review desk sits far down the strip', JSON.stringify(s));
  const reviews0 = s.names.filter(n => n === 'review').length;
  await home(); await tapCard('yesterday');
  s = await S();
  const chatsAt = s.names.findIndex(n => /chats/.test(n));
  ok(s.names[s.idx] === 'review' && s.idx === (chatsAt === 1 ? 2 : 1), 'Yesterday: opens on the desk beside Home/Chats, like any app', JSON.stringify(s));
  ok(s.names.filter(n => n === 'review').length === reviews0, 'Yesterday: existing review desk moved, not duplicated', JSON.stringify(s));
  await p.screenshot({ path: `${SHOTS}/02-yesterday.png` });

  // Fresh strip: no review desk yet → still beside.
  await p.evaluate(() => { for (const id of Object.keys(__wos.wins)) if (__wos.wins[id].app === 'review') __wos.closeWin(id); });
  await home(); await tapCard('yesterday'); s = await S();
  ok(s.names[s.idx] === 'review' && s.idx <= 2, 'Yesterday (no review open): new desk beside', JSON.stringify(s));

  // Unread card → Chats filtered.
  await home();
  const homeN = await p.evaluate(() => Number(document.querySelector('.home-desk [data-act="unread"] .n')?.textContent || -1));
  await tapCard('unread'); s = await S();
  const f = await p.evaluate(() => { const d = __wos.desks[__wos.idx], w = __wos.wins[d.focus]; const el = document.querySelector(`[data-chats="${w.id}"]`); return { app: w.app, filter: el?.querySelector('.ch-filter')?.dataset.filter, rows: el ? el.querySelectorAll('.ch-flist .ch-row').length : -1, empty: !!el?.querySelector('.ch-filter ~ .ch-empty'), secs: el ? el.querySelectorAll('.ch-sec[data-sec]').length : -1 }; });
  ok(f.app === 'chats' && f.filter === 'unread', 'Unread: opens Chats with the Unread filter on', JSON.stringify(f));
  ok(f.rows === homeN || (homeN === 0 && f.empty), 'Unread: list count matches the Home card', `home ${homeN} list ${f.rows}`);
  ok(f.secs === 0, 'Unread: only the filtered list (no sections)', JSON.stringify(f));
  await p.screenshot({ path: `${SHOTS}/03-unread.png` });
  await pressBack(); s = await S();
  const cleared = await p.evaluate(() => !document.querySelector('.ch-filter'));
  ok(s.idx === 0 && cleared, 'Unread: Back clears the filter and returns to Home', JSON.stringify(s));
  ok(await p.evaluate(() => !!document.querySelector('.device') && document.visibilityState === 'visible'), 'Back: app still open');

  // Working card → Chats filtered to Working; "All chats" clears.
  const workN = await p.evaluate(() => Number(document.querySelector('.home-desk [data-act="working"] .n')?.textContent || -1));
  await tapCard('working');
  const g = await p.evaluate(() => { const w = __wos.wins[__wos.desks[__wos.idx].focus]; const el = document.querySelector(`[data-chats="${w.id}"]`); return { app: w.app, filter: el?.querySelector('.ch-filter')?.dataset.filter, rows: el ? el.querySelectorAll('.ch-flist .ch-row').length : -1 }; });
  ok(g.app === 'chats' && g.filter === 'working', 'Working: opens Chats with the Working filter on', JSON.stringify(g));
  ok(g.rows === workN || (workN === 0 && g.rows === 0), 'Working: list count matches the Home card', `home ${workN} list ${g.rows}`);
  await p.screenshot({ path: `${SHOTS}/04-working.png` });
  await p.locator('[data-chfilterx]').tap(); await p.waitForTimeout(500);
  ok(await p.evaluate(() => !document.querySelector('.ch-filter') && document.querySelectorAll('.ch-sec[data-sec]').length > 0), 'Working: "All chats" shows the full list again');

  // Leaving the desk clears a filter (it never lingers on Chats).
  await home(); await tapCard('unread'); await home();
  ok(await p.evaluate(() => !document.querySelector('.ch-filter')), 'filter does not linger after swiping away');

  ok(!errs.length, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
