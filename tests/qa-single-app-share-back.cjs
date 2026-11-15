'use strict';
// Back after Share in a pinned app (wizard-music#67). Real Chromium, synthetic transport (no box read or written).
// A home-screen app session (index.html?app-session=wizard-music) opens a stand-in Music page that uses the real
// app-client.js: "Now Playing" is a WizardApp.back layer, and the Share button calls WizardApp.share.text, which opens
// Wizard's own share sheet. Android hands Back to window.__wosNativeBack (MainActivity.handleBack).
// Fixed: Back #1 closes only the share sheet (Now Playing stays), Back #2 closes Now Playing.
// QA_EXPECT=broken (QA_WEB=<main worktree>/web) asserts main closes Now Playing and leaves the sheet open.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://share-back.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'share-back-evidence');
const EXPECT = process.env.QA_EXPECT || 'fixed';
const APP = { id: 'wizard-music', name: 'Music', url: '/wizard-music/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
// Messenger is installed, so Wizard's own sheet (people, apps, Other apps…) opens rather than going straight out.
const MESSENGER = { id: 'messenger', name: 'Messenger', url: '/messenger/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
const PAGE = `<!doctype html><meta charset="utf-8"><title>Music</title><body style="font:18px system-ui;padding:24px;background:#fff">
<h1>Music (stand-in)</h1><section id="now" style="border:2px solid #333;padding:16px"><h2>Now Playing</h2><p>Song — Artist</p>
<button id="share" style="font-size:18px">Share</button></section>
<script src="/wizard-os-home/core/app-client.js"></script><script>
window.nowOpen = true;
WizardApp.back.register({ canGoBack: () => window.nowOpen, back: () => { window.nowOpen = false; document.getElementById('now').hidden = true; return true; } });
document.getElementById('share').onclick = () => { window.outcome = 'pending'; WizardApp.share.text({ title: 'Song — Artist', text: 'From Wizard Music:\\n\\nSong — Artist' }).then(o => { window.outcome = o; }); };
WizardApp.ready?.();
</script></body>`;
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch(), errors = [], refused = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(app => {
      if (window !== top) return;
      localStorage.setItem('wux.apps.v1', JSON.stringify(app));
      for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
    }, [APP, MESSENGER]);
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
      if (u.origin !== origin) { refused.push(q.url()); return r.abort(); }
      if (p.startsWith(APP.url)) return r.fulfill({ body: PAGE, contentType: 'text/html' });
      if (!['GET', 'HEAD'].includes(method)) {
        if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
      }
      if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
      if (p.startsWith(prefix)) {
        const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
        if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
        return r.fulfill({ status: 404, body: 'No synthetic static asset' });
      }
      if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [APP, MESSENGER] } });
      if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + prefix + 'index.html?app-session=wizard-music');
    const app = page.frameLocator('iframe').first();
    await app.locator('#share').waitFor({ timeout: 20000 });
    await nap(800);
    await app.locator('#share').tap();
    await page.locator('.wos-share.on').waitFor({ timeout: 8000 });
    await nap(500);
    await page.screenshot({ path: path.join(out, `share-back-${EXPECT}-1-sheet.png`) });
    const frame = page.frames().find(f => f.url().includes('/wizard-music/'));
    const state = async () => ({ sheet: await page.evaluate(() => !!window.WosShareSheet?.isOpen?.()), now: await frame.evaluate(() => window.nowOpen), outcome: await frame.evaluate(() => window.outcome) });
    const b1 = await page.evaluate(() => window.__wosNativeBack()); await nap(600); const s1 = await state();
    await page.screenshot({ path: path.join(out, `share-back-${EXPECT}-2-after-back.png`) });
    const b2 = await page.evaluate(() => window.__wosNativeBack()); await nap(300); const s2 = await state();
    const report = { expect: EXPECT, web, b1, s1, b2, s2, errors, refused };
    console.log(JSON.stringify(report, null, 1));
    if (EXPECT === 'broken') {
      assert.equal(s1.now, false, 'main: the first Back closes Now Playing'); assert.equal(s1.sheet, true, 'main: the share sheet stays open');
    } else {
      assert.equal(s1.sheet, false, 'Back #1 closes the share sheet'); assert.equal(s1.now, true, 'Now Playing stays open'); assert.equal(s1.outcome, 'cancelled');
      assert.equal(s2.now, false, 'Back #2 closes Now Playing');
    }
    console.log('PASS', EXPECT);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
