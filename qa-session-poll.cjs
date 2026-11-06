// Chats list polling budget (battery, 14 Oct 2026). Self-contained: a fake Wizard with 350 sessions
// ordered by last activity. Asserts: boot does one full walk; a 15 s poll reads page 1 only; a thread
// that changes (rises to page 1) updates; threads beyond page 1 stay listed; the 3-minute full walk
// still runs and catches an edit deep in history; no writes escape.
// Usage: QA_TREE=<repo> node qa-session-poll.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname;
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' ' + JSON.stringify(d) : ''}`); };
const N = 350, now = Date.now() / 1000;
const S = Array.from({ length: N }, (_, i) => ({ id: `s${i}`, title: `Thread ${i}`, source: 'wizard-mobile', message_count: 4, last_active: now - 600 - i * 3600, started_at: now - 600 - i * 3600, archived: false, hidden: false, status: null, preview: `preview ${i}` }));
const sorted = () => S.slice().sort((a, b) => b.last_active - a.last_active);
const log = [];
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  let writes = 0;
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== 'wizard.test') return r.abort();
    if (!['GET', 'HEAD'].includes(q.method())) { writes++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (u.pathname === '/wizard/hermes/api/sessions') {
      const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 100, rows = sorted().slice(off, off + lim);
      log.push({ t: Date.now(), off });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: rows, limit: lim, offset: off, has_more: off + lim < N, snapshot: 'snap' }) });
    }
    if (u.pathname === '/wizard/thread-seen') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: 1, threads: {} } }) });
    if (u.pathname.startsWith('/wizard/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m) {
      const rel = m[1] || 'index.html'; let f = path.join(TREE, 'web', rel);
      if (!fs.existsSync(f)) f = path.join(require('node:path').join(require('./tools/qa-paths.cjs').repoRoot, 'web'), rel);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : rel.endsWith('.png') ? 'image/png' : rel.endsWith('.json') ? 'application/json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(f) });
    }
    return r.fulfill({ status: 404, body: '' });
  });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
  await p.waitForFunction(() => window.WizLive && WizLive.ok && WizLive.sessions.length > 0, null, { timeout: 30000 });
  await p.waitForTimeout(500);
  const boot = log.length;
  ok(boot >= 4, 'boot: one full walk of every page', boot);
  ok(await p.evaluate(n => WizLive.sessions.filter(s => /^s\d+$/.test(s.id)).length === n, N), 'boot: every thread listed', await p.evaluate(() => WizLive.sessions.length));
  // A 15 s poll (not yet due for a full walk).
  log.length = 0; await p.evaluate(() => WizLive.refresh());
  ok(log.length === 1 && log[0].off === 0, 'poll: reads page 1 only', log.map(x => x.off));
  ok(await p.evaluate(n => WizLive.sessions.filter(s => /^s\d+$/.test(s.id)).length === n, N), 'poll: threads beyond page 1 stay listed');
  // A deep thread gets a reply: it rises to the top, and the next poll shows it.
  S[300].last_active = now; S[300].message_count = 6; S[300].preview = 'fresh reply';
  log.length = 0; await p.evaluate(() => WizLive.refresh());
  const got = await p.evaluate(() => { const s = WizLive.session('s300'); return s && { preview: s.preview, n: s.messageCount }; });
  ok(got && got.preview === 'fresh reply' && got.n === 6 && log.length === 1, 'poll: a deep thread that changes updates from page 1', { got, reqs: log.length });
  ok(await p.evaluate(() => WizLive.sessions.filter(s => s.id === 's300').length === 1), 'poll: no duplicate when a thread moves to page 1');
  // Edit deep in history that doesn't bump activity (archived elsewhere): the full walk catches it.
  S[340].archived = true;
  await p.evaluate(() => { WizLive.fullAt = Date.now() - 4 * 60 * 1000; });
  log.length = 0; await p.evaluate(() => WizLive.refresh());
  ok(log.length >= 4, 'after 3 min: full walk runs again', log.length);
  ok(await p.evaluate(() => WizLive.session('s340')?.archived === true), 'full walk: catches an edit beyond page 1');
  ok(writes === 0, 'no writes', writes);
  ok(errs.length === 0, 'no page errors', errs);
  console.log(`${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
