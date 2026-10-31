// Offline intent acceptance against real shell assets; only failure/health responses are fixtures.
// All writes are refused. QA_WEB_DIR overlays candidate assets; omit for served-live proof.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const BASE = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-offline-results');
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const results = [];
  try {
    for (const phone of [true, false]) {
      const shell = phone ? 'phone' : 'desktop';
      const ctx = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 1000 }, isMobile: phone, hasTouch: phone,
        ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36' } : {}), permissions: ['microphone'], serviceWorkers: 'block' });
      let failed = false, slowStatus = false, blockedWrites = 0, liveReads = 0;
      const assets = {}, errors = [];
      await ctx.addInitScript(() => { localStorage.setItem('wos.tour.v3', 'done'); localStorage.setItem('wos.skin', 'nebula'); });
      await ctx.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { blockedWrites++; return route.fulfill({ status: 403, json: { error: 'qa_write_blocked' } }); }
        if (u.pathname === '/troubleshoot/api/ping') return route.fulfill({ json: { ok: true } });
        if (u.pathname === '/troubleshoot/api/status') {
          if (slowStatus && !u.searchParams.has('source')) await delay(4500);
          return route.fulfill({ json: { overall: failed ? 'down' : 'ok', checks: failed ? [{ id: 'agent-service', label: 'Agent Service', ok: false, detail: 'QA simulated outage' }] : [] } }).catch(() => {});
        }
        if (failed && u.pathname.startsWith('/wizard/')) return route.abort('internetdisconnected');
        if (process.env.QA_WEB_DIR && u.pathname.startsWith('/wizard-os-home/')) {
          const asset = u.pathname.slice('/wizard-os-home/'.length) || 'index.html';
          const f = path.resolve(process.env.QA_WEB_DIR, 'web', asset), root = path.resolve(process.env.QA_WEB_DIR, 'web') + path.sep;
          if (f.startsWith(root) && /\.(js|css|html|json)$/.test(f) && fs.existsSync(f)) {
            const headers = asset.endsWith('.html') ? (await route.fetch()).headers() : {};
            delete headers['content-length']; delete headers['content-encoding'];
            return route.fulfill({ headers, contentType: asset.endsWith('.css') ? 'text/css' : asset.endsWith('.html') ? 'text/html' : asset.endsWith('.json') ? 'application/json' : 'application/javascript', body: fs.readFileSync(f) });
          }
        }
        return route.continue();
      });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', async r => {
        if (r.ok() && r.url().includes('/wizard/hermes/api/sessions')) liveReads++;
        const key = new URL(r.url()).pathname.split('/').slice(-2).join('/');
        if (r.ok() && ['core/status.js', 'core/reach.js', 'core/polish.css'].includes(key)) {
          try { assets[key] = require('node:crypto').createHash('sha256').update(await r.body()).digest('hex'); } catch (_) {}
        }
      });
      const url = new URL(phone ? 'index.html' : 'desktop.html', BASE).href;
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.WizLive?.ok && window.WizLive.sessions.length && window.WizCore?.status && (window.__wos || window.__wux), null, { timeout: 60000 });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.shell), shell);
      await page.evaluate(() => WizLive.refresh()); // drain any previous refresh before fault injection
      async function recover() {
        failed = false; slowStatus = false;
        await page.evaluate(() => WizLive.refresh());
        await page.waitForFunction(() => ['online', 'restored'].includes(WizCore.status.state.net));
        await page.waitForFunction(() => !document.querySelector('#wxOffline:not([hidden])') && !document.querySelector('[data-wxnet]'), null, { timeout: 10000 });
      }
      async function fail() {
        failed = true;
        await page.evaluate(async () => { await WizLive.refresh(); });
        await page.waitForFunction(() => ['offline', 'reconnecting'].includes(WizCore.status.state.net));
        await page.waitForSelector('[data-wxoffopen]');
      }
      async function navigate() {
        await page.evaluate(() => { if (window.__qaLog) { window.__qaLog.length = 0; return; } window.__qaLog = []; const L = (k, v) => window.__qaLog.push(Math.round(performance.now()) + ' ' + k + ' ' + v);
          addEventListener('click', e => L('click', `${e.target?.id || e.target?.tagName}.${e.target?.className} trusted=${e.isTrusted} btn=${e.button}`), true);
          new MutationObserver(m => m.forEach(r => L('mut', `${r.target.id || r.target.tagName} ${r.attributeName}=${r.target.getAttribute?.(r.attributeName)}`))).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['hidden'] }); });
        // Real owner navigation: desktop Home, phone a dock desk (not the orb).
        await page.locator(phone ? '#dock [data-goto]' : '#logo').first().click();
      }
      async function modal() {
        try { await page.waitForSelector('#wxOffline:not([hidden])', { timeout: 8000 }); }
        catch (e) {
          const d = await page.evaluate(() => ({ net: WizCore.status.state.net, voice: (window.__wos || window.__wux)?.voice, capture: window.WizAppCapture?.getState?.(), off: document.querySelector('#wxOffline')?.outerHTML.slice(0, 200), pill: document.querySelector('#wxBanners')?.textContent.slice(0, 120), active: document.activeElement?.id || document.activeElement?.tagName, log: (window.__qaLog || []).slice(-25) }));
          console.error('MODAL-DIAG', JSON.stringify(d)); throw e;
        }
      }
      async function pillOnly() {
        assert.equal(await page.locator('#wxOffline:not([hidden])').count(), 0);
        assert.equal(await page.locator('[data-wxoffopen]').count(), 1);
      }
      for (const skin of ['nebula', 'signal']) {
        await recover();
        await page.evaluate(skin => WosSkin.set(skin), skin); // same live skin switch the existing status QA uses
        await page.waitForFunction(skin => document.documentElement.dataset.skin === skin, skin);
        await page.evaluate(() => window.__wos ? __wos.closeSheets() : __wux.closeSettings());
        await page.waitForTimeout(700); // finite shell/skin transitions must settle before evidence
        await fail();
        const start = Date.now(); await page.waitForTimeout(20000); await pillOnly();
        assert.ok(Date.now() - start >= 20000);
        await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-idle-20s.png`) });
        await navigate(); await modal();
        await page.locator('[data-wxoffcheck]:not([disabled])').waitFor();
        if (phone) await page.waitForTimeout(700); // desk transition
        const geometry = await page.evaluate(phone => {
          const orb = document.querySelector(phone ? '#orb' : '#micBtn');
          const r = orb.getBoundingClientRect(), card = document.querySelector('.wx-off-card'), c = card.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { orbHit: !!hit && !card.contains(hit) && (hit === orb || orb.contains(hit) || !!(hit.closest && hit.closest('#orbWrap')) || !!(orb.closest('#orbWrap') && orb.closest('#orbWrap').contains(hit))), hit: hit?.id || hit?.tagName, card: { x: c.x, y: c.y, w: c.width, h: c.height, bottom: c.bottom }, orb: { top: r.top, bottom: r.bottom }, bg: getComputedStyle(card).backgroundColor, dialogModal: card.parentElement.getAttribute('aria-modal') };
        }, phone);
        assert.ok(geometry.orbHit, `${shell} ${skin} orb/mic remains the hit target: ${JSON.stringify(geometry)}`);
        assert.equal(geometry.dialogModal, 'false');
        if (phone) { assert.ok(geometry.card.y < 60); assert.ok(geometry.card.bottom < geometry.orb.top); }
        assert.ok(/^(rgb\([^/]*\)|color\(srgb [^/]*\))$/.test(geometry.bg), `opaque kit panel (no alpha channel): ${geometry.bg}`);
        // Pixel opacity proof: the same interior panel pixels over a loud backdrop and a blank one.
        const clip = { x: geometry.card.x + 20, y: geometry.card.y + 20, width: 8, height: 8 };
        const plain = await page.screenshot({ clip });
        await page.evaluate(() => { const p = document.createElement('div'); p.id = 'qaLoudBackdrop'; p.style.cssText = 'position:fixed;inset:0;z-index:189;pointer-events:none;background:magenta;color:lime;font-size:48px'; p.textContent = 'LOUD TEXT '.repeat(500); document.body.appendChild(p); });
        const loud = await page.screenshot({ clip });
        assert.deepEqual(loud, plain, `${shell} ${skin}: panel pixels independent of backdrop`);
        await page.evaluate(() => document.getElementById('qaLoudBackdrop').remove());
        await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-navigation-open.png`) });
        // Actual pointer delivery to the exposed orb/mic starts capture and tucks away the open checks.
        { const b = await page.locator(phone ? '#orb' : '#micBtn').boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); } // real pointer at the orb centre: #orbWrap legitimately owns the hit
        await page.waitForFunction(() => (window.__wos || window.__wux).voice !== 'idle');
        await pillOnly();
        await page.evaluate(phone => document.querySelector(phone ? '#dock [data-goto]' : '#logo').click(), phone); await page.waitForTimeout(400); await pillOnly(); // the capture overlay covers the dock, so dispatch the navigation click directly: it must never reopen
        await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-capture-pill.png`) });
        if (phone) await page.evaluate(() => __wos.cancelVoice());
        else await page.locator('#voiceCancel').click();
        await page.waitForFunction(() => (window.__wos || window.__wux).voice === 'idle');
        await navigate(); await pillOnly();
        await recover(); await fail(); await navigate(); await modal();
        await page.locator('[data-wxoffx]').click(); await navigate(); await pillOnly();
        // Exercise the real request deadline: ping succeeds, only the health body is delayed beyond 4 seconds.
        await recover(); slowStatus = true; await fail(); await navigate(); await modal();
        await page.waitForFunction(() => document.querySelector('#wxOffline')?.textContent.includes('Busy · answering slowly'), null, { timeout: 15000 });
        assert.ok(await page.locator('#wxOffline').textContent().then(s => s.includes('busy and answering slowly')));
        await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-busy.png`) });
        results.push({ shell, skin, geometry, idleOutageMs: Date.now() - start, liveReads, blockedWrites, assets, checks: ['idle-20s-pill-only', 'owner-navigation-opens', 'orb-elementFromPoint', 'orb-tap-starts-real-fake-mic', 'capture-hides-checks', 'capture-navigation-suppressed', 'dismissal-stays-pill', 'recovery', 'status-deadline-busy-slow-row'] });
      }
      assert.deepEqual(errors, []);
      await recover(); await ctx.close();
    }
  } finally {
    await browser.close(); fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  }
  console.log(JSON.stringify(results, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
