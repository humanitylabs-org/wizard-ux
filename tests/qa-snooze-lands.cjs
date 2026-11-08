'use strict';
// Snooze lands where Archive lands (James, 8 Nov 2026), on the tap's own frame, with the backend held.
// Synthetic origin only: every owner endpoint is a fixture and every write is held/failed by this harness.
// Usage: QA_PLAYWRIGHT=<module> [QA_TREE=<repo or baseline checkout>] [QA_OUT=dir] [QA_ONLY=phone|desktop] node tests/qa-archive-instant.cjs
// Negative control: point QA_TREE at a checkout of the pre-fix revision; the same run must FAIL there.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.QA_PLAYWRIGHT || '../tools/qa-playwright.cjs');
const TREE = path.resolve(process.env.QA_TREE || path.join(__dirname, '..'));
const OUT = process.env.QA_OUT || path.join(process.env.TMPDIR || '/tmp', 'snooze-lands');
const HOLD_MS = 4000; // the backend answers this late; the UI must not wait for it
const origin = 'https://snooze-lands.test', prefix = '/wizard-os-home/';
fs.mkdirSync(OUT, { recursive: true });
const mime = f => f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : 'text/html';
const now = Date.now() / 1000;
const TARGET = 'qa-archive-me';
const mkRow = (id, title, age) => ({ id, title, source: 'wizard-mobile', status: 'completed', archived: false, hidden: false, message_count: 2, started_at: now - age - 60, last_active: now - age, wizard_last_user_at: now - age - 30, wizard_last_assistant_at: now - age, preview: 'Synthetic reply for ' + title });
const results = [], failures = [];
const check = (ok, name, detail) => { results.push({ ok: !!ok, name, detail }); console.log(ok ? 'PASS' : 'FAIL', name, ok || detail === undefined ? '' : JSON.stringify(detail)); if (!ok) failures.push(name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(browser, { desktop, skin, fail = false }) {
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' } : { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  // Server state: the list the next poll returns. A PATCH is held, then applied (or refused) HOLD_MS later.
  const server = { rows: [mkRow(TARGET, 'Archive me', 30), mkRow('qa-keep-1', 'Keep one', 120), mkRow('qa-keep-2', 'Keep two', 240)], patches: [], release: null, hold: true, fail, writes: [], errors: [] };
  const pending = [];
  server.releaseAll = () => { for (const f of pending.splice(0)) f(); };
  await ctx.routeWebSocket('**/*', w => w.close());
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.origin !== origin) return r.abort();
    if (u.pathname.includes('/v1/runs')) return r.abort();
    if (u.pathname.startsWith(prefix)) {
      const rel = decodeURIComponent(u.pathname.slice(prefix.length) || (desktop ? 'desktop.html' : 'index.html')), abs = path.resolve(TREE, 'web', rel);
      if (!abs.startsWith(path.join(TREE, 'web') + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return r.fulfill({ status: 404, body: 'missing' });
      return r.fulfill({ body: fs.readFileSync(abs), contentType: mime(rel) });
    }
    const sessionPath = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (m === 'PATCH' && sessionPath) {
      const id = decodeURIComponent(sessionPath[1]), body = JSON.parse(q.postData() || '{}');
      server.writes.push({ at: Date.now(), method: m, path: u.pathname, body });
      if (server.hold) await new Promise(res => { pending.push(res); setTimeout(res, HOLD_MS); });
      if (server.fail) return r.fulfill({ status: 500, json: { error: { message: 'fixture refusal' } } });
      const row = server.rows.find(x => x.id === id); if (row && 'archived' in body) row.archived = !!body.archived;
      return r.fulfill({ json: { ok: true } });
    }
    if (m === 'PUT' && u.pathname === '/wizard/thread-dispositions') {
      const body = JSON.parse(q.postData() || '{}'); server.writes.push({ at: Date.now(), method: m, path: u.pathname, body });
      if (server.hold) await new Promise(res => { pending.push(res); setTimeout(res, HOLD_MS); });
      if (server.fail) return r.fulfill({ status: 500, json: { error: { message: 'fixture refusal' } } });
      return r.fulfill({ json: { ok: true, record: { sessionId: body.sessionId, deferred: body.deferred, updatedAt: new Date().toISOString() } } });
    }
    if (u.pathname === '/wizard/v1/schedules' && m === 'POST') {
      const b = JSON.parse(q.postData() || '{}'); server.writes.push({ at: Date.now(), method: m, path: u.pathname, body: b });
      if (server.hold) await new Promise(res => { pending.push(res); setTimeout(res, HOLD_MS); });
      return r.fulfill({ status: 201, json: { id: 'job1', enabled: true, agent: 'hermes', ...b, nextRun: b.when.once, lastRun: null } });
    }
    if (u.pathname === '/wizard/v1/schedules' && m === 'GET') return r.fulfill({ json: { schedules: [] } });
    if (m !== 'GET' && m !== 'HEAD') { server.writes.push({ at: Date.now(), method: m, path: u.pathname, body: q.postData() }); return r.fulfill({ json: { ok: true, state: { initializedAt: 1, threads: {} } } }); }
    if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { object: 'list', data: JSON.parse(JSON.stringify(server.rows)), has_more: false, limit: 100, offset: 0, snapshot: 'qa-' + server.rows.map(x => x.id + x.archived).join() } });
    const msgs = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (msgs) return r.fulfill({ json: { object: 'list', has_more: false, data: [{ id: 1, session_id: msgs[1], role: 'user', content: 'Synthetic question', timestamp: now - 90 }, { id: 2, session_id: msgs[1], role: 'assistant', content: 'Synthetic answer', timestamp: now - 60 }] } });
    if (sessionPath) return r.fulfill({ json: { session: server.rows.find(x => x.id === decodeURIComponent(sessionPath[1])) || {} } });
    if (u.pathname === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
    if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { spaces: [], pinnedChats: [], migrations: { 'launcher.v1': true, 'launcher-seed-v1': true } } });
    if (u.pathname === '/wizard/v1/boomerangs') return r.fulfill({ json: { reminders: [] } });
    if (u.pathname === '/wizard/hermes/api/model/options') return r.fulfill({ json: { provider: 'fixture', providers: [{ slug: 'fixture', authenticated: true, models: [] }] } });
    if (u.pathname === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false, seen: true } });
    return r.fulfill({ json: {} });
  });
  await ctx.addInitScript(({ desktop, skin }) => {
    if (window !== top) return;
    for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': skin, 'wos.shell': desktop ? 'desktop' : 'phone' })) localStorage.setItem(k, v);
    if (desktop) localStorage.setItem('wos.desktop-view.v1', 'ai-apps');
  }, { desktop, skin });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', e => server.errors.push(e.message));
  await page.goto(origin + prefix + (desktop ? 'desktop.html' : ''), { waitUntil: 'load' });
  await page.waitForFunction(() => (window.__wux || window.__wos) && window.WizLive?.ok && window.WizLive.session?.('qa-archive-me'));
  await page.evaluate(installRows); await page.evaluate(() => document.getElementById('wosWelcome')?.remove());
  return { ctx, page, server };
}

