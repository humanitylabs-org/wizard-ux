'use strict';
// wizard-ux issue 1432 in a real browser (graceful restart note polish, switch wizard/graceful-restart on, a hold active):
//   phone 412x915: a held chat's message box shows no Stop and no "Steer …"; the note shows in every frame across
//   thread <-> Chats list navigation; a new chat sent during the hold shows the owner's words as its title from the tap
//   (the synthetic box lists it as "New chat" the whole time, like a box whose first turn the restart holds);
//   desktop 1440x900, AI apps with no Chats window (Nebula, Grove): the note under the message box has an opaque panel.
// Synthetic transport only (no box is reached). QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://graceful-restart-polish.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'graceful-restart-polish-evidence');
const broken = process.env.QA_EXPECT === 'broken', tag = broken ? 'before' : 'after';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const row = (id, title, status, at) => ({ id, title, runtime: 'direct', status, updated_at: iso(at), updatedAt: iso(at), last_active: at / 1000, message_count: 2, messageCount: 2, preview: 'Working on it.' });
const HOLD = { phase: 'waiting', holding: true, reason: 'update', active: 1, held: 1, oldest_active_s: 40, wait_until: iso(now + 6e5) };
(async () => {
  const browser = await chromium.launch(), report = {};
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
  const rows = [row('qa-long', 'Long research', 'running', now - 6e5), row('qa-done', 'Weekend plans', 'completed', now - 36e5)];
  const said = new Map(); // session id -> the owner's words sent during the hold
  const runs = [];
  try {
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(() => {
      if (window !== top) return;
      for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
        'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/graceful-restart': true } }) })) localStorage.setItem(k, v);
    });
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
      if (u.origin !== origin) return r.abort();
      if (p === '/wizard/health') return r.fulfill({ json: { status: 'ok', restart: HOLD } });
      if (method === 'POST' && p === '/wizard/hermes/api/sessions') {
        const b = q.postDataJSON() || {}; if (b.id && !rows.some(s => s.id === b.id)) rows.unshift(row(b.id, 'New chat', 'queued', Date.now()));
        return r.fulfill({ json: { session: { id: b.id } } });
      }
      if (method === 'POST' && p === '/wizard/hermes/v1/runs') {
        const b = q.postDataJSON() || {}, sid = b.session_id || b.sessionId || '';
        runs.push(sid); said.set(sid, String(b.input || b.message || b.text || 'sent during the hold'));
        const s = rows.find(x => x.id === sid); if (s) { s.status = 'queued'; s.updated_at = s.updatedAt = iso(Date.now()); }
        return r.fulfill({ status: 202, json: { run_id: 'wizardq_held_' + runs.length, status: 'queued', queue_reason: 'restart_pending' } });
      }
      if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
      if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true } });
      if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
      if (p.startsWith(prefix)) {
        const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
        if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
        return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
      }
      if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rows, has_more: false } });
      const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
      if (m) {
        const s = rows.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
        const msgs = s.id === 'qa-done' ? [{ role: 'user', content: 'Plan the weekend', timestamp: now / 1000 - 3600 }, { role: 'assistant', content: 'Here is a plan.', timestamp: now / 1000 - 3590 }] : [];
        if (said.has(s.id)) msgs.push({ role: 'user', content: said.get(s.id), timestamp: Date.now() / 1000 - 2 });
        return r.fulfill({ json: m[2] ? { messages: msgs } : { session: s } });
      }
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage();
    await page.goto(origin + prefix + 'index.html?phone');
    await page.waitForFunction(() => window.WizReach?.restart?.()?.phase === 'waiting', null, { timeout: 20000 });

    const vis = sel => page.locator(sel).filter({ visible: true }).first();
    const comp = () => page.evaluate(() => { const f = [...document.querySelectorAll('.ch-compose')].find(e => e.getClientRects().length);
      return { stop: !!f?.querySelector('[data-chstop]'), ph: f?.querySelector('textarea')?.placeholder || '' }; });
    await page.evaluate(() => window.__wos.openWizardThread('qa-done'));
    await vis('.ch-compose textarea').waitFor({ timeout: 15000 });
    await vis('.ch-compose textarea').fill('Add sandwiches');
    await vis('.ch-compose .ch-send').click();
    await page.waitForFunction(() => [...(window.WosOutbox?._items?.values() || [])].some(it => it.state === 'sent'), null, { timeout: 15000 });
    await nap(2500);
    report.composer = await comp(); console.log('composer', JSON.stringify(report.composer));
    await page.screenshot({ path: path.join(out, `held-composer-${tag}.png`) });
    // note across thread -> list navigation, rAF sampled
    await page.evaluate(() => { window.__gaps = { n: 0, miss: 0 }; const tick = () => { window.__gaps.n++; if (![...document.querySelectorAll('[data-restart-notice]')].some(e => e.getClientRects().length)) window.__gaps.miss++; if (window.__gaps.on) requestAnimationFrame(tick); }; window.__gaps.on = true; requestAnimationFrame(tick); });
    await vis('[data-chback]').click();
    await nap(1500);
    await page.evaluate(() => window.__wos.openWizardThread('qa-done')); await nap(1500);
    await vis('[data-chback]').click(); await nap(1500);
    report.nav = await page.evaluate(() => { window.__gaps.on = false; return window.__gaps; }); console.log('nav', JSON.stringify(report.nav));
    // new chat title
    await vis('.ch-fab').click();
    await vis('.ch-compose textarea').waitFor({ timeout: 15000 });
    await vis('.ch-compose textarea').fill('Find a ferry time');
    const t0 = Date.now();
    await vis('.ch-compose .ch-send').click();
    const titles = [];
    for (let i = 0; i < 16; i++) { titles.push(await page.evaluate(() => ({ head: [...document.querySelectorAll('.ch-head .ti b')].filter(e => e.getClientRects().length).map(e => e.textContent).join('|') }))); await nap(700); }
    report.titles = titles; console.log('titles', JSON.stringify(titles.map(t => t.head)));
    await page.evaluate(() => window.__wos.openSheet('inbox')); await nap(800);
    report.listRows = await page.evaluate(() => [...document.querySelectorAll('[data-chopen]')].filter(e => e.getClientRects().length).map(e => e.textContent.trim().slice(0, 50)));
    console.log('list', JSON.stringify(report.listRows));
    await page.screenshot({ path: path.join(out, `held-list-${tag}.png`) });
    await context.close();
    // Desktop, AI apps, no Chats window and no chat open: the empty new chat's message box floats on the wallpaper.
    report.desktop = {};
    for (const skin of ['nebula', 'grove']) {
      const dc = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await dc.routeWebSocket('**/*', w => w.close());
      await dc.addInitScript(skin => {
        if (window !== top) return;
        for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
          'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true, 'wizard/graceful-restart': true } }) })) localStorage.setItem(k, v);
      }, skin);
      await dc.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
        if (u.origin !== origin) return r.abort();
        if (p === '/wizard/health') return r.fulfill({ json: { status: 'ok', restart: HOLD } });
        if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true } });
        if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
        if (p.startsWith(prefix)) {
          const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
          if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
          return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
        }
        if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
        if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [row('qa-long', 'Long research', 'running', now - 6e5)], has_more: false } });
        if (/^\/wizard\/hermes\/api\/sessions\//.test(p)) return r.fulfill({ json: { messages: [] } });
        return r.fulfill({ json: ownerRead(p) });
      });
      const dp = await dc.newPage();
      await dp.goto(origin + prefix + 'desktop.html');
      await dp.waitForFunction(() => window.WizReach?.restart?.()?.phase === 'waiting', null, { timeout: 20000 });
      await dp.waitForFunction(() => [...document.querySelectorAll('[data-restart-notice]')].some(e => e.getClientRects().length), null, { timeout: 15000 });
      await nap(1000);
      report.desktop[skin] = await dp.evaluate(() => {
        const n = [...document.querySelectorAll('[data-restart-notice]')].find(e => e.getClientRects().length);
        return { inBox: !!n.parentElement.classList.contains('ch-compose'), bg: getComputedStyle(n).backgroundColor };
      });
      console.log('desktop', skin, JSON.stringify(report.desktop[skin]));
      await dp.screenshot({ path: path.join(out, `desktop-${skin}-${tag}.png`) });
      await dc.close();
    }
    const opaque = c => /^rgb\(/.test(c) || /^rgba\(.*,\s*1\)$/.test(c);
    const ownTitle = report.titles.slice(3).every(t => t.head === 'Find a ferry time');
    const listOwn = report.listRows.some(r => r.startsWith('Find a ferry time'));
    if (broken) {
      assert.ok(report.composer.stop || /^Steer/.test(report.composer.ph) || report.nav.miss > 0 || !ownTitle || !listOwn
        || Object.values(report.desktop).some(d => !opaque(d.bg)), 'main shows at least one of the four problems');
    } else {
      assert.equal(report.composer.stop, false, 'no Stop on a held chat');
      assert.doesNotMatch(report.composer.ph, /^Steer/, 'no Steer placeholder on a held chat');
      assert.equal(report.nav.miss, 0, `the note shows in every frame across thread <-> list (${report.nav.n} frames)`);
      assert.ok(ownTitle, 'the new chat\'s header shows the owner\'s words');
      assert.ok(listOwn, 'the Chats list row shows the owner\'s words');
      for (const [skin, d] of Object.entries(report.desktop)) assert.ok(opaque(d.bg), `${skin}: the note under the message box has an opaque panel (${d.bg})`);
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(broken ? 'baseline confirmed on main' : 'ok: held box is idle, note kept across navigation, own title from the tap, opaque panel on desktop');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
