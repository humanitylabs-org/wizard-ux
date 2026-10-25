/* Removal acceptance on a read-only QA origin; no production mutations.
 * node qa-removed-views.cjs http://127.0.0.1:<port>/wizard-os-home/
 * QA_OUT supplies the private screenshot directory. */
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:9371/wizard-os-home/';
const out = process.env.QA_OUT || path.join(process.env.TMPDIR || '.', 'removed-views');
fs.mkdirSync(out, { recursive: true });
let pass = 0, fail = 0;
function ok(value, label, detail) { console.log(value ? 'PASS' : 'FAIL', label, value ? '' : JSON.stringify(detail)); value ? pass++ : fail++; }
(async () => {
  const browser = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  try {
    for (const desktop of [false, true]) {
      const label = desktop ? 'desktop' : 'phone';
      const context = await browser.newContext(desktop ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await context.addInitScript(desktop => {
        try {
          localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.coached', 'true');
          localStorage.setItem('wos.layout', desktop ? 'desktop' : 'phone');
        } catch { /* Sandboxed host probes cannot access origin storage. */ }
      }, desktop);
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      const url = base + (desktop ? 'desktop.html' : '');
      async function boot(query = '') {
        await page.goto(url + query, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!(window.__wos || window.__wux), null, { timeout: 20000 });
        const skip = page.getByText('Skip tour', { exact: true });
        if (await skip.isVisible().catch(() => false)) await skip.click();
        await page.waitForTimeout(500);
      }
      async function absent() {
        return page.evaluate(() => {
          const host = window.__wux || window.__wos;
          const invalid = Object.values(host.wins).filter(w => ['review', 'maps'].includes(w.app) || w.appId === 'system');
          const entries = WizCore.apps(window.__wux ? 'desktop' : 'mobile').APPS;
          return { invalid, apps: entries.filter(a => a.id === 'system' || a.id === 'v-inbox' || a.kind === 'view'), features: WosFeatures.entries.map(f => f.id), panels: document.querySelectorAll('.review,.maps,#inbox.open,#inbox:not([hidden]):not(.sheet),.lm-layer').length };
        });
      }
      await boot();
      const registry = await absent();
      ok(!registry.apps.length && !registry.features.length && !registry.panels, `${label}: launcher/registry contain no removed views`, registry);
      for (const view of ['week', 'maps', 'system', 'inbox']) {
        await boot('?view=' + view);
        const state = await absent();
        ok(!state.invalid.length && !state.panels && await page.evaluate(view => WizCore.deeplink.parse('?view=' + view) === null, view), `${label}: ?view=${view} ignored; shell loads`, state);
      }
      // Old device checkpoints must not resurrect retired windows after a reload.
      await page.evaluate(desktop => {
        const wins = { chat: { id: 'chat', app: 'chats', thread: null }, oldReview: { id: 'oldReview', app: 'review', z: { level: 'week' } }, oldMap: { id: 'oldMap', app: 'maps' }, oldSystem: { id: 'oldSystem', app: 'frame', appId: 'system' }, oldCommand: { id: 'oldCommand', app: 'feature', featureId: 'command' } };
        const ids = Object.keys(wins), desk = { id: 'dretired', wins: ids, focus: 'oldSystem' };
        if (desktop) { localStorage.setItem('wux.desk.wins', JSON.stringify(wins)); localStorage.setItem('wux.desk.ws', JSON.stringify([desk])); }
        else { localStorage.setItem('wos.wins4', JSON.stringify(wins)); localStorage.setItem('wos.strip', JSON.stringify([{ id: 'home', home: true, wins: [] }, desk])); }
      }, desktop);
      await boot();
      ok(await page.evaluate(() => Object.values((window.__wux || window.__wos).wins).every(w => w.app === 'chats')), `${label}: old review/Maps/System/command checkpoints pruned`);
      await page.evaluate(desktop => desktop ? __wux.localCommand('open inbox') : __wos.handleText('open inbox', 'command', true), desktop);
      await page.waitForTimeout(500);
      ok(await page.locator(desktop ? '.pane-list .chats' : '.win.app-chats .chats').count() > 0, `${label}: open inbox routes to Chats`);
      await page.evaluate(desktop => desktop ? __wux.localCommand('open notifications') : __wos.handleText('open notifications', 'command', true), desktop);
      ok(await page.locator(desktop ? '.pane-list .chats' : '.win.app-chats .chats').count() > 0, `${label}: notifications routes to Chats`);
      await page.screenshot({ path: path.join(out, `${label}-chats.png`) });
      await page.evaluate(() => (window.__wux || window.__wos).openSettings());
      await page.waitForSelector('.st-index nav'); await page.waitForTimeout(500);
      ok(await page.locator('.st-index nav [data-st-page]').count() > 0, `${label}: Settings opens`);
      await page.screenshot({ path: path.join(out, `${label}.png`) });
      for (const skin of ['nebula', 'grove']) {
        await page.evaluate(skin => WosSkin.set(skin), skin); await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(out, `${label}-${skin}.png`) });
      }
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      ok(await page.evaluate(desktop => !!(window.__wux || window.__wos) && (desktop ? document.querySelector('#dsettings').hidden : __wos.sheet !== 'settings'), desktop), `${label}: Back closes Settings and keeps shell open`);
      await page.evaluate(desktop => desktop ? (__wux.closeSettings(), __wux.openPicker()) : __wos.openSheet('launcher'), desktop);
      const launcher = await page.evaluate(desktop => (document.querySelector(desktop ? '#palette' : '#launcher')?.innerText || ''), desktop);
      ok(!/\bSystem\b|\bInbox\b|\bin review\b/.test(launcher), `${label}: visible launcher has no System/Inbox/reviews`, launcher);
      ok(!errors.length, `${label}: zero page errors`, errors);
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(`${pass} passed, ${fail} failed`); console.log(fail ? 'FAIL' : 'ALL PASS'); process.exitCode = fail ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
