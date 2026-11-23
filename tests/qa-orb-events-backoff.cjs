// wizard-ux issue 1762: the real phone shell (412 px) with two meeting markers the meeting server refuses (409, the
// stale meeting mt_8b6b0a6b4f4d on James's phone). Synthetic routes, never a live API. Counts the PUT
// /mizel-live/orb-events requests for 65 s, reloads, and counts again for 20 s.
// Main sent 2 rows x 12 a minute, nonstop, and started again on every reload; now each row is tried at 0, 5, 20 and 80 s
// (then parked), and a reload carries on from the wait already saved.
// QA_WEB=<main worktree>/web QA_EXPECT=broken shows main's loop. QA_OUT=<dir> saves a screenshot.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead, seedOwner } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(process.env.QA_WEB || path.join(__dirname, '..', 'web')), out = process.env.QA_OUT || '';
const broken = process.env.QA_EXPECT === 'broken';
const ORIGIN = 'http://orb-events-backoff.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const KEY = 'wos.orb-meeting-events.v1';
const row = id => ({ id, meetingId: 'mt_8b6b0a6b4f4d', captureId: 'cap-1', status: 'paused', clientRevision: 3, atMediaMs: 12000, pausedAt: Date.now() - 3600e3 });
(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ headless: true }), puts = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    await ctx.route('**/*', r => {
      const req = r.request(), u = new URL(req.url());
      if (u.origin !== ORIGIN) return r.abort();
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/mizel-live/orb-events') {
        if (req.method() === 'PUT') { puts.push({ at: Date.now(), id: JSON.parse(req.postData()).id }); return json({ error: 'Existing meeting could not be verified' }, 409); }
        return json({ events: [], discussions: '' });
      }
      if (req.method() !== 'GET') return json({});
      if (/\/v1\/setup$/.test(u.pathname)) return json({ first_run: false });
      if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, settings: {}, capabilities: {}, endpoints: {} });
      const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html', f = path.resolve(web, rel);
      if (f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      return json(ownerRead(u.pathname));
    });
    await ctx.addInitScript(seedOwner, { phone: true });
    await ctx.addInitScript(([key, rows]) => {
      if (window !== top) return; localStorage.setItem('wos.shell', 'phone');
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(Object.fromEntries(rows.map(r => [r.id, r]))));
    }, [KEY, [row('orb-a'), row('orb-b')]]);
    const p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.goto(`${ORIGIN}/wizard-os-home/index.html?phone`);
    await p.waitForFunction(() => document.documentElement.dataset.shell === 'phone' && window.__wos && window.WosOrbHandoff, null, { timeout: 20000 });
    const t0 = Date.now();
    await p.waitForTimeout(65000);
    const first = puts.filter(x => x.at >= t0 - 5000).length;
    const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
    if (out) await p.screenshot({ path: path.join(out, (broken ? 'before' : 'after') + '.png') });
    const mark = puts.length;
    await p.reload();
    await p.waitForFunction(() => window.WosOrbHandoff, null, { timeout: 20000 });
    await p.waitForTimeout(20000);
    const afterReload = puts.length - mark;
    console.log(JSON.stringify({ web, putsIn65s: first, perRow: { a: puts.filter(x => x.id === 'orb-a').length, b: puts.filter(x => x.id === 'orb-b').length }, putsIn20sAfterReload: afterReload, retry: Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, v.retry || null])), errors }));
    assert.equal(saved['orb-a'].acked, undefined, 'a refused marker is never marked sent');
    if (broken) {
      assert.ok(first >= 20, `main keeps sending every 5 s: ${first} PUTs in 65 s`);
      assert.ok(afterReload >= 6, `main starts again after a reload: ${afterReload}`);
    } else {
      assert.ok(first <= 6, `backed off: ${first} PUTs in 65 s for 2 rows`);
      assert.ok(afterReload <= 2, `a reload keeps the saved wait: ${afterReload}`);
      assert.equal(saved['orb-a'].retry?.status, 409);
    }
    assert.deepEqual(errors, []);
    console.log('PASS', broken ? '(baseline shows the loop)' : '');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
