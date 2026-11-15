'use strict';
// wizard-ux issue 1472 in a real browser: once Wizard has been unreachable past the 8 s grace, the "Can't reach
// Wizard" pill shows a visible Troubleshoot button, and one tap opens the real Troubleshooter (not the checks card).
// Phone 412x915 (Nebula, Grove, Grove + calm-offline) and desktop 1440x900. Synthetic transport only: every Wizard
// read is answered until the outage starts, then refused.
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old pill (no Troubleshoot) instead, as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://offline-pill-troubleshoot.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'offline-pill-troubleshoot-evidence');
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
        // A blip under the grace shows nothing.
        await nap(2500);
        assert.equal(await page.locator('#wxBanners .wx-banner.net').count(), 0, `${c.name}: no pill inside the grace`);
        await page.waitForSelector('#wxBanners .wx-banner.net', { timeout: 20000 });
        await page.evaluate(() => window.WizLive.refresh()); await nap(600);
        const pill = (await page.locator('#wxBanners .wx-banner.net').innerText()).replace(/\s+/g, ' ').trim();
        const btn = page.locator('#wxBanners [data-wxtroubleshoot]');
        const visible = await btn.count() ? await btn.isVisible() : false;
        await page.screenshot({ path: path.join(out, `${c.name}${broken ? '-before' : ''}.png`) });
        const row = { case: c.name, pill, troubleshoot: visible };
        if (broken) assert.equal(visible, false, `${c.name}: main has no Troubleshoot on the pill`);
        else {
          assert.equal(visible, true, `${c.name}: pill shows Troubleshoot (${pill})`);
          const box = await btn.boundingBox(); row.box = box;
          assert.ok(box.width >= 40 && box.height >= 18, `${c.name}: Troubleshoot is a real tap target`);
          await page.evaluate(() => { const o = window.WizReach.open; window.__opened = 0; window.WizReach.open = function () { window.__opened++; return o.apply(this, arguments); }; });
          const nav = page.waitForEvent(phone ? 'framenavigated' : 'popup', { timeout: 5000 }).catch(() => null);
          await btn.click();
          await nap(1200);
          row.opened = await page.evaluate(() => window.__opened).catch(() => 1);
          row.checksCard = await page.evaluate(() => !!document.getElementById('wxOffline') && !document.getElementById('wxOffline').hidden).catch(() => false);
          const n = await nav; row.landed = n ? (n.url?.() || '') : '';
          if (!row.landed) row.landed = await page.evaluate(() => [...document.querySelectorAll('iframe')].map(f => f.src).find(s => s.includes('/troubleshoot/')) || location.href).catch(() => page.url());
          if (!/\/troubleshoot\//.test(row.landed)) row.landed = page.frames().map(f => f.url()).find(u => u.includes('/troubleshoot/')) || row.landed;
          row.frames = page.frames().map(f => f.url());
          await page.screenshot({ path: path.join(out, `${c.name}-tapped.png`) });
          assert.equal(row.opened, 1, `${c.name}: one tap opens the Troubleshooter`);
          assert.equal(row.checksCard, false, `${c.name}: not the checks card`);
          assert.match(row.landed, /\/troubleshoot\//, `${c.name}: the Troubleshooter itself`);
        }
        assert.deepEqual(errors, [], `${c.name}: page errors`);
        report.push(row);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, `report${broken ? '-before' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
