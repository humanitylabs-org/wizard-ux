/* Settings lists categories only: no Files / Day / Week / Month in review / Maps / Local command
 * shortcut footer on phone or desktop (James, 25 Oct 2026). Voice/deep-link routes stay.
 * node qa-settings-no-shortcuts.cjs http://127.0.0.1:<port>/wizard-os-home/ */
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9461/wizard-os-home/';
const SHOTS = process.env.QA_OUT || '';
let fail = 0;
const ok = (c, n, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : x); if (!c) fail++; };
(async () => {
  const b = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  for (const desktop of [false, true]) {
    const label = desktop ? 'desktop' : 'phone';
    const ctx = await b.newContext(desktop ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.layout', location.search.includes('desktop') ? 'desktop' : 'phone'); } catch {} });
    const p = await ctx.newPage();
    await p.goto(URL_ + (desktop ? 'desktop.html' : ''), { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !!(window.__wos || window.__wux), null, { timeout: 20000 });
    await p.getByText('Skip tour').click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(400);
    await p.evaluate(() => (window.__wux || window.__wos).openSettings());
    await p.waitForSelector('.st-index nav', { timeout: 10000 });
    const r = await p.evaluate(() => ({
      nav: document.querySelectorAll('.st-index nav [data-st-page]').length,
      footer: document.querySelectorAll('.st-shortcuts,[data-st-shortcut],[data-feature-open]').length,
      text: document.querySelector('.st-index')?.innerText || '',
      registry: (window.WosFeatures?.entries || []).map(f => f.id)
    }));
    ok(r.nav > 0, `${label}: Settings categories render`, r);
    ok(r.footer === 0 && !/in review|Local command|\bMaps\b/.test(r.text), `${label}: no shortcut footer in Settings`, r);
    ok(['day', 'week', 'month', 'maps', 'command'].every(id => r.registry.includes(id)), `${label}: voice/deep-link registry intact`, r.registry);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/settings-${label}.png` });
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `FAIL ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
