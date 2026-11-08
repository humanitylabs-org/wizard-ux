'use strict';
// Archive / one-tap list actions register on the tap's own frame (James, 7 Nov 2026, repeated).
// Synthetic origin only: every owner endpoint is a fixture and every write is held/failed by this harness.
// Usage: QA_PLAYWRIGHT=<module> [QA_TREE=<repo or baseline checkout>] [QA_OUT=dir] [QA_ONLY=phone|desktop] node tests/qa-archive-instant.cjs
// Negative control: point QA_TREE at a checkout of the pre-fix revision; the same run must FAIL there.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.QA_PLAYWRIGHT || '../tools/qa-playwright.cjs');
const TREE = path.resolve(process.env.QA_TREE || path.join(__dirname, '..'));
const OUT = process.env.QA_OUT || path.join(process.env.TMPDIR || '/tmp', 'archive-instant');
const HOLD_MS = 4000; // the backend answers this late; the UI must not wait for it
const origin = 'https://archive-instant.test', prefix = '/wizard-os-home/';
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
async function listVisible(page, desktop) { // phone: chats list shown; desktop: always
  await page.evaluate(desktop => {
    const a = window.__wux || window.__wos;
    if (desktop) { document.getElementById('wosWelcome')?.remove(); return; }
    const w = Object.values(a.wins).find(w => w.app === 'chats') || null;
    if (w) { a.goDesk(a.desks.findIndex(d => d.wins.includes(w.id))); a.focusWin(w.id); if (w.thread) a.chats.threadBack?.(w); a.chats.renderChats(w); }
    else a.openApp(WizCore.apps('mobile').APPS.find(x => x.id === 'wizard'));
  }, desktop);
  if (!desktop) await page.waitForFunction(() => document.querySelector('[data-chopen="qa-archive-me"]'));
  else await page.waitForFunction(() => document.querySelector('.aad-rw[data-sid="qa-archive-me"], [data-chopen="qa-archive-me"]'));
}

