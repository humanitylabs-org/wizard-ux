'use strict';
// Chats Archive works like TG style (wizard-ux issue 2063, switch wizard/archive-hold, off by default).
// One click archives a settled and a working chat; both stay archived while the box's list still answers with the old
// state (~15 s), 60 s later and after the working run finishes (the Agent Service un-archives it with its reply). A
// chat comes back only when the owner sends in it (no tag) or the agent starts a new message there itself (a
// "Back: <agent> wrote" tag on the row until he opens it).
// Synthetic origin only: every owner endpoint is a fixture, nothing leaves this browser.
// Usage: QA_PLAYWRIGHT=<module> [QA_TREE=<checkout>] [QA_SWITCH=on|off] [QA_ONLY=phone|desktop] [QA_OUT=dir]
//        [QA_LAG=15000] [QA_HOLD_CHECK=62000] node tests/qa-archive-hold.cjs
// QA_SWITCH=off (or QA_TREE at origin/main) is the baseline: the same steps must show today's behaviour there.
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.QA_PLAYWRIGHT || '../tools/qa-playwright.cjs');
const TREE = path.resolve(process.env.QA_TREE || path.join(__dirname, '..'));
const OUT = process.env.QA_OUT || path.join(process.env.TMPDIR || '/tmp', 'archive-hold-2063');
const SWITCH = (process.env.QA_SWITCH || 'on') === 'on';
const LAG = Number(process.env.QA_LAG || 15000), HOLD_CHECK = Number(process.env.QA_HOLD_CHECK || 62000);
const origin = 'https://archive-hold-2063.test', prefix = '/wizard-os-home/';
fs.mkdirSync(OUT, { recursive: true });
const mime = f => /\.m?js$/.test(f) ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : 'text/html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [], failures = [];
const check = (ok, name, detail) => { results.push({ ok: !!ok, name, detail }); console.log(ok ? 'PASS' : 'FAIL', name, ok || detail === undefined ? '' : JSON.stringify(detail)); if (!ok) failures.push(name); };
const SETTLED = 'qa-hold-settled', WORKING = 'qa-hold-working', LONG = 'qa-hold-long', SENDS = 'qa-hold-owner';

function mkServer() {
  const t = () => Date.now() / 1000;
  const row = (id, title, age, extra = {}) => ({ id, title, source: 'wizard-mobile', status: 'completed', hidden: false, message_count: 2, started_at: t() - age - 60, last_active: t() - age,
    wizard_last_user_at: t() - age - 30, wizard_last_assistant_at: t() - age, preview: 'Synthetic reply for ' + title, preview_role: 'assistant', wizard_run_id: 'run-' + id, hist: [{ at: 0, v: false }], ...extra });
  const s = { errors: [], writes: [], rows: [
    row(SETTLED, 'Settled chat', 40), row(SENDS, 'Owner sends here', 90),
    row(WORKING, 'Working chat', 20, { status: 'running', wizard_run_id: 'run-w1', preview: 'Looking into it', preview_role: 'user', wizard_last_assistant_at: null }),
    row(LONG, 'Long run', 25, { status: 'running', wizard_run_id: 'run-l1', preview: 'Researching', preview_role: 'user', wizard_last_assistant_at: null }),
    row('qa-hold-keep', 'Keep me', 300)] };
  // The box's list lags: it answers with each chat's archived state as it was LAG ms ago (wizard-ux issue 2063).
  s.listed = r => { const now = Date.now(); let v = false; for (const h of r.hist) if (h.at <= now - LAG) v = h.v; const { hist, ...out } = r; return { ...out, archived: v }; };
  s.truth = r => r.hist[r.hist.length - 1].v;
  s.set = (id, v) => { const r = s.rows.find(x => x.id === id); r.hist.push({ at: Date.now(), v }); };
  s.get = id => s.rows.find(x => x.id === id);
  return s;
}

