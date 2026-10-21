// Thales browser regression. Real Wizard reads; all writes blocked.
// QA_STATUS_FILE overlays only the candidate banner script for pre-release QA.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const origin = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    for (const phone of [true, false]) {
      const ctx = await browser.newContext({ viewport: phone ? { width: 412, height: 892 } : { width: 1440, height: 1000 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' } : {}) });
      let failed = false, successfulReads = 0, diagnosisReads = 0;
      await ctx.addInitScript(() => {
        window.__qaOnline = false;
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__qaOnline });
        localStorage.setItem('wos.coached', '1');
      });
      await ctx.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        if (u.pathname === '/troubleshoot/api/ping') { diagnosisReads++; return route.fulfill({ json: { ok: true } }); }
        if (u.pathname === '/troubleshoot/api/status') return route.fulfill({ json: { overall: failed ? 'degraded' : 'ok', checks: failed ? [{ id: 'agent-service', label: 'Agent Service', ok: false, detail: 'Restarting' }] : [] } });
        if (u.pathname === '/troubleshoot/') return route.fulfill({ contentType: 'text/html', body: '<title>Troubleshooter QA fixture</title><a href="/wizard-os-home/">Back to Wizard</a>' });
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"qa_write_blocked"}' });
        if (process.env.QA_WEB_DIR && u.pathname.startsWith('/wizard-os-home/')) {
          const asset = u.pathname.slice('/wizard-os-home/'.length) || 'index.html';
          const file = path.join(process.env.QA_WEB_DIR, 'web', asset);
          if (/^[a-z/-]+\.(js|css|html)$/.test(asset) && fs.existsSync(file)) return route.fulfill({ contentType: asset.endsWith('.css') ? 'text/css' : asset.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(file) });
        }
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
      assert.equal(await page.evaluate(() => WizCanOpen('troubleshooter')), true);
      await page.evaluate(() => WizOpenApp('troubleshooter'));
      await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.src.endsWith('/troubleshoot/') && f.contentDocument?.title === 'Troubleshooter QA fixture'));
      const troubleshootingFrame = page.frames().find(f => f.url().endsWith('/troubleshoot/'));
      assert.ok(troubleshootingFrame); await troubleshootingFrame.waitForLoadState('domcontentloaded');
      assert.equal(await troubleshootingFrame.title(), 'Troubleshooter QA fixture');
      await page.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find(f => new URL(f.src).pathname === '/troubleshoot/'); const id = f.closest('[data-win]')?.dataset.win; if (id) (window.__wos || window.__wux).closeWin(id); });
      // Replay the erroneous browser offline event while actual HTTP still works.
      await page.evaluate(async () => { await WizLive.refresh(); dispatchEvent(new Event('offline')); await WizLive.refresh(); });
      await page.waitForFunction(() => ['online','restored'].includes(WizCore.status.state.net));
      await page.waitForFunction(() => !document.querySelector('[data-wxnet]'));
      // A genuine API outage still warns even after prior successful reads.
      failed = true;
      await page.evaluate(async () => { dispatchEvent(new Event('offline')); await WizLive.refresh(); });
      await page.waitForFunction(() => WizCore.status.state.net === 'offline');
      assert.ok(await page.locator('[data-wxnet="offline"]').isVisible());
      await page.waitForFunction(() => document.querySelector('[data-wxnet]')?.textContent.includes('Agent Service isn’t responding'));
      assert.ok(await page.locator('[data-wxtroubleshoot]').isVisible());
      assert.ok(await page.locator('[data-wxretry]').isVisible());
      // The full message and both controls fit in each real shell on two skins.
      for (const skin of ['nebula', 'signal']) {
        await page.evaluate(skin => WosSkin.set(skin), skin);
        await page.waitForTimeout(150);
        const fit = await page.locator('[data-wxnet]').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth; });
        assert.ok(fit, `${phone ? 'phone' : 'desktop'} ${skin}: banner fits viewport`);
        if (!phone) {
          // Desktop: one line inside the top bar, clear of its icons, and windows keep their place.
          const g = await page.evaluate(() => {
            const b = document.querySelector('[data-wxnet]').getBoundingClientRect(), r = el => document.querySelector(el)?.getBoundingClientRect();
            const kids = sel => [...document.querySelectorAll(sel + ' > *')].map(e => e.getBoundingClientRect()).filter(k => k.width && k.height);
            const lk = kids('.bar-l'), rk = kids('.bar-r');
            const L = lk.length ? { right: Math.max(...lk.map(k => k.right)) } : null, R = rk.length ? { left: Math.min(...rk.map(k => k.left)) } : null;
            const S = r('.stage'), bar = r('.bar') || r('#bar');
            const s = document.querySelector('[data-wxnet] .wx-s');
            return { h: b.height, top: b.top, bottom: b.bottom, barBottom: bar?.bottom, clearL: !L || b.left >= L.right, clearR: !R || b.right <= R.left, stageTop: S?.top, barH: bar?.height, short: s && getComputedStyle(s).display !== 'none' ? s.textContent : '' };
          });
          assert.ok(g.h <= 30 && g.bottom <= g.barBottom + 1, `desktop ${skin}: pill stays in the top bar ${JSON.stringify(g)}`);
          assert.ok(g.clearL && g.clearR, `desktop ${skin}: pill clears bar icons ${JSON.stringify(g)}`);
          assert.ok(Math.abs(g.stageTop - g.barH) <= 1, `desktop ${skin}: windows are not pushed down ${JSON.stringify(g)}`);
          assert.match(g.short, /Agent Service/);
        }
        if (process.env.QA_OUT) { fs.mkdirSync(process.env.QA_OUT, { recursive: true }); await page.screenshot({ path: path.join(process.env.QA_OUT, `${phone ? 'phone' : 'desktop'}-${skin}.png`) }); }
      }
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
      // Verify the actual action destination without contacting a repair service.
      failed = true;
      await page.evaluate(() => WizLive.refresh());
      await page.waitForFunction(() => !!document.querySelector('[data-wxtroubleshoot]'));
      // Troubleshooter opens as an in-shell window on both shells (WizReach.open → WizOpenApp).
      await page.locator('[data-wxtroubleshoot]').click();
      await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.src.endsWith('/troubleshoot/') && f.contentDocument?.title === 'Troubleshooter QA fixture'));
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ shell, successfulReads, diagnosisReads, checks: ['stale-offline-at-boot','launchable-troubleshooter-app','offline-event-with-working-http','actual-outage','diagnosed-service-layer','retry-and-troubleshooter-controls','nebula-fit','signal-fit','recovery-without-online-event','server-outage-and-recovery','troubleshooter-navigation','no-page-errors'], overlay: !!process.env.QA_STATUS_FILE || !!process.env.QA_WEB_DIR }));
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