async function scenario(browser, { desktop, skin, entry, fail }) {
  const label = `${desktop ? 'desktop' : 'phone'}/${skin}/${entry}${fail ? '/backend-fails' : ''}`;
  const { ctx, page, server } = await open(browser, { desktop, skin, fail });
  try {
    await sleep(600);
    await listVisible(page, desktop);
    await sleep(300);
    if (/thread/.test(entry)) { // open the thread so its own Archive / Snooze buttons are on screen
      await page.evaluate(sid => { const a = window.__wux || window.__wos; a.openThread ? a.openThread(sid) : a.openWizardThread(sid); }, TARGET);
      await page.waitForSelector('[data-chact="done"]:visible'); await sleep(500);
    }
    check(desktop && /thread/.test(entry) ? true : /thread/.test(entry) ? true : await rowCount(page) === 1, `${label}: row/thread on screen before`);
    await page.screenshot({ path: path.join(OUT, `${label.replace(/\//g, '-')}-0before.png`) });
    await arm(page);
    const t0 = Date.now();
    // --- the tap itself ---
    if (entry === 'row-menu') {
      if (desktop) { await page.locator(`.aad-rw[data-sid="${TARGET}"] .aad-row`).dispatchEvent('contextmenu'); await page.locator('[role="menuitem"]').filter({ hasText: /Archive/ }).first().click(); }
      else { await page.locator(`[data-chopen="${TARGET}"]`).first().dispatchEvent('contextmenu'); await page.locator('[data-rsact="done"]').first().click(); }
    } else if (entry === 'swipe') {
      const cdp = await ctx.newCDPSession(page), rect = await page.locator(`[data-chopen="${TARGET}"]`).first().boundingBox();
      const x = rect.x + rect.width * .72, y = rect.y + rect.height / 2, touch = (type, xx) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: xx, y, id: 1 }] });
      await touch('touchStart', x); for (let i = 1; i <= 10; i++) { await touch('touchMove', x - 280 * i / 10); await sleep(16); } await touch('touchEnd', x - 280); await sleep(350);
      await arm(page);
      await page.locator('.ch-swipe-acts [data-chswipe="done"]').first().click();
    } else if (entry === 'thread-button') {
      await page.locator('[data-chact="done"]:visible').first().click();
    }
    const click = Date.now() - t0;
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(() => setTimeout(r, 0), 0))));
    const inTask = await page.evaluate(() => window.__ai);
    const frame = await page.evaluate(() => window.__aiFrame());
    const shotAt = Date.now() - t0;
    await page.screenshot({ path: path.join(OUT, `${label.replace(/\//g, '-')}-1after-tap.png`) });
    const still = await page.evaluate(() => performance.now() - window.__ai.clickAt);
    check(server.writes.some(w => w.method === 'PATCH') , `${label}: backend request issued and still held`, { writes: server.writes.length });
    // Phone lists repaint inside the click task; the desktop sidebar paints in the first animation frame after it (same painted frame as the tap).
    check(desktop ? inTask.goneFrame === true : inTask.goneInTask === true, `${label}: row gone ${desktop ? 'by the first frame' : 'in the click task'} after the tap, before the held backend answers`, inTask);
    check(frame === true && still < HOLD_MS - 1000, `${label}: gone two frames after tap, backend still held (${still | 0} ms after click)`, { frame, still });
    // --- stale poll arrives while the write is unconfirmed: must not bring it back ---
    await page.evaluate(() => (window.WizLive || (window.__wux || window.__wos).live).refresh());
    await sleep(900);
    check(await rowCount(page) === 0, `${label}: stale poll snapshot does not re-insert the pending thread`, { rows: await rowCount(page) });
    await page.screenshot({ path: path.join(OUT, `${label.replace(/\//g, '-')}-2stale-poll.png`) });
    // --- confirmation / failure ---
    server.releaseAll(); await sleep(1500);
    if (fail) {
      check(await rowCount(page) === 1 || await page.evaluate(sid => { const s = WizLive.session(sid); return s && !s.archived; }, TARGET), `${label}: backend failure restores the thread`);
      check(await page.evaluate(() => /Couldn.t archive|restored/i.test(document.getElementById('toast')?.innerText || document.body.innerText)), `${label}: failure shows a clear error toast`);
    } else {
      await page.evaluate(() => (window.WizLive).refresh()); await sleep(900);
      check(await rowCount(page) === 0, `${label}: stays gone after confirmation + fresh poll`);
    }
    check(server.errors.length === 0, `${label}: no page errors`, server.errors);
  } catch (e) { check(false, `${label}: harness`, String(e.stack || e).split('\n').slice(0, 4).join(' | ')); try { await page.screenshot({ path: path.join(OUT, `${label.replace(/\//g, '-')}-error.png`) }); } catch {} }
  finally { server.releaseAll(); await ctx.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--no-sandbox'] });
  try {
    const only = process.env.QA_ONLY, skins = (process.env.QA_SKINS || 'nebula,sepia').split(',');
    const matrix = [];
    for (const skin of skins) {
      if (only !== 'desktop') for (const entry of ['row-menu', 'swipe', 'thread-button']) if (entry !== 'swipe' || ['sepia', 'novairecito'].includes(skin)) matrix.push({ desktop: false, skin, entry }); // the Done/Recall tray is the Novairecito/Sepia phone gesture
      if (only !== 'phone') for (const entry of ['row-menu', 'thread-button']) matrix.push({ desktop: true, skin, entry });
    }
    matrix.push({ desktop: false, skin: skins[0], entry: 'row-menu', fail: true }, { desktop: true, skin: skins[0], entry: 'row-menu', fail: true }, { desktop: false, skin: skins[0], entry: 'thread-button', fail: true });
    for (const m of matrix) await scenario(browser, m);
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ tree: TREE, results }, null, 2));
  console.log(`${results.filter(r => r.ok).length} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