async function open(browser, desktop) {
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' } : { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const server = mkServer();
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
      server.writes.push({ at: Date.now(), path: u.pathname, body });
      if (server.get(id) && 'archived' in body) server.set(id, !!body.archived);
      return r.fulfill({ json: { ok: true } });
    }
    if (m !== 'GET' && m !== 'HEAD') { server.writes.push({ at: Date.now(), method: m, path: u.pathname }); return r.fulfill({ json: { ok: true, state: { initializedAt: 1, threads: {} } } }); }
    if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { object: 'list', data: server.rows.map(server.listed), has_more: false, limit: 100, offset: 0 } });
    const msgs = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    const now = Date.now() / 1000;
    if (msgs) return r.fulfill({ json: { object: 'list', has_more: false, data: [{ id: 1, session_id: msgs[1], role: 'user', content: 'Synthetic question', timestamp: now - 90 }, { id: 2, session_id: msgs[1], role: 'assistant', content: 'Synthetic answer', timestamp: now - 60 }] } });
    if (sessionPath) { const x = server.get(decodeURIComponent(sessionPath[1])); return r.fulfill({ json: { session: x ? { ...server.listed(x), archived: server.truth(x) } : {} } }); }
    if (u.pathname === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
    if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { spaces: [], pinnedChats: [], migrations: { 'launcher.v1': true, 'launcher-seed-v1': true } } });
    if (u.pathname === '/wizard/v1/boomerangs') return r.fulfill({ json: { reminders: [] } });
    if (u.pathname === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false, seen: true } });
    return r.fulfill({ json: {} });
  });
  const mix = SWITCH ? { 'wizard/archive-hold': true } : {};
  await ctx.addInitScript(({ desktop, mix }) => {
    if (window !== top) return;
    if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
    for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': 'nebula', 'wos.shell': desktop ? 'desktop' : 'phone',
      'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
    if (desktop) localStorage.setItem('wos.desktop-view.v1', 'ai-apps');
  }, { desktop, mix });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', e => server.errors.push(e.message));
  await page.goto(origin + prefix + (desktop ? 'desktop.html' : 'index.html?phone'), { waitUntil: 'load' });
  await page.waitForFunction(ids => window.WizLive?.ok && ids.every(id => window.WizLive.session?.(id)), [SETTLED, WORKING]);
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  await page.evaluate(() => {
    window.__rows = sid => [...document.querySelectorAll('[data-chopen], .aad-rw[data-sid]')].filter(n => (n.dataset.chopen === sid || n.dataset.sid === sid) && !n.closest('.ch-thread'))
      .filter(n => { const r = n.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; for (let a = n; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; });
    window.__inArchive = sid => window.__rows(sid).some(n => n.closest('[data-aad-sec="archive"], .aad-arch, .ch-sec.archive, [data-sec="archive"], .ch-archive'));
  });
  if (!desktop) await page.evaluate(() => window.__wos.openSheet('inbox'));
  return { ctx, page, server };
}
// A row the owner sees in his list (not inside a collapsed Archive section).
const shown = (page, sid) => page.evaluate(s => window.__rows(s).filter(n => !n.closest('details:not([open])')).length, sid);
const tagOf = (page, sid) => page.evaluate(s => window.__rows(s).map(n => (n.closest('.ch-row-wrap, .aad-rw') || n).querySelector('[data-archive-back]')?.textContent || '').find(Boolean) || '', sid);
const refresh = page => page.evaluate(() => window.WizLive.refresh()).catch(() => {});

// One click: the row's own Archive button (Chats › Inbox, both shells); else its menu's Archive.
async function archiveByMenu(page, desktop, sid) {
  const btn = page.locator(`[data-chibarch="${sid}"]`).filter({ visible: true }).first();
  if (await btn.count()) { await btn.click(); return; }
  if (desktop) {
    await page.locator(`.aad-rw[data-sid="${sid}"] .aad-row`).first().dispatchEvent('contextmenu');
    await page.locator('[role="menuitem"]').filter({ hasText: /^\s*Archive/ }).first().click();
  } else {
    await page.locator(`[data-chopen="${sid}"]`).first().dispatchEvent('contextmenu');
    await page.locator('[data-rsact="done"]').first().click();
  }
}

