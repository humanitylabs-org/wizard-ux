// QA for the Apps / Views / Capabilities mockup (phone shell + desktop palette). Zero writes to Archimedes.
// Usage: node qa-apps-views.cjs [origin=http://127.0.0.1:9391/wizard-os-home/]
const { chromium } = require('/home/telos/node_modules/playwright');
const URL_ = process.argv[2] || 'http://127.0.0.1:9391/wizard-os-home/';
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const NATIVE = ['maps', 'camera', 'phone', 'messages', 'spotify', 'telegram', 'line', 'grab', 'chrome', 'settings'];
const MADE = ['signal-feed', 'reader', 'recall', 'capture', 'idea-queue', 'model-performance', 'golden-frog'];

(async () => {
  const b = await chromium.launch();
  // Phone
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' });
    const writes = [];
    await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\//.test(q.url())) { writes.push(q.url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); } return r.continue(); });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
    await p.goto(URL_, { waitUntil: 'load' }); await p.waitForTimeout(3500);
    await p.evaluate(() => __wos.openSheet('launcher')); await p.waitForTimeout(700);
    const ids = () => p.evaluate(() => [...document.querySelectorAll('#launcherBody [data-app]')].map(e => e.dataset.app));
    const home = await ids();
    ok(!home.some(id => NATIVE.includes(id)), 'phone: no Android apps on the Apps page', JSON.stringify(home));
    ok(!home.some(id => MADE.includes(id)), 'phone: no built-for-you views on the Apps page', JSON.stringify(home));
    ok(home.includes('wizard-signal') && home.includes('cinequeue') && home.includes('files'), 'phone: real apps on the Apps page', JSON.stringify(home));
    const rows = await p.evaluate(() => [...document.querySelectorAll('#launcherBody [data-lpage]')].map(e => e.innerText.replace(/\s+/g, ' ')));
    ok(rows.length === 2 && /Views/.test(rows[0]) && /Capabilities/.test(rows[1]), 'phone: Views and Capabilities rows under the apps', JSON.stringify(rows));
    await p.screenshot({ path: SHOTS + '/av-apps.png' });

    await p.click('[data-lpage="views"]'); await p.waitForTimeout(400);
    const v = await ids();
    ok(MADE.every(id => v.includes(id)), 'phone: Views page lists the built-for-you views', JSON.stringify(v));
    ok(/Not opened in 30 days/i.test(await p.innerText('#launcherBody')), 'phone: Views page groups views not opened in 30 days');
    await p.screenshot({ path: SHOTS + '/av-views.png' });

    // Back from Views returns to Apps and keeps the app open.
    await p.evaluate(() => history.back()); await p.waitForTimeout(600);
    const afterBack = await p.evaluate(() => ({ open: document.querySelector('#launcher')?.classList.contains('open'), rows: document.querySelectorAll('#launcherBody [data-lpage]').length }));
    ok(afterBack.open && afterBack.rows === 2, 'phone: Back from Views returns to Apps (sheet stays open)', JSON.stringify(afterBack));

    await p.click('[data-lpage="caps"]'); await p.waitForTimeout(400);
    const capsTxt = await p.innerText('#launcherBody');
    ok(/DeFleur Video/.test(capsTxt) && /Hello Wizard/.test(capsTxt), 'phone: Capabilities lists DeFleur Video and Hello Wizard', capsTxt.slice(0, 200));
    await p.screenshot({ path: SHOTS + '/av-caps.png' });
    await p.click('.lback'); await p.waitForTimeout(300);

    // Search still finds a view by name; Android never shows.
    await p.fill('#search', 'golden'); await p.waitForTimeout(300);
    ok((await ids()).includes('golden-frog'), 'phone: search finds a view by name');
    await p.fill('#search', 'maps'); await p.waitForTimeout(300);
    ok(!(await ids()).includes('maps'), 'phone: search never shows Android apps');
    ok(await p.evaluate(() => (window.WizCore.apps('mobile').findApp('maps') || {}).id === 'maps'), 'phone: voice "open maps" still resolves');
    ok(await p.evaluate(() => (window.WizCore.apps('mobile').findApp('golden frog') || {}).id === 'golden-frog'), 'phone: voice "open golden frog" still resolves');
    ok(!errs.length, 'phone: no page errors', errs.join(' | '));
    ok(!writes.length, 'phone: zero writes to Archimedes', writes.join(' '));
    await ctx.close();
  }
  // Desktop
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const writes = [];
    await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\//.test(q.url())) { writes.push(q.url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); } return r.continue(); });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(URL_ + 'desktop.html', { waitUntil: 'load' }); await p.waitForTimeout(3500);
    const list = await p.evaluate(() => { const r = window.WizCore.apps('desktop'); return r.APPS.filter(a => a.kind !== 'view' && a.kind !== 'made' && a.kind !== 'native').map(a => a.id); });
    ok(!list.some(id => MADE.includes(id) || NATIVE.includes(id)), 'desktop: quick list has apps only', JSON.stringify(list));
    ok(!errs.length, 'desktop: no page errors', errs.join(' | '));
    ok(!writes.length, 'desktop: zero writes', writes.join(' '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
