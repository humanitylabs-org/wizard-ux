// Presentation-only acceptance; real reads, every mutation fenced.
const { chromium } = require(process.env.PW || '/Users/thales/workspace/wizard-mobile-link-candidate/node_modules/playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2]; const OUT = process.env.QA_OUT || 'evidence-home'; fs.mkdirSync(OUT, { recursive: true });
const cases = [], unsafe = [];
function ok(value, label, detail) { cases.push({ label, pass: !!value, detail }); console.log(value ? 'PASS' : 'FAIL', label, detail || ''); }
(async () => {
  const b = await chromium.launch({ headless: true });
  for (const width of [320, 390, 1024]) {
    const c = await b.newContext({ viewport: { width, height: 844 }, isMobile: width < 500, hasTouch: width < 500, ignoreHTTPSErrors: true, serviceWorkers: process.env.QA_SW === 'allow' ? 'allow' : 'block' });
    await c.route('**/*', r => {
      const q=r.request(), u=new URL(q.url());
      if (!['GET','HEAD'].includes(q.method())) { unsafe.push(q.url()); return r.fulfill({status:403,body:'{}'}); }
      if(process.env.QA_WEB_DIR && u.pathname.startsWith('/wizard-os-home/') && !u.pathname.includes('/store-data/')) {
        const rel=u.pathname.slice('/wizard-os-home/'.length)||'index.html', f=path.join(process.env.QA_WEB_DIR,'web',rel);
        if(!rel.includes('..')&&fs.existsSync(f)&&fs.statSync(f).isFile()) return r.fulfill({status:200,contentType:({'js':'application/javascript','css':'text/css','html':'text/html','json':'application/json','png':'image/png','svg':'image/svg+xml','woff2':'font/woff2','webmanifest':'application/manifest+json'})[f.split('.').pop()]||'application/octet-stream',body:fs.readFileSync(f)});
      }
      return r.continue();
    });
    await c.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); });
    const p = await c.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
    await p.goto(BASE + 'store/index.html'); await p.locator('.kind:not([disabled])').first().waitFor();
    const boxes = await p.locator('.kind').evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    ok(boxes.length === 4 && boxes.every(r => r.x >= 0 && r.x + r.w <= width && r.h >= 44), width + ': four accessible choices fit without horizontal overflow', boxes);
    ok(width < 720 ? boxes.every((r, i) => i === 0 || r.y >= boxes[i - 1].y + boxes[i - 1].h - 1) : boxes[0].y === boxes[1].y && boxes[2].y === boxes[3].y, width + ': quiet phone rows / wide 2x2 browse grid');
    await p.screenshot({ path: path.join(OUT, 'browse-' + width + '.png') });
    if (width < 500) {
      await p.goto(BASE + '?shell=phone'); await p.locator('.home-tools .home-system').waitFor();
      const layout = await p.evaluate(() => { const box = q => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }; return { system: box('.home-system'), settings: box('.home-tools .gear'), date: (() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.home-date')); const r = range.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(), clock: box('.home-time'), resources: !!document.querySelector('[data-home-resources] .rs-widget') }; });
      const r = layout.system, g = layout.settings, d = layout.date;
      ok(r.w === 44 && r.h === 44 && g.x >= r.x + r.w && g.x + g.w <= width && (r.y + r.h <= d.y - 4) && layout.resources, width + ': compact System/Settings fit above date; resource widget preserved', layout);
      await p.screenshot({ path: path.join(OUT, 'home-' + width + '.png') });
      if (process.env.QA_SW === 'allow') {
        const sw = await p.evaluate(async () => { await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('no SW ready')), 10000))]); return (await navigator.serviceWorker.getRegistrations()).map(r => r.scope); });
        await p.reload(); await p.locator('.home-system').waitFor();
        ok(await p.evaluate(() => !!navigator.serviceWorker.controller) && sw.some(x => x.includes('/wizard-os-home/')), width + ': real production service worker controls refreshed Home');
        ok(await p.locator('.sys-card').count() === 0 && await p.locator('.home-system').count() === 1, width + ': controlled reload retains final compact Home');
      }
    }
    ok(errors.length === 0, width + ': zero page errors', errors); await c.close();
  }
  // Upstream loading/failure and empty-catalogue are deterministic isolated fixtures, never sent to James.
  for (const mode of ['loading', 'error', 'empty']) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
    let unblock;
    await c.route('**/store-data/wizard/v1/index/search?limit=100', async r => {
      if (mode === 'loading') await new Promise(resolve => { unblock = resolve; });
      await r.fulfill({ status: mode === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ apps: [] }) });
    });
    await c.route('**/store-data/api/apps/installed', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"installed":[]}' }));
    const p = await c.newPage(); await p.goto(BASE + 'store/index.html', { waitUntil: 'domcontentloaded' });
    if (mode === 'loading') { await p.locator('#browse-status:not([hidden])').waitFor(); ok(await p.locator('.kind[disabled]').count() === 4 && /loading/i.test(await p.locator('#browse-status').innerText()), 'loading: four choices explain loading and cannot open a false empty list'); while (!unblock) await p.waitForTimeout(10); unblock(); }
    if (mode === 'error') { await p.waitForFunction(() => /isn.t reachable/.test(document.querySelector('#browse-status').textContent)); ok(await p.locator('.kind[disabled]').count() === 4 && await p.locator('#browse-status').isVisible(), 'error: four choices retained with truthful unavailable status'); }
    if (mode === 'empty') { await p.locator('.kind:not([disabled])').first().waitFor(); await p.locator('[data-kind="apps"]').click(); ok(await p.locator('#results .empty').isVisible(), 'empty: category opens a truthful empty list'); }
    await c.close();
  }
  ok(unsafe.length === 0, 'zero unsafe attempts', unsafe); await b.close();
  const pass = cases.filter(c => c.pass).length, fail = cases.length - pass;
  fs.writeFileSync(path.join(OUT, 'home-receipt.json'), JSON.stringify({ base: BASE, host: require('os').hostname(), source: process.env.SOURCE_SHA, pass, fail, cases, unsafe }, null, 2));
  console.log(pass + ' passed, ' + fail + ' failed'); if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