async function scenario(browser, desktop) {
  const shell = desktop ? 'desktop' : 'phone', label = `${shell}/${SWITCH ? 'on' : 'off'}`, shot = n => page.screenshot({ path: path.join(OUT, `${shell}-${SWITCH ? 'on' : 'off'}-${n}.png`) });
  const { ctx, page, server } = await open(browser, desktop);
  try {
    await page.waitForFunction(ids => ids.every(id => window.__rows(id).length), [SETTLED, WORKING, LONG], { timeout: 20000 });
    await sleep(500); await shot('0-before');
    check(await shown(page, SETTLED) && await shown(page, WORKING), `${label}: both chats on screen before`);
    // --- one click each ---
    const t0 = Date.now();
    await archiveByMenu(page, desktop, SETTLED); await sleep(250);
    check(await shown(page, SETTLED) === 0, `${label}: settled chat leaves the list at once (one click)`);
    await archiveByMenu(page, desktop, WORKING); await sleep(250);
    check(await shown(page, WORKING) === 0, `${label}: working chat leaves the list at once (one click)`);
    const patches = server.writes.filter(w => w.body && w.body.archived === true).map(w => w.path);
    check(patches.length >= 2, `${label}: one archive write per chat`, patches);
    await shot('1-after-click');
    // --- the list still lags: poll every 3 s ---
    let back = { settled: 0, working: 0 }, ran = false;
    while (Date.now() - t0 < LAG + 8000) {
      await refresh(page); await sleep(3000);
      // The working run ends 5 s after the archive; the Agent Service then un-archives it with its reply (issue 1997).
      if (!ran && Date.now() - t0 > 5000) { ran = true; const w = server.get(WORKING); Object.assign(w, { status: 'completed', preview: 'Here is the answer', preview_role: 'assistant', wizard_last_assistant_at: Date.now() / 1000, last_active: Date.now() / 1000, message_count: 2 }); server.set(WORKING, false); }
      back.settled += await shown(page, SETTLED) ? 1 : 0; back.working += await shown(page, WORKING) ? 1 : 0;
    }
    await shot('2-after-lag');
    check(back.settled === 0, `${label}: settled chat never came back while the box's list lagged (${LAG} ms)`, back);
    check(back.working === 0, `${label}: working chat stayed archived after its run finished and the box re-opened it`, back);
    while (Date.now() - t0 < HOLD_CHECK) { await refresh(page); await sleep(3000); }
    await refresh(page); await sleep(1200);
    check(await shown(page, SETTLED) === 0 && await shown(page, WORKING) === 0, `${label}: both still archived ${Math.round((Date.now() - t0) / 1000)} s later`, { settled: await shown(page, SETTLED), working: await shown(page, WORKING) });
    await sleep(1500);
    check(SWITCH ? server.truth(server.get(WORKING)) === true : server.truth(server.get(WORKING)) === false, `${label}: the box ${SWITCH ? 'holds the working chat archived again (his other devices follow)' : 'keeps it re-opened (switch off)'}`, server.get(WORKING).hist.slice(-3));
    // A longer run, archived now, finishing after the 60 s hold (the box re-opens it with its reply).
    await archiveByMenu(page, desktop, LONG); await sleep(250);
    check(await shown(page, LONG) === 0, `${label}: long-running chat leaves the list at once`);
    const tL = Date.now();
    let longBack = 0, ended = false;
    while (Date.now() - tL < HOLD_CHECK + LAG + 8000) {
      await refresh(page); await sleep(3000);
      if (!ended && Date.now() - tL > HOLD_CHECK) { ended = true; const w = server.get(LONG); Object.assign(w, { status: 'completed', preview: 'Research done', preview_role: 'assistant', wizard_last_assistant_at: Date.now() / 1000, last_active: Date.now() / 1000 }); server.set(LONG, false); }
      longBack += await shown(page, LONG) ? 1 : 0;
    }
    check(longBack === 0, `${label}: a run finishing after the hold does not bring it back`, { longBack });
    // --- the owner sends in an archived chat (from another device): back, no tag ---
    await archiveByMenu(page, desktop, SENDS); await sleep(LAG + 2000); await refresh(page); await sleep(1000);
    const o = server.get(SENDS); Object.assign(o, { status: 'completed', wizard_last_user_at: Date.now() / 1000, preview: 'Owner wrote again', preview_role: 'user', last_active: Date.now() / 1000 }); server.set(SENDS, false);
    await sleep(LAG + 1000); await refresh(page); await sleep(1500);
    check(await shown(page, SENDS) === 1, `${label}: the owner's own send brings his chat back`);
    check(await tagOf(page, SENDS) === '', `${label}: no tag when he sent in it himself`, await tagOf(page, SENDS));
    // --- the agent starts a new message in the archived settled chat itself (a watch, a schedule) ---
    const sRow = server.get(SETTLED); Object.assign(sRow, { wizard_run_id: 'run-agent-2', preview: 'Your package shipped', preview_role: 'assistant', wizard_last_assistant_at: Date.now() / 1000, last_active: Date.now() / 1000, message_count: 4 }); server.set(SETTLED, false);
    await sleep(LAG + 1000); await refresh(page); await sleep(1500);
    await shot('3-agent-back');
    const tag = await tagOf(page, SETTLED);
    check(await shown(page, SETTLED) === 1, `${label}: an agent-started message brings the chat back`);
    check(SWITCH ? /^Back: .+ wrote$/.test(tag) : tag === '', `${label}: its row says "${SWITCH ? 'Back: <agent> wrote' : '(no tag, switch off)'}"`, tag);
    if (SWITCH) {
      await page.evaluate(sid => { const a = window.__wux || window.__wos; a.openThread ? a.openThread(sid) : a.openWizardThread(sid); }, SETTLED);
      await sleep(1200);
      await page.evaluate(() => { const a = window.__wux || window.__wos; if (a.onBack) a.onBack(); else a.escStep?.(); }); await sleep(800);
      if (!desktop) await page.evaluate(() => window.__wos.openSheet('inbox'));
      await sleep(800);
      check(await tagOf(page, SETTLED) === '', `${label}: the tag goes once he opened the chat`, await tagOf(page, SETTLED));
    }
    check(server.errors.length === 0, `${label}: no page errors`, server.errors);
  } catch (e) { check(false, `${label}: harness`, String(e.stack || e).split('\n').slice(0, 4).join(' | ')); try { await shot('error'); } catch {} }
  finally { await ctx.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--no-sandbox'] });
  try {
    const only = process.env.QA_ONLY;
    await Promise.all([only !== 'desktop' && scenario(browser, false), only !== 'phone' && scenario(browser, true)].filter(Boolean));
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, `results-${SWITCH ? 'on' : 'off'}.json`), JSON.stringify({ tree: TREE, results }, null, 2));
  console.log(`${results.filter(r => r.ok).length} passed, ${failures.length} failed`);
  process.exitCode = failures.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
