'use strict';
// wizard-troubleshooter issue 37 in a real browser: Wizard's usual route is down (the gateway answers nothing on
// /troubleshoot/), Tailscale is up and Troubleshooter's own line on :9691 answers. Fresh install, empty localStorage.
// One Open Troubleshooter tap must land on the real repair page inside the WizardOS window: no "Connection help"
// screen in any frame after the tap, no second tap, never another browser. The shell's real CSP (packaging/static.conf)
// is served with every page, so a blocked frame or ping fails here as it would on a box.
// Phone 412x915 and desktop 1440x900. QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), host = 'wizard.qa-tail.ts.net', origin = `https://${host}`, direct = `https://${host}:9691`, prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'troubleshooter-direct-line-evidence');
const conf = process.env.QA_CSP_FROM || path.join(repo, 'packaging/static.conf');
// nginx fills $wizard_troubleshoot_direct with this page's own https://<host>:9691 (packaging/nginx.conf.template).
const csp = /Content-Security-Policy "([^"]+)"/.exec(fs.readFileSync(conf, 'utf8'))[1].replace(/\$wizard_troubleshoot_direct/g, direct);
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
// Stand-in for the real page: the same ready message as wizard-troubleshooter web/index.html sends a framing shell.
const REPAIR = '<!doctype html><title>Fix Wizard</title><header><h1>Fix Wizard</h1></header><main><p id="ok">All working</p></main>'
  + "<script>try { if (window.parent !== window) window.parent.postMessage({ type: 'wizard-troubleshooter:ready' }, '*'); } catch (e) {}</script>";
const CASES = [
  { name: 'phone-nebula', shell: 'phone', skin: 'nebula' },
  { name: 'phone-grove', shell: 'phone', skin: 'grove' },
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
      const errors = [], seen = { directPing: 0, directPage: 0, usual: 0 };
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ c }) => {
          if (window !== top || location.port === '9691') return;
          for (const [k, v] of Object.entries({ 'wos.shell': c.shell, 'wux.shell': c.shell, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': c.skin })) localStorage.setItem(k, v);
          localStorage.removeItem('wz.troubleshoot.direct'); // fresh install: no remembered direct address
        }, { c });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin === direct) {
            if (p === '/troubleshoot/api/ping') { seen.directPing++; return r.fulfill({ json: { ok: true } }); }
            if (p === '/troubleshoot/' || p === '/troubleshoot/index.html') { seen.directPage++; return r.fulfill({ contentType: 'text/html', body: REPAIR, headers: { 'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self' ${origin}` } }); }
            return r.fulfill({ status: 404, body: 'none' });
          }
          if (u.origin !== origin) return r.abort();
          if (p.startsWith(prefix)) {
            if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs, headers: { 'Content-Security-Policy': csp } }) : r.fulfill({ status: 404, body: 'none' });
          }
          // The gateway route to Troubleshooter (and Wizard's own reads) is down; nothing answers there.
          if (p.startsWith('/troubleshoot/')) { seen.usual++; return r.abort('connectionrefused'); }
          if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        const popups = []; context.on('page', p => { if (p !== page) popups.push(p.url()); });
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wos || window.__wux) && window.WizReach, null, { timeout: 20000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await nap(800);
        // Sample every frame after the tap: was the Connection help screen (the open help section) ever on screen? Once the
        // repair page shows, the help folds into one line above it, as on a healthy Wizard.
        await page.evaluate(() => {
          window.__help = 0; window.__folded = 0; window.__frames = 0;
          const tick = () => {
            window.__frames++;
            for (const d of document.querySelectorAll('[data-recovery] details')) { const b = d.getBoundingClientRect(); if (b.width && b.height && getComputedStyle(d).display !== 'none') { if (d.open) window.__help++; else window.__folded++; } }
            if (window.__frames < 600) requestAnimationFrame(tick);
          };
          window.WizReach.open(); requestAnimationFrame(tick);
        });
        const t0 = Date.now();
        const landed = await page.waitForFunction(d => [...document.querySelectorAll('[data-recovery] iframe')].some(f => !f.hidden && (f.getAttribute('src') || '').startsWith(d)), direct, { timeout: 10000 }).then(() => Date.now() - t0).catch(() => null);
        await nap(600);
        const frame = page.frames().find(f => f.url().startsWith(direct + '/troubleshoot/'));
        const title = frame ? await frame.locator('header h1').innerText().catch(() => '') : '';
        const row = { case: c.name, landedMs: landed, title, helpFrames: await page.evaluate(() => window.__help), foldedFrames: await page.evaluate(() => window.__folded), sampled: await page.evaluate(() => window.__frames), popups, location: page.url(), seen,
          text: (await page.locator('[data-recovery]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160) };
        await page.screenshot({ path: path.join(out, `${c.name}${broken ? '-before' : ''}.png`) });
        if (broken) {
          assert.equal(landed, null, `${c.name}: main never frames the direct line`);
          assert.ok(row.helpFrames > 0, `${c.name}: main shows Connection help`);
        } else {
          assert.ok(landed !== null && landed <= 4500, `${c.name}: the direct line opens in the window within one timeout (${landed} ms)`);
          assert.equal(title, 'Fix Wizard', `${c.name}: the real repair page`);
          assert.equal(row.helpFrames, 0, `${c.name}: no Connection help frame after the tap`);
          assert.deepEqual(popups, [], `${c.name}: never another tab or browser`);
          assert.ok(row.location.startsWith(origin + prefix), `${c.name}: still inside WizardOS`);
          assert.ok(seen.directPing > 0 && seen.directPage > 0);
        }
        assert.deepEqual(errors, [], `${c.name}: page errors`);
        report.push(row);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, `report${broken ? '-before' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
