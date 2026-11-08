'use strict';
// Archive is the last section of the Chats list again, on phone and desktop (James, 6 Nov 2026); Miguel's opt-in
// "Archive on top" tweak (miguel/archive-top) is the only way to put it first. Real shell in Chromium against a
// disposable synthetic transport: no owner API reads or writes, every unexpected write refused.
// Profiles: phone Classic By status (James's phone) and By day, desktop Classic By status and By day, desktop AI apps
// sidebar (James's desktop). The phone AI apps drawer is retired on live (AI apps is desktop-only), so it is covered by
// tests/ai-apps-view.test.mjs + tests/archive-section-order.test.mjs only. Skins: Nebula (James's) and Grove.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://archive-bottom.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'archive-bottom-evidence');
fs.mkdirSync(out, { recursive: true });
const profiles = [['phone', 'classic', 'status'], ['phone', 'classic', 'day'], ['desktop', 'classic', 'status'], ['desktop', 'classic', 'day'], ['desktop', 'ai-apps', 'status']];
const SKINS = ['nebula', 'grove'];
const EXPECTED_CASES = profiles.length * SKINS.length * 2;
const report = { origin, web, cases: [] }, now = Date.now(), DAY = 864e5;
const iso = t => new Date(t).toISOString();
const sessions = () => [
  { id: 'qa-working', title: 'Synthetic working', status: 'running', at: now - 60e3 },
  { id: 'qa-ready', title: 'Synthetic ready', status: 'completed', at: now - 120e3 },
  { id: 'qa-yesterday', title: 'Synthetic yesterday', status: 'completed', at: now - 1.2 * DAY },
  { id: 'qa-week', title: 'Synthetic last week', status: 'completed', at: now - 3 * DAY },
  { id: 'qa-snoozed', title: 'Synthetic snoozed', status: 'completed', at: now - 180e3 },
  { id: 'qa-archived', title: 'Synthetic archived', status: 'completed', at: now - 240e3, archived: true },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), lastAssistantAt: iso(s.at), message_count: 2, messageCount: 2, archived: !!s.archived }));
(async () => {
  const browser = await chromium.launch();
  try {
    for (const [shell, layout, group] of profiles) for (const skin of SKINS) for (const top of [false, true]) {
      const phone = shell === 'phone', stem = `${shell}-${layout}-${group}-${skin}-archive-top-${top ? 'on' : 'off'}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      const rows = sessions();
      try {
        await context.routeWebSocket('**/*', w => w.close());
        // James's own tweak set on this device (synthetic copy of the choices, never his data), with or without archive-top.
        const mix = { 'wizard/desktop-chats': true, 'miguel/reply-summary': true, 'wizard/thread-tracker': true, ...(top ? { 'miguel/archive-top': true } : {}) };
        await context.addInitScript(({ shell, layout, skin, group, mix }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': layout, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, 'wos.chats.layout.v1': group,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, layout, skin, group, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true }, chatLayout: group } });
          if (p === '/wizard/thread-dispositions') return r.fulfill({ json: { state: { 'qa-snoozed': { deferred: true, updatedAt: iso(now - 170e3) } } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rows, has_more: false } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && !window.WosExperience?.state.busy);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.shell), shell);
        await page.waitForFunction(on => String(document.documentElement.dataset.tweaks || '').split(/\s+/).includes('miguel/archive-top') === on, top, { timeout: 8000 });
        const ai = layout === 'ai-apps';
        if (ai) await page.waitForFunction(() => document.documentElement.dataset.aiApps === 'desktop');
        else await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const sel = ai ? '.aad-sec[data-sec]' : '.ch-list .ch-sec[data-sec]';
        // Every section this list draws, in the order the owner sees them (top to bottom on screen).
        const order = () => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden')
          .map(n => [n.dataset.sec, n.getBoundingClientRect().top]).sort((a, b) => a[1] - b[1]).map(x => x[0]), sel);
        await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(n => n.dataset.sec === 'archive' && n.getClientRects().length), sel, { timeout: 8000 });
        await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(n => n.dataset.sec === 'working' && n.getClientRects().length), sel, { timeout: 8000 });
        entry.order = await order();
        assert.ok(entry.order.length >= 3, stem + ': sections drawn ' + entry.order.join('>'));
        if (top) assert.equal(entry.order[0], 'archive', stem + ': archive-top puts Archive first (' + entry.order.join('>') + ')');
        else assert.equal(entry.order.at(-1), 'archive', stem + ': Archive is the last section (' + entry.order.join('>') + ')');
        const rest = entry.order.filter(k => k !== 'archive');
        assert.ok(rest.indexOf('working') < rest.indexOf('ready'), stem + ': Working above Ready, as before');
        // Opening Archive keeps it in place and shows its row.
        const head = ai ? '.aad-sec[data-sec="archive"]' : '.ch-list .ch-sec[data-sec="archive"] .ch-sec-h';
        await page.locator(head).filter({ visible: true }).first().click();
        await page.getByText('Synthetic archived').filter({ visible: true }).first().waitFor({ timeout: 8000 });
        entry.orderOpen = await order();
        assert.deepEqual(entry.orderOpen, entry.order, stem + ': opening Archive does not move it');
        await page.evaluate(() => document.fonts.ready);
        if (!ai) await page.locator(head).filter({ visible: true }).first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, stem + '.png') });
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'no unexpected mutations: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 2000); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
    assert.equal(report.cases.length, EXPECTED_CASES);
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem), orders: Object.fromEntries(report.cases.map(c => [c.stem, (c.order || []).join('>')])) }, null, 1));
  if (failed.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
