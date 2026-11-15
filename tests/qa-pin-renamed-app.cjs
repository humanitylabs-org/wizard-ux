'use strict';
// A home-screen pin made under an app's old id (ux#1471, James's Search pin `search-preview`). Real Chromium, synthetic box.
// The box lists Search as `wizard-search` declaring renamed_from: [search-preview]; the pin opens index.html?app-session=search-preview.
// QA_DECLARED=0: the box list does not carry renamed_from yet (older App Manager): the reviewed alias still opens it.
// Fixed: Search mounts. QA_EXPECT=broken (QA_WEB=<main>/web): "App unavailable".
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://pin-rename.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'pin-rename-evidence');
const EXPECT = process.env.QA_EXPECT || 'fixed';
const APP = { id: 'wizard-search', name: 'Search', url: '/wizard-search/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running', ...(process.env.QA_DECLARED === '0' ? {} : { renamed_from: ['search-preview'] }) };
const PAGE = `<!doctype html><meta charset="utf-8"><title>Search</title><body style="font:18px system-ui;padding:24px;background:#fff">
<h1 id="ok">Search</h1><input placeholder="Search the web" style="font-size:18px;width:90%"><script src="/wizard-os-home/core/app-client.js"></script><script>WizardApp.ready?.()</script></body>`;
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(APP => { if (window !== top) return; localStorage.setItem('wux.apps.v1', JSON.stringify([APP])); for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v); }, APP);
    await context.route('**/*', async r => {
      const u = new URL(r.request().url()), p = u.pathname;
      if (u.origin !== origin) return r.abort();
      if (p.startsWith(APP.url)) return r.fulfill({ body: PAGE, contentType: 'text/html' });
      if (r.request().method() !== 'GET') return r.fulfill({ json: {} });
      if (p.startsWith(prefix)) {
        const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
        if (abs.startsWith(path.resolve(web) + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
        return r.fulfill({ status: 404, body: '' });
      }
      if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [APP] } });
      if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
      if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage();
    await page.goto(origin + prefix + 'index.html?app-session=search-preview');
    await page.waitForTimeout(4000);
    const unavailable = await page.locator('.single-unavailable h2').count();
    const mounted = await page.frameLocator('iframe').first().locator('#ok').count().catch(() => 0);
    await page.screenshot({ path: path.join(out, `pin-rename-${EXPECT}.png`) });
    console.log(JSON.stringify({ EXPECT, unavailable, mounted }));
    if (EXPECT === 'broken') assert.equal(unavailable, 1, 'main shows App unavailable');
    else { assert.equal(unavailable, 0); assert.equal(mounted, 1, 'Search mounts from the old-id pin'); }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