// Visible rows of the target thread in any list (phone Chats row, desktop AI-apps row, Classic row), not the open reader.
// Installed once per page as window.__rows(sid); every other in-page step calls it, no code is built from strings.
const installRows = () => {
  window.__rows = sid => [...document.querySelectorAll('[data-chopen], .aad-rw[data-sid], .aad-row[data-sid]')].filter(n => (n.dataset.chopen === sid || n.dataset.sid === sid) && !n.closest('.ch-thread')).filter(n => { const r = n.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; for (let a = n; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; }).length;
};
const rowCount = (page, sid = TARGET) => page.evaluate(s => window.__rows(s), sid);

// Arms one-shot instrumentation: records, at the moment the PATCH/PUT is issued and again after the click task, whether the row is already gone.
async function arm(page) {
  await page.evaluate(sid => {
    window.__ai = { clickAt: 0, goneAtFetch: null, goneInTask: null, goneFrame: null };
    const rf = window.fetch; window.fetch = function (input, init) { const u = String(input?.url || input), m = String(init?.method || input?.method || 'GET').toUpperCase(); if (window.__ai.goneAtFetch === null && ((m === 'PATCH' && /\/sessions\//.test(u)) || (m === 'PUT' && /thread-dispositions/.test(u)))) window.__ai.goneAtFetch = window.__rows(sid) === 0; return rf.apply(this, arguments); };
    document.addEventListener('click', () => { window.__ai.clickAt = performance.now(); setTimeout(() => { window.__ai.goneInTask = window.__rows(sid) === 0; }, 0); requestAnimationFrame(() => setTimeout(() => { window.__ai.goneFrame = window.__rows(sid) === 0; }, 0)); }, true);
    window.__aiFrame = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(window.__rows(sid) === 0))));
  }, TARGET);
}
async function listVisible(page, desktop) {
  await page.evaluate(desktop => {
    const a = window.__wux || window.__wos;
    if (desktop) { document.getElementById('wosWelcome')?.remove(); return; }
    const w = Object.values(a.wins).find(w => w.app === 'chats') || null;
    if (w) { a.goDesk(a.desks.findIndex(d => d.wins.includes(w.id))); a.focusWin(w.id); if (w.thread) a.chats.threadBack?.(w); a.chats.renderChats(w); }
    else a.openApp(WizCore.apps('mobile').APPS.find(x => x.id === 'wizard'));
  }, desktop);
  await page.waitForFunction(() => document.querySelector('[data-chopen="qa-archive-me"], .aad-rw[data-sid="qa-archive-me"]'));
}
const where = page => page.evaluate(() => { const a = window.__wux || window.__wos; const w = Object.values(a.wins).find(w => w.app === 'chats'); return w ? (w.thread || null) : 'no-window'; });


// One run: open the target thread, tap Archive or Snooze (preset / Someday), read where the user lands before the held backend answers.
async function run(browser, { desktop, skin, action }) {
  const label = `${desktop ? 'desktop' : 'phone'}/${skin}/${action}`;
  const { ctx, page, server } = await open(browser, { desktop, skin });
  const out = { label };
  try {
    await sleep(600); await listVisible(page, desktop); await sleep(300);
    await page.evaluate(sid => { const a = window.__wux || window.__wos; a.openThread ? a.openThread(sid) : a.openWizardThread(sid); }, TARGET);
    await page.waitForSelector('[data-chact="done"]:visible'); await sleep(500);
    check(await where(page) === TARGET, `${label}: thread open before`);
    await page.screenshot({ path: path.join(OUT, `${label.replace(/\//g, '-')}-0before.png`) });
    const t0 = Date.now();
    if (action === 'archive') await page.locator('[data-chact="done"]:visible').first().click();
    else {
      await page.locator('[data-chact="snooze"]:visible').first().click();
      await page.waitForSelector('.boom-sheet');
      if (action === 'snooze-someday') { const b = page.locator('[data-boom-someday]').first(); if (!await b.count()) { out.skipped = true; console.log('SKIP', label, 'no Someday option in this build'); await ctx.close(); return out; } await b.click(); }
      else await page.locator('[data-boom-preset]').first().click();
    }
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    out.dest = await where(page); out.msAfterTap = Date.now() - t0;
    check(server.writes.length >= 0 && out.msAfterTap < HOLD_MS - 1000, `${label}: landed ${JSON.stringify(out.dest)} while the backend was still held (${out.msAfterTap} ms)`, out);
    await page.screenshot({ path: path.join(OUT, `${label.replace(/\//g, '-')}-1after-tap.png`) });
    server.releaseAll(); await sleep(1200);
    check(await where(page) === out.dest, `${label}: destination unchanged after the backend answers`, { now: await where(page), was: out.dest });
    await page.screenshot({ path: path.join(OUT, `${label.replace(/\//g, '-')}-2settled.png`) });
    check(server.errors.length === 0, `${label}: no page errors`, server.errors);
  } catch (e) { check(false, `${label}: harness`, String(e.stack || e).split('\n').slice(0, 4).join(' | ')); try { await page.screenshot({ path: path.join(OUT, `${label.replace(/\//g, '-')}-error.png`) }); } catch {} }
  finally { server.releaseAll(); await ctx.close(); }
  return out;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--no-sandbox'] });
  try {
    const skins = (process.env.QA_SKINS || 'nebula,sepia').split(',');
    for (const skin of skins) for (const desktop of [false, true]) {
      const arc = await run(browser, { desktop, skin, action: 'archive' });
      for (const action of ['snooze-preset', 'snooze-someday']) {
        const sn = await run(browser, { desktop, skin, action });
        if (!sn.skipped) check(sn.dest === arc.dest, `${desktop ? 'desktop' : 'phone'}/${skin}: ${action} lands where Archive lands`, { archive: arc.dest, snooze: sn.dest });
      }
      check(desktop ? arc.dest === 'qa-keep-1' : arc.dest === null, `${desktop ? 'desktop' : 'phone'}/${skin}: Archive lands ${desktop ? 'on the next chat' : 'on the chats list'}`, arc.dest);
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ tree: TREE, results }, null, 2));
  console.log(`${results.filter(r => r.ok).length} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
