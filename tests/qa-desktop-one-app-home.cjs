'use strict';
// Narrow desktop, one app at a time: tapping the icon of the app already in front takes it back to its first view
// (wizard-ux issue 1332, switch wizard/app-tap-home, off by default), in a real browser. Synthetic origin, no owner
// writes reach a box (the one-app harness's transport). The app in front is a synthetic page on the real
// core/app-client.js with two kinds of views a real app has: pages on a history adapter (WizardApp.back.useHistory,
// three levels deep) and a tab kept in memory that only the app's own Home knows (WizardApp.nav.onHome).
// Switch on: one tap = tab "Chats", level 0, the typed word still in its field, the page never reloaded.
// Switch off (QA_SWITCH=off): today's tap, one Back step (level 2, the other tab), nothing else changes.
// QA_SHOTS=1 writes before/after shots at 412 px wide (the decider's card).
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..'), prefix = '/wizard-os-home/', origin = 'https://narrow-home.test';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'one-app-home-evidence');
const SW = (process.env.QA_SWITCH || 'on,off').split(','), W = Number(process.env.QA_WIDTH || 412), SHOTS = process.env.QA_SHOTS === '1';
fs.mkdirSync(out, { recursive: true });
const APP = `<!doctype html><meta name="viewport" content="width=device-width"><style>body{background:#fff;color:#111;font:18px system-ui;margin:24px}button{font:inherit;margin:6px 6px 0 0}</style>
<h1 id="view">…</h1><p><input id="field" value="" placeholder="Type here"></p><p><button id="deeper">Open deeper</button><button id="other">Other tab</button></p>
<script src="/wizard-os-home/core/app-client.js"></script>
<script>
  window.__loadId = Math.random().toString(36).slice(2);
  let tab = 'Chats';
  const lvl = () => (history.state && history.state.lvl) || 0;
  const paint = () => { document.getElementById('view').textContent = tab + ' · level ' + lvl(); };
  WizardApp.back.useHistory({ isRoot: () => lvl() === 0 });
  addEventListener('popstate', paint);
  document.getElementById('deeper').onclick = () => { history.pushState({ lvl: lvl() + 1 }, '', '?level=' + (lvl() + 1)); paint(); };
  document.getElementById('other').onclick = () => { tab = 'Other'; paint(); };
  // the app's own first view: its first tab; false lets Wizard also run its Back steps (the pages)
  if (WizardApp.nav.onHome) WizardApp.nav.onHome(() => { tab = 'Chats'; paint(); return false; });
  paint();
</script>`;
const report = { web, width: W, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const sw of SW) {
      const on = sw === 'on', entry = { switch: sw }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: W, height: 860 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const errors = [], writes = [];
      await context.routeWebSocket('**/*', ws => ws.close());
      const mix = on ? { 'wizard/app-tap-home': true } : {};
      await context.addInitScript(({ mix }) => {
        if (window !== top) return;
        for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
          'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
      }, { mix });
      await context.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url());
        if (u.origin !== origin) return r.abort();
        if (u.pathname.includes('/v1/runs')) return r.abort();
        if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: { error: 'QA refuses all writes' } }); }
        if (u.pathname === prefix + 'store/index.html') return r.fulfill({ contentType: 'text/html', body: APP });
        if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
        if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
        if (u.pathname.startsWith(prefix)) {
          const f = decodeURIComponent(u.pathname.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
          if (abs.startsWith(web + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
        }
        return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
      });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + prefix + 'desktop.html');
      await page.waitForFunction(() => window.__wux && document.documentElement.dataset.aiApps === 'desktop' && !WosWelcome.active && !WosExperience.state.busy);
      const settle = async () => { await page.waitForTimeout(400); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
      await page.waitForFunction(on => String(document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/app-tap-home') === on, on);
      await page.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store']));
      const app = page.frameLocator('iframe[src*="/store/index.html"]');
      await app.locator('#field').waitFor();
      await page.waitForFunction(() => document.documentElement.dataset.aadOne === 'app');
      await app.locator('#field').fill('unsent words');
      for (let i = 0; i < 3; i++) await app.locator('#deeper').click();
      await app.locator('#other').click();
      const state = () => app.locator('body').evaluate(() => ({ view: document.getElementById('view').textContent, field: document.getElementById('field').value, load: window.__loadId, url: location.search }));
      entry.before = await state();
      assert.equal(entry.before.view, 'Other · level 3', sw + ': deep in the app before the tap');
      await settle();
      if (SHOTS) await page.screenshot({ path: path.join(out, `deep-${sw}.png`) });
      await page.click('.aad-vt .aad-vtab[data-app="app-store"]');
      await settle();
      entry.after = await state();
      entry.front = await page.evaluate(() => document.documentElement.dataset.aadOne);
      if (SHOTS) await page.screenshot({ path: path.join(out, `tapped-${sw}.png`) });
      assert.equal(entry.front, 'app', sw + ': the app stays in front');
      assert.equal(entry.after.field, 'unsent words', sw + ': the typed word is still there');
      assert.equal(entry.after.load, entry.before.load, sw + ': the app was not reloaded');
      if (on) {
        assert.equal(entry.after.view, 'Chats · level 0', 'on: one tap = the first view');
        assert.equal(entry.after.url, '', 'on: the first page\'s address');
        // a second tap at the first view changes nothing
        await page.click('.aad-vt .aad-vtab[data-app="app-store"]'); await settle();
        const again = await state(); entry.again = again;
        assert.equal(again.view, 'Chats · level 0', 'on: a second tap stays at the first view');
        assert.equal(await page.evaluate(() => document.documentElement.dataset.aadOne), 'app', 'on: still in front after a second tap');
      } else {
        assert.equal(entry.after.view, 'Other · level 2', 'off: today\'s one Back step');
      }
      assert.deepEqual(errors, [], sw + ': no page errors');
      assert.deepEqual(writes.filter(w => !/ui-preferences|look/.test(w)), [], sw + ': no writes');
      await context.close();
    }
    report.ok = true;
  } catch (e) { report.ok = false; report.error = String(e && e.stack || e); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
})();
