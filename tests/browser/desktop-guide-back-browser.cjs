// Browser test (Codex #483): Back through the REAL desktop shell with the first-message guide showing.
// node tests/browser/desktop-guide-back-browser.cjs <base, e.g. http://127.0.0.1:8809/wizard-os-home/>
// Real desktop.html (device detection, no ?shell override), all writes stubbed, alongside first launch mocked.
// Checks, for both Back paths the shell has (Esc key, browser history Back -> popstate):
//   1. Tapping Settings while the guide shows is a tap outside it, so the guide closes like Back
//      (= Skip tour, remembered) and Settings opens (James, 28 Oct 2026: tap outside closes, like Back).
//   2. Back closes Settings; the page never leaves Wizard.
//   3. Back at the root with nothing open stays in Wizard.
const { chromium } = require('playwright');
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node desktop-guide-back-browser.cjs <base>'); process.exit(2); }
let fail = 0; const ok = (c, n, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); if (!c) fail++; };
const state = p => p.evaluate(() => ({ path: location.pathname, guide: !!document.querySelector('.dtr'), done: localStorage.getItem('wos.tour.v1') === 'true',
  settings: [...document.querySelectorAll('section')].some(s => !s.hidden && /settings/i.test(s.className)), shell: document.documentElement.dataset.shell }));
(async () => {
  const b = await chromium.launch();
  for (const how of ['Escape key', 'history Back']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/*', r => r.request().method() === 'GET' || r.request().method() === 'HEAD' ? r.fallback() : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await ctx.route(/\/wizard\/v1\/setup$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"first_run":true,"launch_mode":"alongside"}' }));
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE, { waitUntil: 'load' });
    const back = async () => { if (how === 'Escape key') await p.keyboard.press('Escape'); else await p.evaluate(() => history.back()); await p.waitForTimeout(500); };
    let s = await state(p); ok(s.shell === 'desktop', `${how}: real desktop shell`, JSON.stringify(s));
    try { await p.waitForSelector('.dtr', { timeout: 8000 }); } catch (e) {}
    s = await state(p); ok(s.guide, `${how}: guide showing on first launch`, JSON.stringify(s));
    await p.click('body', { position: { x: 720, y: 400 } }).catch(() => {}); // a real gesture arms the history guard
    await p.locator('#settingsBtn').click(); await p.waitForTimeout(400);
    s = await state(p); ok(s.settings && !s.guide && s.done, `${how}: tapping Settings closes the guide like Back (remembered) and opens Settings`, JSON.stringify(s));
    await back(); s = await state(p);
    ok(!s.settings && !s.guide, `${how}: Back closes Settings; the guide does not return`, JSON.stringify(s));
    ok(/\/wizard-os-home\//.test(s.path), `${how}: still inside Wizard`, s.path);
    await back(); s = await state(p);
    ok(/\/wizard-os-home\//.test(s.path) && !s.guide, `${how}: Back at the root stays in Wizard`, JSON.stringify(s));
    ok(errs.length === 0, `${how}: no page errors`, errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `\n${fail} failed` : '\nall passed'); process.exitCode = fail ? 1 : 0;
})();
