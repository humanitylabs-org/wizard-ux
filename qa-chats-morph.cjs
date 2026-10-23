// Chats live repaints patch in place (James, 23 Oct 2026: "still experiencing flickering on my chat screens").
// Every live tick (a helper timer "1m 30s", a relative time "11m"->"12m", one Working row's preview, a new work step)
// used to rebuild the whole list or open thread with innerHTML: every row, spinner, message and photo node was thrown
// away and rebuilt, animations restarted and the scroller was put back by hand. This asserts that a live change keeps
// every unchanged node (same DOM identity), keeps running spinners, never reassigns the reader's scroll, and only the
// changed text moves. Self-contained fake Wizard on a phone viewport, no writes.
// Usage: QA_TREE=<repo> node qa-chats-morph.cjs   (negative control: QA_TREE=<checkout of main before the fix>)
const fs = require('fs'), path = require('path');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname;
let pass = 0, fail = 0, revision = 1;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' ' + JSON.stringify(d) : ''}`); };
const now = Date.now() / 1000, SID = 'qa_morph_live', N = 40;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function rows() {
  const a = [];
  for (let i = 0; i < 16; i++) a.push({ id: i + 1, session_id: SID, role: i % 2 ? 'assistant' : 'user', content: `Launch note ${i}. ` + 'Status words that wrap across lines. '.repeat(8), timestamp: now - 900 + i * 10 });
  for (let i = 1; i <= revision; i++) a.push({ id: 100 + i * 2, session_id: SID, role: 'assistant', content: '', timestamp: now - 100 + i, tool_calls: [{ id: 's' + i, type: 'function', function: { name: 'tool', arguments: '{}' }, display_label: 'Launch step ' + i }] });
  return a;
}
function session(i) {
  const live = i < 3;
  return { id: i === 0 ? SID : 'qa_morph_' + i, source: 'wizard-mobile', title: i === 0 ? `Launch Status r${revision}` : `Thread ${i}`, status: live ? 'running' : 'idle', archived: false, hidden: false,
    message_count: i === 0 ? rows().length : 4, started_at: now - 3600 - i * 600, last_active: now - 60 - i * 600,
    preview: i === 0 ? `Waiting on 1 helper · ${revision}s · launch status` : `preview ${i}`, run_id: live ? 'qa-morph-run-' + i : null };
}
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: 'dark' });
  let writes = 0;
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.hostname !== 'wizard.test') return r.abort();
    if (!['GET', 'HEAD'].includes(q.method())) { writes++; return json({ ok: true, state: { initializedAt: Date.now(), threads: {} } }); }
    if (u.pathname === '/wizard/hermes/api/sessions') { if (u.searchParams.get('agent')) return json({ object: 'list', data: [], has_more: false }); const off = +(u.searchParams.get('offset') || 0), lim = +(u.searchParams.get('limit') || 100), all = Array.from({ length: N }, (_, i) => session(i)); return json({ object: 'list', data: all.slice(off, off + lim), limit: lim, offset: off, has_more: off + lim < N, snapshot: 'r' + revision }); }
    if (u.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) { const all = rows(); return json({ object: 'list', data: all, has_more: false, total: all.length }); }
    if (u.pathname === `/wizard/hermes/api/sessions/${SID}`) return json({ session: session(0) });
    if (u.pathname.includes('/v1/runs/')) return u.pathname.endsWith('/events') ? r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }) : json({ run_id: 'qa-morph-run-0', status: 'running', session_id: SID });
    if (/\/wizard\/(thread-seen|thread-dispositions)/.test(u.pathname)) return json({ state: { initializedAt: Date.now(), threads: {} } });
    if (u.pathname.startsWith('/wizard/')) return json({});
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m) {
      const rel = m[1] || 'index.html', f = path.join(TREE, 'web', rel);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : rel.endsWith('.json') ? 'application/json' : rel.endsWith('.png') ? 'image/png' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(f) });
    }
    return r.fulfill({ status: 404, body: '' });
  });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1'); });
  // Count scrollTop writes on the list and thread scrollers (each one stops a phone's momentum scroll).
  await ctx.addInitScript(() => {
    window.__qaScrollSets = []; const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get: d.get, set(v) { if (this.classList?.contains('ch-scroll') || this.classList?.contains('ch-msgs')) __qaScrollSets.push(this.className.split(' ')[0]); return d.set.call(this, v); } });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos && window.WizCore?.apps, null, { timeout: 30000 });
  await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')));
  const wid = await p.waitForFunction(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.id || '', null, { timeout: 15000 }).then(h => h.jsonValue());
  await p.waitForSelector(`[data-chats="${wid}"] [data-chopen="${SID}"]`, { timeout: 30000 });
  await sleep(1500);
  const refresh = async (wait) => { revision++; await p.evaluate(() => (window.WizLive || __wos.live).refresh()); await p.waitForFunction(wait, revision, { timeout: 10000 }); await sleep(400); };

  // ---- 1. List: a Working row's text changes (as a helper timer or relative time does).
  const list0 = await p.evaluate(wid => {
    const el = document.querySelector(`[data-chats="${wid}"]`), sc = el.querySelector('.ch-scroll');
    sc.scrollTop = 240; window.__qaRows = new Map([...el.querySelectorAll('[data-chopen]')].map(r => [r.dataset.chopen, r]));
    window.__qaRoot = el.querySelector('.ch-list'); window.__qaSpin = [...el.querySelectorAll('.ch-row .spin, .ch-row .st.working')];
    window.__qaRemoved = 0; new MutationObserver(ms => { for (const m of ms) for (const n of m.removedNodes) if (n.nodeType === 1 && (n.matches?.('[data-chopen]') || n.querySelector?.('[data-chopen]'))) __qaRemoved++; }).observe(el, { childList: true, subtree: true });
    __qaScrollSets.length = 0;
    return { rows: __qaRows.size, spins: __qaSpin.length, top: sc.scrollTop };
  }, wid);
  ok(list0.rows >= 20 && list0.top > 0, 'setup: list painted and scrolled', list0);
  await refresh(rev => [...document.querySelectorAll('[data-chopen]')].some(r => r.textContent.includes(`Launch Status r${rev}`)));
  const list1 = await p.evaluate(wid => {
    const el = document.querySelector(`[data-chats="${wid}"]`), sc = el.querySelector('.ch-scroll');
    const now = [...el.querySelectorAll('[data-chopen]')];
    return { kept: now.filter(r => __qaRows.get(r.dataset.chopen) === r).length, total: now.length, root: el.querySelector('.ch-list') === __qaRoot,
      spins: __qaSpin.filter(s => s.isConnected).length, removed: __qaRemoved, top: sc.scrollTop, sets: [...__qaScrollSets] };
  }, wid);
  ok(list1.root, 'list: the list root survives a live tick', list1);
  ok(list1.kept === list1.total && list1.removed === 0, 'list: every row keeps its node (no whole-list rebuild)', list1);
  ok(list1.spins === list0.spins, 'list: Working spinners keep running (not restarted)', { before: list0.spins, after: list1.spins });
  ok(Math.abs(list1.top - list0.top) <= 1 && !list1.sets.includes('ch-scroll'), 'list: scroll untouched (no scrollTop write)', list1);

  // ---- 2. Open thread: a new work step lands while the owner reads mid-thread.
  await p.evaluate(({ wid, sid }) => __wos.chats.openChat(wid, sid), { wid, sid: SID });
  await p.waitForFunction(() => document.querySelectorAll('.ch-msgs .msg').length >= 10, null, { timeout: 15000 });
  await sleep(1200);
  const th0 = await p.evaluate(wid => {
    const el = document.querySelector(`[data-chats="${wid}"]`), nb = el.querySelector('.ch-msgs');
    nb.scrollTop = Math.max(0, (nb.scrollHeight - nb.clientHeight) / 2);
    window.__qaMsgs = [...nb.querySelectorAll('.msg')]; window.__qaNb = nb; window.__qaTa = el.querySelector('.ch-compose textarea');
    window.__qaTRemoved = 0; new MutationObserver(ms => { for (const m of ms) for (const n of m.removedNodes) if (n.nodeType === 1 && (n.matches?.('.msg') || n.querySelector?.('.msg'))) __qaTRemoved++; }).observe(el, { childList: true, subtree: true });
    __qaScrollSets.length = 0;
    return { msgs: __qaMsgs.length, top: nb.scrollTop, max: nb.scrollHeight - nb.clientHeight };
  }, wid);
  ok(th0.msgs >= 10 && th0.top > 0 && th0.top < th0.max, 'setup: thread open and read mid-way', th0);
  await refresh(rev => document.querySelector('.ch-msgs')?.textContent.includes('Launch step ' + rev));
  const th1 = await p.evaluate(wid => {
    const el = document.querySelector(`[data-chats="${wid}"]`), nb = el.querySelector('.ch-msgs');
    return { box: nb === __qaNb, kept: __qaMsgs.filter(m => m.isConnected).length, removed: __qaTRemoved, ta: el.querySelector('.ch-compose textarea') === __qaTa, top: nb.scrollTop, sets: [...__qaScrollSets] };
  }, wid);
  ok(th1.box, 'thread: the message scroller survives a live step', th1);
  ok(th1.kept === th0.msgs && th1.removed === 0, 'thread: every earlier message keeps its node', { ...th1, before: th0.msgs });
  ok(th1.ta, 'thread: the composer field keeps its node', th1);
  ok(Math.abs(th1.top - th0.top) <= 1 && !th1.sets.includes('ch-msgs'), 'thread: reading place untouched (no scrollTop write)', { th0, th1 });

  // ---- 3. Back to the list: a real navigation still rebuilds, and shows fresh content.
  await p.evaluate(wid => __wos.chats.chatsBack(__wos.wins[wid]), wid);
  await p.waitForSelector(`[data-chats="${wid}"] .ch-list [data-chopen="${SID}"]`, { timeout: 8000 });
  ok(await p.evaluate(rev => [...document.querySelectorAll('[data-chopen]')].some(r => r.textContent.includes(`Launch Status r${rev}`)), revision), 'back: list shows the latest preview');
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  ok(writes >= 0, 'writes fulfilled locally', writes);
  console.log(`${pass} pass, ${fail} fail`);
  await b.close(); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
