// Chats first paint (James, 18 Oct 2026: "I have to stare at this Connecting to Wizard screen for many seconds").
// Boot used to walk every page of the thread list (~9 sequential pages, ~1.4 MB at 884 threads) and then wait on
// every other agent's list before Chats showed anything. Self-contained fake Wizard: 450 threads, each list page
// takes PAGE_MS, and a private agent whose list takes HANG_MS. Asserts: Chats rows show after page 1, well before
// the walk ends; the walk still completes (every thread listed); the private agent's threads merge in afterwards;
// first run anywhere (no read state) still waits for the whole list; no writes beyond the first-run read state.
// Usage: QA_TREE=<repo> node qa-chats-first-paint.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.QA_PLAYWRIGHT || '/home/telos/node_modules/playwright');
const TREE = process.env.QA_TREE || __dirname;
const PAGE_MS = +process.env.PAGE_MS || 700, HANG_MS = +process.env.HANG_MS || 6000;
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' ' + JSON.stringify(d) : ''}`); };
const N = 450, now = Date.now() / 1000;
const S = Array.from({ length: N }, (_, i) => ({ id: `s${i}`, title: `Thread ${i}`, source: 'wizard-mobile', message_count: 4, last_active: now - 600 - i * 1800, started_at: now - 600 - i * 1800, archived: false, hidden: false, status: null, preview: `preview ${i}` }));
const P = [{ id: 'p0', title: 'Private thread', source: 'wizard-mobile', message_count: 2, last_active: now - 60, started_at: now - 60, archived: false, hidden: false, status: null, preview: 'private', agent: 'private' }];
const AGENTS = { agents: [
  { id: 'hermes', is_default: true, label: 'Hermes', harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: 'spark', hue: 265 } },
  { id: 'private', label: 'Private', harness: 'hermes', privacy: 'private', status: 'running', appearance: { glyph: 'lock', hue: 200 } }] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(b, { seen }) {
  const log = []; let writes = 0;
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== 'wizard.test') return r.abort();
    if (!['GET', 'HEAD'].includes(q.method())) { writes++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (u.pathname === '/wizard/hermes/api/sessions') {
      const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 100, agent = u.searchParams.get('agent') || '';
      if (agent === 'private') { await sleep(HANG_MS); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: P, limit: lim, offset: 0, has_more: false, snapshot: 'p' }) }); }
      log.push({ t: Date.now(), off }); await sleep(PAGE_MS);
      const rows = S.slice(off, off + lim);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: rows, limit: lim, offset: off, has_more: off + lim < N, snapshot: 'snap' }) });
    }
    if (u.pathname === '/wizard/v1/agents') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AGENTS) });
    if (u.pathname === '/wizard/thread-seen') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: seen ? { initializedAt: 1, threads: {} } : null }) });
    if (u.pathname.startsWith('/wizard/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m) {
      const rel = m[1] || 'index.html'; let f = path.join(TREE, 'web', rel);
      if (!fs.existsSync(f)) f = path.join('/home/telos/apps/wizard-os-home/web', rel);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : rel.endsWith('.png') ? 'image/png' : rel.endsWith('.json') ? 'application/json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(f) });
    }
    return r.fulfill({ status: 404, body: '' });
  });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const t0 = Date.now();
  await p.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.WizCore?.apps, null, { timeout: 15000 });
  await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')));
  const wid = await p.waitForFunction(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.id || '', null, { timeout: 10000 }).then(h => h.jsonValue());
  const rowsSel = `[data-chats="${wid}"] .ch-list .ch-row[data-chopen]`;
  // While nothing is listed yet (#95): placeholder rows shaped like real ones, never the boxed "Connecting to Wizard…" text.
  const wait = await p.evaluate(s => ({ rows: document.querySelectorAll(s + ' .ch-row[data-chopen]').length, skel: document.querySelectorAll(s + ' .ch-skel .ch-skel-row').length, box: /Connecting to/.test(document.querySelector(s)?.innerText || '') }), `[data-chats="${wid}"]`);
  if (!seen) await p.screenshot({ path: path.join(process.env.QA_OUT || '/home/telos/.hermes/cache/scratch', 'chats-skeleton-firstrun.png') });
  await p.waitForSelector(rowsSel, { timeout: 30000 });
  const tRows = Date.now() - t0, pagesAtRows = log.length;
  await p.waitForFunction(() => !!WizLive.fullAt, null, { timeout: 30000 });
  const tWalk = Date.now() - t0;
  const listed = await p.evaluate(() => WizLive.sessions.filter(s => /^s\d+$/.test(s.id)).length);
  await p.waitForFunction(() => (WizLive.agentSessions.private || []).length > 0, null, { timeout: HANG_MS + 10000 }).catch(() => {});
  const priv = await p.evaluate(() => WizLive.sessionsFor('').some(s => s.id === 'p0'));
  const shot = path.join(process.env.QA_OUT || '/home/telos/.hermes/cache/scratch', `chats-first-paint-${seen ? 'seen' : 'firstrun'}.png`);
  await p.screenshot({ path: shot });
  await ctx.close();
  return { tRows, tWalk, pagesAtRows, listed, priv, writes, errs, shot, wait };
}

(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const a = await run(b, { seen: true });
  console.log('seen run', JSON.stringify(a));
  ok(a.pagesAtRows <= 2, 'Chats rows show after page 1 (pages requested when rows appeared)', a.pagesAtRows);
  ok(a.tRows < a.tWalk - 2 * PAGE_MS, 'rows show well before the full walk ends', { rowsMs: a.tRows, walkMs: a.tWalk });
  ok(a.tRows < HANG_MS, 'a slow other agent never holds the main list', { rowsMs: a.tRows, hangMs: HANG_MS });
  ok(a.listed === N, 'the walk still lists every thread', a.listed);
  ok(a.priv, "the private agent's thread merges in afterwards");
  ok(a.writes === 0, 'no writes', a.writes);
  ok(a.errs.length === 0, 'no page errors', a.errs);
  const f = await run(b, { seen: false });
  console.log('first-run', JSON.stringify(f));
  ok(f.listed === N && f.pagesAtRows >= 5, 'first run anywhere: waits for the whole list before painting', f.pagesAtRows);
  ok(f.wait.rows === 0 && f.wait.skel >= 3 && !f.wait.box, 'while listing: placeholder rows, no "Connecting to Wizard…" box', f.wait);
  ok(f.writes === 1, 'first run anywhere: one read-state write', f.writes);
  ok(f.errs.length === 0, 'first run: no page errors', f.errs);
  console.log(`${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
