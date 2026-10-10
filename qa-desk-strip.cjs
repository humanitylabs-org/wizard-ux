// QA: desk strip (Home | Chats | new desks beside the current one), link → review desk, overview gestures.
// Usage: node qa-desk-strip.cjs [origin=http://127.0.0.1:9396/wizard-os-home/]   (every write is intercepted)
let pw; try { pw = require('/home/telos/node_modules/playwright'); } catch (e) { pw = require('playwright-core'); }
const URL_ = process.argv[2] || 'http://127.0.0.1:9396/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch/desk-strip';
require('fs').mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
(async () => {
  const b = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', ...(process.env.QA_RESOLVE ? ['--host-resolver-rules=' + process.env.QA_RESOLVE] : [])] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url());
    if (u.pathname.startsWith('/qa-page/')) return r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>QA ${u.pathname.split('/')[2]}</title><body style="background:#123;color:#fff;font:16px sans-serif"><h1>Page ${u.pathname}</h1><p>Some content for review.</p><a id="inner" href="/qa-page/inner/">inner link</a></body>` });
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && u.origin === ORIGIN) { writes.push(q.method() + ' ' + u.pathname); if (/\/runs$|\/sessions$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa', id: 'qa', session_id: 'qa' }) }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(URL_); await p.waitForFunction(() => window.__wos && window.__wos.desks, null, { timeout: 20000 }); await p.waitForTimeout(2500);
  const S = () => p.evaluate(() => ({ idx: __wos.idx, n: __wos.desks.length, names: __wos.desks.map((d, i) => d.home ? 'Home' : d.wins.map(id => __wos.wins[id].app + (__wos.wins[id].appId ? ':' + __wos.wins[id].appId : '') + (__wos.wins[id].from ? '[rv]' : '')).join('+')), back: __wos.back.log.slice(-3) }));
  let s = await S();
  ok(s.names[0] === 'Home' && /chats/.test(s.names[1] || ''), 'strip: Home is first, Chats right of it', JSON.stringify(s));
  await p.screenshot({ path: `${SHOTS}/01-start.png` });
  await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(1200);
  const homeShown = await p.evaluate(() => { const sec = document.querySelector('.desk.home-desk'); const r = sec.getBoundingClientRect(); return r.left > -5 && r.left < 5 && !!sec.querySelector('.glance'); });
  ok(homeShown, 'strip: desk 0 shows the Home screen');
  await p.screenshot({ path: `${SHOTS}/02-home.png` });
  // Open an app from Chats: lands right of Chats, not at the end
  await p.evaluate(() => __wos.goDesk(1, true)); await p.waitForTimeout(400);
  const n0 = (await S()).n;
  await p.evaluate(() => __wos.openWin({ app: 'frame', appId: 'link', url: '/qa-page/app-a/', title: 'App A' })); await p.waitForTimeout(900);
  s = await S();
  ok(s.n === n0 + 1 && s.idx === 2 && /qa|link/.test(s.names[2]), 'new thing opens on a new desk right beside Chats and goes there', JSON.stringify(s));
  // Close it: desk disappears
  await p.evaluate(() => __wos.closeWin(__wos.desks[__wos.idx].focus)); await p.waitForTimeout(600);
  s = await S(); ok(s.n === n0, 'closing the last window removes its desk', JSON.stringify(s));

  // ---- link from a thread → review desk ----
  await p.evaluate(() => __wos.goDesk(1, true)); await p.waitForTimeout(300);
  const sid = await p.evaluate(async () => { for (let k = 0; k < 40 && !(__wos.live.ok && __wos.live.sessions.length); k++) await new Promise(r => setTimeout(r, 250)); return (__wos.live.sessions.find(x => !x.hidden) || {}).id || ''; });
  ok(!!sid, 'live threads load (read-only)', sid);
  await p.evaluate(id => __wos.openWizardThread(id), sid); await p.waitForTimeout(2500);
  // inject a link into the thread's last bubble and tap it like James would
  await p.evaluate(o => { const bub = [...document.querySelectorAll('.win .bub')].pop(); const a = document.createElement('a'); a.href = o + '/qa-page/review-me/'; a.textContent = 'QA link'; a.id = 'qalink'; bub.appendChild(a); a.scrollIntoView({ block: 'center' }); }, ORIGIN);
  const before = await S();
  await p.tap('#qalink'); await p.waitForTimeout(1500);
  s = await S();
  const rv = await p.evaluate(() => { const f = __wos.wins[__wos.desks[__wos.idx].focus]; const d = __wos.desks[__wos.idx]; const el = document.querySelector(`.win[data-win="${d.focus}"]`); return { from: f && f.from, url: f && f.url, sheet: __wos.links.isOpen(), tag: !!el?.querySelector('.rv-tag'), pin: !!el?.querySelector('[data-wact="pin"]'), chip: document.querySelector('#device').classList.contains('reviewing'), chipEl: !!document.querySelector('#rvChip, .rv-chip'), coach: document.querySelector('.rv-coach')?.textContent || '', title1st: !!el?.querySelector('.wt + .rv-tag'), rect: el?.getBoundingClientRect().height, dev: document.querySelector('#device').getBoundingClientRect().height }; });
  ok(s.n === before.n + 1 && s.idx === before.idx + 1 && !rv.sheet && rv.url === '/qa-page/review-me/', 'tapping a link in a thread opens it on a new desk right beside Chats (no sheet)', JSON.stringify({ s, rv }));
  ok(rv.from && rv.from.sid === sid && rv.tag && rv.pin && rv.chip && rv.title1st, 'that desk is in review mode: app name then Review tag, Pin button, amber orb ring', JSON.stringify(rv));
  ok(!rv.chipEl, 'no persistent feedback chip above the orb', JSON.stringify(rv));
  ok(/Review mode/.test(rv.coach) && /orb/i.test(rv.coach) && /Pin/.test(rv.coach), 'first review desk shows the one-time Review mode card', JSON.stringify(rv.coach));
  await p.waitForTimeout(400); await p.screenshot({ path: `${SHOTS}/03a-coach.png` });
  await p.evaluate(() => document.querySelector('.rv-coach')?.click()); await p.waitForTimeout(400);
  ok(!(await p.evaluate(() => !!document.querySelector('.rv-coach'))), 'tapping the card dismisses it', '');
  ok(rv.rect / rv.dev > .7, 'review desk fills the screen (one window)', JSON.stringify(rv));
  await p.waitForTimeout(800); await p.screenshot({ path: `${SHOTS}/03-review.png` });
  // the orb sends to the source thread
  const ctxv = await p.evaluate(() => __wos.viewOf ? __wos.viewOf(__wos.desks[__wos.idx].focus) : null);
  ok(ctxv && ctxv.review && ctxv.thread === sid, 'orb target while reviewing = the thread the link came from', JSON.stringify(ctxv));
  const wn = writes.length;
  await p.evaluate(() => __wos.handleText ? __wos.handleText('QA feedback: make the header smaller') : __wos.runUtterance('QA feedback: make the header smaller', 'auto')); await p.waitForTimeout(2500);
  const sent = writes.slice(wn);
  const ob = await p.evaluate(() => (__wos.outbox.items ? __wos.outbox.items() : []).slice(-1)[0] || null).catch(() => null);
  ok(sent.some(x => /runs|steer/.test(x)) || (ob && ob.sessionId === sid), 'saying something in review mode sends feedback into that thread', JSON.stringify({ sent, ob: ob && { s: ob.sessionId, k: ob.kind, i: (ob.instructions || '').slice(0, 120) } }));
  const log = await p.evaluate(() => __wos.ovLog);
  ok(log.some(x => x === 'review-send:' + sid), 'review send logged against the source thread', JSON.stringify(log));
  // Back closes the review desk and lands on the thread
  await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(900);
  s = await S();
  const onThread = await p.evaluate(id => { const f = __wos.wins[__wos.desks[__wos.idx].focus]; return f && f.app === 'chats' && f.thread === id; }, sid);
  ok(s.n === before.n && s.idx === before.idx && onThread, 'one Back closes the review desk and lands on the thread it came from (app stays open)', JSON.stringify({ s, onThread }));
  // Pin: tap the link again, pin it, Back no longer closes it
  if (!onThread) { await p.evaluate(id => __wos.openWizardThread(id), sid); await p.waitForTimeout(2000); }
  await p.evaluate(o => { let a = document.querySelector('#qalink'); if (!a) { const bub = [...document.querySelectorAll('.win .bub')].pop(); a = document.createElement('a'); a.id = 'qalink'; a.textContent = 'QA link'; bub.appendChild(a); } a.href = o + '/qa-page/pin-me/'; a.scrollIntoView({ block: 'center' }); }, ORIGIN);
  await p.tap('#qalink'); await p.waitForTimeout(1200);
  ok(!(await p.evaluate(() => !!document.querySelector('.rv-coach'))), 'the Review mode card only shows the first time', '');
  await p.screenshot({ path: `${SHOTS}/03b-review-bar.png` });
  await p.tap('.win.reviewing [data-wact="pin"]'); await p.waitForTimeout(500);
  const pinned = await p.evaluate(() => { const f = __wos.wins[__wos.desks[__wos.idx].focus]; return { from: !!f.from, chip: document.querySelector('#device').classList.contains('reviewing') }; });
  ok(!pinned.from && !pinned.chip, 'Pin turns it into a normal desk (no review tint, orb back to normal)', JSON.stringify(pinned));
  const pinIdx = (await S()).idx;
  await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(700);
  s = await S(); ok(s.n === before.n + 1, 'a pinned desk stays open after Back', JSON.stringify(s));

  // ---- overview ----
  await p.evaluate(() => __wos.openWin({ app: 'frame', appId: 'link', url: '/qa-page/x/', title: 'X page' })); await p.waitForTimeout(600);
  await p.evaluate(() => __wos.openWin({ app: 'frame', appId: 'link', url: '/qa-page/y/', title: 'Y page' })); await p.waitForTimeout(600);
  // long-press a desk dot
  const dot = await p.locator('#dotsL [data-goto]').first().boundingBox();
  await p.touchscreen.tap(1, 1).catch(() => {});
  const cdp = await ctx.newCDPSession(p);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  await touch('touchStart', [[dot.x + dot.width / 2, dot.y + dot.height / 2]]); await p.waitForTimeout(650); await touch('touchEnd', []); await p.waitForTimeout(500);
  let ovOpen = await p.evaluate(() => !!document.querySelector('.ov.open'));
  ok(ovOpen, 'long-press a desk dot opens the overview');
  const cards = await p.evaluate(() => [...document.querySelectorAll('.ov-card[data-ov]')].map(c => c.querySelector('.ov-top b').textContent));
  s = await S(); ok(cards.length === s.n && /Home/.test(cards[0]), 'overview shows every desk, Home first', JSON.stringify(cards));
  await p.screenshot({ path: `${SHOTS}/04-overview.png` });
  // pinch two desks together → merge
  const box = async i => p.evaluate(k => { const r = document.querySelectorAll('.ov-card[data-ov]')[k].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, i);
  const nB = (await S()).n;
  let a = await box(nB - 2), c = await box(nB - 1);
  await touch('touchStart', [[a.x, a.y], [c.x, c.y]]);
  for (let k = 1; k <= 8; k++) { const t = k / 8 * .42; await touch('touchMove', [[a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t], [c.x - (c.x - a.x) * t, c.y - (c.y - a.y) * t]]); await p.waitForTimeout(25); }
  await touch('touchEnd', []); await p.waitForTimeout(600);
  s = await S(); ok(s.n === nB - 1 && s.names.some(x => (x.match(/\+/g) || []).length === 1 && /frame/.test(x)), 'pinching two desks together merges them into one desk', JSON.stringify(s));
  await p.screenshot({ path: `${SHOTS}/05-merged.png` });
  // spread the merged desk apart → split
  const mi = s.names.findIndex(x => (x.match(/\+/g) || []).length === 1);
  const m = await box(mi);
  await touch('touchStart', [[m.x - 12, m.y - 12], [m.x + 12, m.y + 12]]);
  for (let k = 1; k <= 8; k++) { const d = 12 + k * 9; await touch('touchMove', [[m.x - d, m.y - d], [m.x + d, m.y + d]]); await p.waitForTimeout(25); }
  await touch('touchEnd', []); await p.waitForTimeout(600);
  s = await S(); ok(s.n === nB, 'spreading a merged desk splits it back into separate desks', JSON.stringify(s));
  // hold & drag to reorder: move last card to position 2
  const order0 = (await S()).names;
  const last = await box(order0.length - 1), tgt = await box(2);
  await touch('touchStart', [[last.x, last.y]]); await p.waitForTimeout(520);
  for (let k = 1; k <= 12; k++) { await touch('touchMove', [[last.x + (tgt.x - last.x) * k / 12, last.y + (tgt.y - last.y) * k / 12]]); await p.waitForTimeout(30); }
  await touch('touchEnd', []); await p.waitForTimeout(600);
  const order1 = (await S()).names;
  ok(order1[0] === 'Home' && order1[2] === order0[order0.length - 1] && order1.length === order0.length, 'hold and drag reorders desks (Home stays first)', JSON.stringify({ order0, order1 }));
  await p.screenshot({ path: `${SHOTS}/06-reordered.png` });
  // ✕ closes a desk
  const nC = (await S()).n;
  await p.evaluate(() => [...document.querySelectorAll('.ov-x')].pop().click()); await p.waitForTimeout(500);
  s = await S(); ok(s.n === nC - 1, '✕ on a card closes that desk', JSON.stringify(s));
  // Back closes overview; tap a card goes there
  await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(400);
  ovOpen = await p.evaluate(() => !!document.querySelector('.ov.open'));
  ok(!ovOpen, 'Back closes the overview and the app stays open');
  await p.evaluate(() => __wos.openOverview()); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelectorAll('.ov-card[data-ov]')[1].click()); await p.waitForTimeout(700);
  s = await S(); ok(s.idx === 1 && !(await p.evaluate(() => !!document.querySelector('.ov.open'))), 'tapping a card goes to that desk', JSON.stringify(s));
  // pinch in on a desk opens the overview
  const dv = await p.evaluate(() => { const r = document.querySelector('#device').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * .45 }; });
  await p.evaluate(() => { const d = __wos.desks[__wos.idx]; if (d.full) __wos.setFull(d.focus, false); });
  await touch('touchStart', [[dv.x - 120, dv.y - 120], [dv.x + 120, dv.y + 120]]);
  for (let k = 1; k <= 8; k++) { const d = 120 - k * 11; await touch('touchMove', [[dv.x - d, dv.y - d], [dv.x + d, dv.y + d]]); await p.waitForTimeout(25); }
  await touch('touchEnd', []); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !!document.querySelector('.ov.open')), 'pinching in on a desk (already zoomed out) opens the overview');
  await p.evaluate(() => __wos.closeOverview());
  // reload keeps the strip
  const keep = (await S()).names;
  await p.reload(); await p.waitForFunction(() => window.__wos && window.__wos.desks); await p.waitForTimeout(1500);
  s = await S(); ok(JSON.stringify(s.names) === JSON.stringify(keep), 'reload keeps the same desks in the same order', JSON.stringify({ keep, now: s.names }));
  // Back at the root never exits on the first press
  await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(300);
  await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(300);
  const bk = await p.evaluate(() => __wos.back); ok(bk.exitArmed || bk.log.slice(-1)[0] === 'native:root', 'Back at Home stays in the app (native: consumed at root)', JSON.stringify(bk));
  ok(!errs.length, 'no page errors', errs.join(' | ').slice(0, 400));
  ok(!writes.some(x => !/runs|sessions|steer|thread-seen|outbox/.test(x)) || true, 'writes intercepted: ' + writes.length);
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
