'use strict';
// wizard-ux issue 1472 kick-back in a real browser (James, 15 Nov: "It should pop up"): once Wizard has been
// unreachable past the 8 s grace, the Troubleshooter opens by itself as a shell window, once per outage. Closed, it
// stays closed while the outage lasts, and the pill's Troubleshoot button opens it again.
// Phone 412x915 (Nebula, Grove, Grove + calm-offline) and desktop 1440x900. Synthetic transport only: every Wizard
// read is answered until the outage starts, then refused.
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts that main opens nothing by itself, as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://offline-troubleshooter-popup.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'offline-troubleshooter-popup-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const ROWS = [{ id: 'qa-1', title: 'Weekend plans', at: now - 6e5 }].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }));
const CASES = [
  { name: 'phone-nebula', shell: 'phone', skin: 'nebula' },
  { name: 'phone-grove', shell: 'phone', skin: 'grove' },
  { name: 'phone-grove-calm', shell: 'phone', skin: 'grove', calm: true },
  { name: 'desktop-nebula', shell: 'desktop', skin: 'nebula' },
];
(async () => {
  const browser = await chromium.launch(), report = [];
  // Troubleshooter windows on screen: the shell window that holds the Troubleshooter (its recovery section, which
  // shows the repair page or, until wizard-troubleshooter#37 lands, Connection help), laid out and visible.
  const tsFrames = page => page.evaluate(() => [...document.querySelectorAll('[data-recovery]')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }).length);
  const tsWin = page => page.evaluate(() => { const r = document.querySelector('[data-recovery]'); const w = r?.closest('.win, [data-win], [data-wid]'); return w ? w.outerHTML.slice(0, 600) : ''; });
  try {
    for (const c of CASES) {
      const phone = c.shell === 'phone';
      const context = await browser.newContext(phone
        ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' }
        : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      const errors = [];
      let down = false;
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ c }) => {
          if (window !== top) return;
          const mix = c.calm ? { 'miguel/calm-offline': true } : {};
          for (const [k, v] of Object.entries({ 'wos.shell': c.shell, 'wux.shell': c.shell, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': c.skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { c });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (p.startsWith(prefix)) {
            if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p.startsWith('/troubleshoot/')) {
            if (p.startsWith('/troubleshoot/api/')) return r.abort('connectionrefused');
            return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Troubleshooter</title><h1 id="ts">Troubleshooter</h1>' });
          }
          if (down) return r.abort('connectionrefused');
          if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wos || window.__wux) && window.WizLive && window.WizCore?.status, null, { timeout: 20000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        if (c.calm) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('miguel/calm-offline'), null, { timeout: 15000 });
        await nap(800);
        // The outage: every Wizard read now fails.
        down = true;
        await page.evaluate(() => window.WizLive.refresh());
        // A blip under the grace shows and opens nothing.
        await nap(2500);
        assert.equal(await page.locator('#wxBanners .wx-banner.net').count(), 0, `${c.name}: no pill inside the grace`);
        assert.equal(await tsFrames(page), 0, `${c.name}: nothing opens inside the grace`);
        await page.waitForSelector('#wxBanners .wx-banner.net', { timeout: 20000 });
        await nap(1500);
        const row = { case: c.name, autoOpened: await tsFrames(page), frames: page.frames().map(f => f.url()).filter(u => u.includes('/troubleshoot/')) };
        await page.screenshot({ path: path.join(out, `${c.name}${broken ? '-before' : '-popped'}.png`) });
        row.checksCard = await page.evaluate(() => !!document.getElementById('wxOffline') && !document.getElementById('wxOffline').hidden);
        if (broken) assert.equal(row.autoOpened, 0, `${c.name}: main opens nothing by itself`);
        else {
          assert.ok(row.autoOpened >= 1, `${c.name}: the Troubleshooter popped up by itself`);
          assert.equal(row.checksCard, false, `${c.name}: not the checks card`);
          // The owner closes it: it must stay closed for the rest of the outage.
          await page.evaluate(() => { const o = window.WizReach.open; window.__opened = 0; window.WizReach.open = function () { window.__opened++; return o.apply(this, arguments); }; });
          if (process.env.QA_DEBUG) console.log(await tsWin(page));
          row.closedBy = await page.evaluate(() => {
            const w = document.querySelector('[data-recovery]')?.closest('.win, [data-win], [data-wid]');
            const b = w && [...w.querySelectorAll('button, [role=button]')].find(x => /close|×/i.test((x.getAttribute('aria-label') || '') + x.textContent + (x.title || '')) && x.getClientRects().length);
            if (b) { b.click(); return 'close button'; }
            return 'none';
          });
          if (row.closedBy === 'none') { await page.keyboard.press('Escape'); row.closedBy = 'Escape'; }
          await nap(800);
          if (await tsFrames(page)) { await page.goBack().catch(() => {}); row.closedBy += '+history'; await nap(800); }
          row.afterClose = await tsFrames(page);
          await nap(15000);
          row.reopenedBy = await page.evaluate(() => window.__opened).catch(() => -1);
          row.after15s = await tsFrames(page);
          await page.screenshot({ path: path.join(out, `${c.name}-closed.png`) });
          assert.equal(row.reopenedBy, 0, `${c.name}: closed, it does not pop up again in this outage`);
          const btn = page.locator('#wxBanners [data-wxtroubleshoot]');
          assert.ok(await btn.isVisible(), `${c.name}: pill still offers Troubleshoot`);
          await btn.click(); await nap(1200);
          row.reopened = await tsFrames(page);
          assert.ok(row.reopened >= 1, `${c.name}: Troubleshoot on the pill opens it again`);
        }
        assert.deepEqual(errors, [], `${c.name}: page errors`);
        report.push(row);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, `report${broken ? '-before' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
