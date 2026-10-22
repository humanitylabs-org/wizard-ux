// Chats opens on the last list snapshot (James, 18 Oct 2026: "show something that shows updating like a progress
// icon just so the user knows this is the last snapshot and it's fetching the latest"). Self-contained fake Wizard:
// 300 threads, slow list pages (PAGE_MS), a private agent. Asserts: a first visit writes a snapshot (main agent's
// threads only, bounded size); a reload shows rows from the snapshot before any list page lands, with an
// "Updating…" line and spinner; the line clears when the fresh read lands and fresh titles replace stored ones;
// offline, the stored rows stay with "Can't reach Wizard"; the connection banner never treats the snapshot as live;
// no writes; no page errors. Usage: QA_TREE=<repo> node qa-chats-snapshot.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname, OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('');
const PAGE_MS = +process.env.PAGE_MS || 1500;
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' ' + JSON.stringify(d) : ''}`); };
const N = 300, now = Date.now() / 1000;
const S = Array.from({ length: N }, (_, i) => ({ id: `s${i}`, title: `Thread ${i}`, source: 'wizard-mobile', message_count: 4, last_active: now - 600 - i * 1800, started_at: now - 600 - i * 1800, archived: false, hidden: false, status: null, preview: `preview ${i} ` + 'x'.repeat(2000) }));
const P = [{ id: 'p0', title: 'Private thread', source: 'wizard-mobile', message_count: 2, last_active: now - 60, started_at: now - 60, archived: false, hidden: false, status: null, preview: 'private', agent: 'private' }];
const AGENTS = { agents: [
  { id: 'hermes', is_default: true, label: 'Hermes', harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: 'spark', hue: 265 } },
  { id: 'private', label: 'Private', harness: 'hermes', privacy: 'private', status: 'running', appearance: { glyph: 'lock', hue: 200 } }] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let offline = false, pagesServed = 0, writes = 0;

(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: 'dark' });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== 'wizard.test') return r.abort();
    if (!['GET', 'HEAD'].includes(q.method())) { writes++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (u.pathname === '/wizard/hermes/api/sessions') {
      if (offline) return r.abort('internetdisconnected');
      const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 100, agent = u.searchParams.get('agent') || '';
      if (agent === 'private') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: P, limit: lim, offset: 0, has_more: false, snapshot: 'p' }) });
      await sleep(PAGE_MS); pagesServed++;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: S.slice(off, off + lim), limit: lim, offset: off, has_more: off + lim < N, snapshot: 'snap' }) });
    }
    if (u.pathname === '/wizard/v1/agents') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AGENTS) });
    if (u.pathname === '/wizard/thread-seen') return offline ? r.abort('internetdisconnected') : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: 1, threads: {} } }) });
    if (u.pathname.startsWith('/wizard/')) return offline ? r.abort('internetdisconnected') : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
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
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const openChats = async () => {
    await p.waitForFunction(() => window.__wos && window.WizCore?.apps, null, { timeout: 15000 });
    await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')));
    return p.waitForFunction(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.id || '', null, { timeout: 10000 }).then(h => h.jsonValue());
  };
  // ---- 1. First visit: no snapshot yet; the full read writes one.
  await p.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
  ok(await p.evaluate(() => !WizLive.cached && !localStorage.getItem('wos.chats.snapshot.v1:wizard-account-local')), 'first visit: nothing stored yet, nothing shown as cached');
  await openChats();
  await p.waitForFunction(() => !!WizLive.fullAt, null, { timeout: 30000 });
  await p.waitForFunction(() => (WizLive.agentSessions.private || []).length > 0, null, { timeout: 10000 }).catch(() => {});
  const snap = await p.evaluate(() => { const raw = localStorage.getItem('wos.chats.snapshot.v1:wizard-account-local'); const v = raw && JSON.parse(raw); return v && { n: v.sessions.length, bytes: raw.length, ids: v.sessions.map(s => s.id), maxPreview: Math.max(...v.sessions.map(s => String(s.preview || '').length)) }; });
  ok(snap && snap.n === 150, 'first visit: snapshot written, newest 150 threads', snap && snap.n);
  ok(snap && snap.ids[0] === 's0' && !snap.ids.includes('p0'), "snapshot holds the main agent's threads only (no private rows)", snap && snap.ids.slice(0, 3));
  ok(snap && snap.maxPreview <= 600 && snap.bytes < 400000, 'snapshot bounded (text clipped, size)', snap && { maxPreview: snap.maxPreview, kb: Math.round(snap.bytes / 1024) });
  // ---- 2. Reload: rows from the snapshot before any page lands, with Updating… + spinner.
  S[0].title = 'Thread 0 renamed live';
  pagesServed = 0;
  await p.reload({ waitUntil: 'load' });
  const wid = await openChats();
  const sel = `[data-chats="${wid}"]`;
  await p.waitForSelector(`${sel} .ch-row[data-chopen]`, { timeout: 5000 });
  const early = await p.evaluate(s => ({ rows: document.querySelectorAll(`${s} .ch-row[data-chopen]`).length, sync: document.querySelector(`${s} .ch-sync`)?.innerText || '', spin: !!document.querySelector(`${s} .ch-sync .ch-spin`), connecting: /Connecting to/.test(document.querySelector(s)?.innerText || ''), first: document.querySelector(`${s} .ch-row[data-chopen]`)?.innerText || '' }), sel);
  const servedEarly = pagesServed;
  ok(early.rows > 0 && servedEarly === 0, 'reload: rows show from the snapshot before any list page lands', { rows: early.rows, pagesServed: servedEarly });
  ok(/Updating/.test(early.sync) && early.spin, 'reload: "Updating…" line with a spinner', early.sync);
  ok(!early.connecting, 'reload: no "Connecting to Wizard…" box');
  ok(/Thread 0\b/.test(early.first) && !/renamed/.test(early.first), 'reload: the stored title shows first', early.first.slice(0, 40));
  ok(await p.evaluate(() => WizLive.at === 0), 'connection banner does not count the snapshot as a live read');
  await shotOf(p, 'chats-snapshot-updating');
  await p.waitForFunction(s => !document.querySelector(`${s} .ch-sync`) && !WizLive.cached, sel, { timeout: 15000 }).catch(() => {});
  const fresh = await p.evaluate(s => ({ sync: !!document.querySelector(`${s} .ch-sync`), txt: document.querySelector(s)?.innerText || '' }), sel);
  ok(!fresh.sync, 'fresh read lands: the Updating line clears');
  ok(/renamed live/.test(fresh.txt), 'fresh read lands: live titles replace stored ones');
  await p.waitForFunction(() => !!WizLive.fullAt, null, { timeout: 30000 });
  ok(await p.evaluate(n => WizLive.sessions.filter(s => /^s\d+$/.test(s.id)).length === n, N), 'full walk still lists every thread');
  // ---- 3. Offline reload: stored rows stay, with Can't reach Wizard.
  await p.evaluate(() => { const k = 'wos.chats.snapshot.v1:wizard-account-local'; const v = JSON.parse(localStorage.getItem(k)); return !!v; });
  offline = true;
  await p.reload({ waitUntil: 'load' });
  const wid2 = await openChats(); const sel2 = `[data-chats="${wid2}"]`;
  await p.waitForFunction(() => WizLive.error, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(400);
  const off = await p.evaluate(s => ({ rows: document.querySelectorAll(`${s} .ch-row[data-chopen]`).length, sync: document.querySelector(`${s} .ch-sync`)?.innerText || '', spin: !!document.querySelector(`${s} .ch-sync .ch-spin`) }), sel2);
  ok(off.rows > 0 && /Can.t reach Wizard/.test(off.sync) && !off.spin, "offline: stored rows stay with \"Can't reach Wizard\", no spinner", off);
  await shotOf(p, 'chats-snapshot-offline');
  offline = false;
  ok(writes === 0, 'no writes', writes);
  ok(errs.length === 0, 'no page errors', errs);
  console.log(`${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
async function shotOf(p, name) { const f = path.join(OUT, name + '.png'); await p.screenshot({ path: f }); console.log('SHOT', f); }
