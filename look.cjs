'use strict';
// Scratch QA for wizard-ux issue 1239: boot the real shell (phone + desktop, Nebula + Grove) from QA_WEB with a
// synthetic origin (every write refused), with default settings and with stale saved ids of the removed switches.
// Records what Settings › Look offers, what runs, page errors, and screenshots of Home and Settings › Look.
const path = require('node:path'), fs = require('node:fs');
const repo = process.env.QA_REPO;
const { chromium } = require(path.join(repo, 'tools/qa-playwright.cjs'));
const { ownerRead } = require(path.join(repo, 'tools/qa-desktop-frame-fixture.cjs'));
const web = path.join(repo, 'web'), out = process.env.QA_OUT, origin = 'https://look-1239.test', prefix = '/wizard-os-home/';
fs.mkdirSync(out, { recursive: true });
const REMOVED = ['wizard/new-send-list', 'wizard/wizardos-name', 'wizard/two-orbs', 'wizard/app-borders', 'wizard/pin-buttons', 'miguel/no-desk-close', 'miguel/group-by-day', 'wizard/orb-radial', 'miguel/switch-row-actions'];
const nap = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch(); const report = [];
  try {
    for (const saved of ['defaults', 'stale']) for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      const phone = shell === 'phone', stem = `${saved}-${shell}-${skin}`, e = { stem, errors: [], writes: [], requested: [] };
      const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
      try {
        await ctx.routeWebSocket('**/*', w => w.close());
        await ctx.addInitScript(({ shell, skin, saved, REMOVED }) => {
          if (window !== top) return;
          const base = { 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin };
          if (saved === 'stale') { base['wos.layout'] = 'two-orb'; base['wos.skin-tweaks.v1'] = JSON.stringify({ version: 1, off: { wizard: ['wizard/pin-buttons'] }, preset: 'none', mix: Object.fromEntries(REMOVED.map(id => [id, true])), machinesHomeMoved: true }); }
          if (!sessionStorage.getItem('qa-seeded')) { for (const [k, v] of Object.entries(base)) localStorage.setItem(k, v); sessionStorage.setItem('qa-seeded', '1'); }
        }, { shell, skin, saved, REMOVED });
        await ctx.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname;
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(q.method())) { e.writes.push(q.method() + ' ' + p); return r.fulfill({ status: 405, json: { error: 'refused' } }); }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (f.startsWith('tweaks/')) e.requested.push(f);
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await ctx.newPage(); page.on('pageerror', x => e.errors.push(x.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
        await nap(1200);
        Object.assign(e, await page.evaluate(() => ({ layout: document.documentElement.dataset.layout || '', offered: WosExperience.state.tweaks.filter(t => !t.builtin && !t.view).map(t => t.id).sort(), running: [...WosSkinHost.tweakState].sort(), error: WosExperience.state.error })));
        await page.screenshot({ path: path.join(out, stem + '-home.png') });
        if (phone) { await page.evaluate(() => __wos.openSheet('settings')); await nap(500); const a = page.locator('[data-st-page="appearance"]').filter({ visible: true }).first(); if (await a.isVisible().catch(() => false)) await a.click(); }
        else await page.evaluate(() => __wux.openSettings('look'));
        await nap(1200);
        e.lookRows = await page.evaluate(() => [...document.querySelectorAll('[data-tweak-toggle]')].filter(b => b.getClientRects().length).map(b => b.dataset.tweakToggle));
        const row = page.locator('[data-tweak-toggle]').filter({ visible: true }).first();
        if (await row.count()) await row.scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: path.join(out, stem + '-look.png') });
        e.stale = e.requested.filter(f => REMOVED.some(id => f.startsWith('tweaks/' + id + '/')));
      } catch (x) { e.failure = String(x.stack || x).slice(0, 400); }
      finally { report.push(e); await ctx.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
  for (const e of report) console.log(e.stem, JSON.stringify({ layout: e.layout, errors: e.errors.length, writes: e.writes.length, stale: e.stale, offered: (e.offered || []).length, running: e.running, lookRows: (e.lookRows || []).length, failure: e.failure }));
})();
