// Thales browser regression. Real Wizard reads; all writes blocked.
// QA_STATUS_FILE overlays only the candidate banner script for pre-release QA.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const phone of [true, false]) {
      const ctx = await browser.newContext({ viewport: phone ? { width: 412, height: 892 } : { width: 1440, height: 1000 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' } : {}) });
      let failed = false, successfulReads = 0;
      await ctx.addInitScript(() => {
        window.__qaOnline = false;
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__qaOnline });
        localStorage.setItem('wos.coached', '1');
      });
      await ctx.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"qa_write_blocked"}' });
        if (process.env.QA_STATUS_FILE && u.pathname.endsWith('/core/status.js')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.QA_STATUS_FILE, 'utf8') });
        if (failed && u.pathname.startsWith('/wizard/')) return route.abort('internetdisconnected');
        return route.continue();
      });
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.ok() && r.url().includes('/wizard/hermes/api/sessions')) successfulReads++; });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.WizLive?.ok && window.WizLive.sessions.length && window.WizCore?.status && (window.__wos || window.__wux), null, { timeout: 30000 });
      await page.waitForFunction(() => ['online','restored'].includes(WizCore.status.state.net), null, { timeout: 10000 });
      assert.equal(await page.evaluate(() => navigator.onLine), false);
      assert.ok(successfulReads > 0);
      const shell = await page.evaluate(() => document.documentElement.dataset.shell);
      assert.equal(shell, phone ? 'phone' : 'desktop');
      // Replay the erroneous browser offline event while actual HTTP still works.
      await page.evaluate(() => dispatchEvent(new Event('offline')));
      await page.waitForFunction(() => ['online','restored'].includes(WizCore.status.state.net));
      await page.waitForFunction(() => !document.querySelector('[data-wxnet]'));
      // A genuine API outage still warns even after prior successful reads.
      failed = true;
      await page.evaluate(async () => { dispatchEvent(new Event('offline')); await WizLive.refresh(); });
      await page.waitForFunction(() => WizCore.status.state.net === 'offline');
      assert.ok(await page.locator('[data-wxnet="offline"]').isVisible());
      // Recover without changing navigator.onLine or dispatching online.
      failed = false;
      await page.evaluate(() => WizLive.refresh());
      await page.waitForFunction(() => WizCore.status.state.net === 'restored');
      await page.waitForFunction(() => !document.querySelector('[data-wxnet]'));
      assert.equal(await page.evaluate(() => navigator.onLine), false);
      // Browser online, Wizard unreachable -> Reconnecting; successful retry clears.
      failed = true;
      await page.evaluate(async () => { window.__qaOnline = true; await WizLive.refresh(); });
      await page.waitForFunction(() => WizCore.status.state.net === 'reconnecting');
      failed = false;
      await page.evaluate(() => WizLive.refresh());
      await page.waitForFunction(() => !document.querySelector('[data-wxnet]'));
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ shell, successfulReads, checks: ['stale-offline-at-boot','offline-event-with-working-http','actual-outage','recovery-without-online-event','server-outage-and-recovery','no-page-errors'], overlay: !!process.env.QA_STATUS_FILE }));
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
