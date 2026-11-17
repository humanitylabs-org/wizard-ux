// ux#1493: the App Store is a normal tile in the apps list (phone Apps sheet, phone New desk, desktop app picker and
// AI apps Home), in two skins, listed once, and tapping it opens the App Store. Synthetic shell, never a live API.
// QA_WEB=<main worktree>/web QA_EXPECT=broken shows main leaving it out. QA_OUT=<dir> saves screenshots.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead, seedOwner } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(process.env.QA_WEB || path.join(__dirname, '..', 'web')), out = process.env.QA_OUT || '';
const broken = process.env.QA_EXPECT === 'broken';
const ORIGIN = 'http://app-store-tile.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
async function transport(ctx) {
  await ctx.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== ORIGIN) return r.abort();
    const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET') return json({});
    if (/\/v1\/setup$/.test(u.pathname)) return json({ first_run: false });
    if (u.pathname.includes('/store-data/')) return json({ results: [], installed: [], wam: [], shell: [], complete: true });
    const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html', f = path.resolve(web, rel);
    if (f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    return json(ownerRead(u.pathname));
  });
}
const shot = async (p, name) => { if (out) await p.screenshot({ path: path.join(out, name + '.png') }); };
// Tiles named exactly "App Store" (not the "+ Get apps" tiles) inside a visible container.
const storeTiles = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel)].filter(b => b.offsetParent !== null && (b.querySelector('.nm')?.textContent || b.textContent).trim() === 'App Store').length, sel);
async function storeOpened(p) {
  await p.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.offsetParent !== null && f.src.includes('/store/index.html')), null, { timeout: 8000 });
}
(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ headless: true }), seen = [];
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      const ctx = await b.newContext(shell === 'phone' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' } : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await transport(ctx); await ctx.addInitScript(seedOwner, { phone: true });
      await ctx.addInitScript(([shell, skin]) => { if (window !== top) return; localStorage.setItem('wux.shell', shell); localStorage.setItem('wos.shell', shell); localStorage.setItem('wos.skin', skin); }, [shell, skin]);
      const p = await ctx.newPage();
      await p.goto(`${ORIGIN}/wizard-os-home/${shell === 'desktop' ? 'desktop.html' : 'index.html?phone'}`);
      await p.waitForFunction(sh => document.documentElement.dataset.shell === sh && window.WosAppKinds, shell, { timeout: 20000 });
      await p.addStyleTag({ content: '#wosWelcome{display:none!important}' });
      await p.waitForTimeout(800);
      if (shell === 'phone') {
        await p.evaluate(() => __wos.openSheet('launcher'));
        await p.waitForTimeout(700);
        const n = await storeTiles(p, '#launcherBody .lapp, #launcher .lapp, .launcher .lapp');
        seen.push([shell, skin, 'Apps sheet', n]); await shot(p, `phone-${skin}-apps-sheet`);
        if (!broken) {
          assert.equal(n, 1, `phone ${skin}: one App Store tile in the Apps sheet`);
          assert.ok(await p.evaluate(() => [...document.querySelectorAll('.lapp')].some(b => b.offsetParent !== null && /Get apps/.test(b.textContent))), 'Get apps tile still there');
          await p.evaluate(() => [...document.querySelectorAll('.lapp')].find(b => b.offsetParent !== null && b.querySelector('.nm')?.textContent.trim() === 'App Store').click());
          await storeOpened(p);
        } else assert.equal(n, 0);
      } else {
        // AI apps view: "Add an app" opens the app picker (layouts/apps/chrome.js, fed by WosAppKinds.rows).
        await p.click('.aad-vall');
        await p.waitForSelector('.vc-pick .vc-app', { timeout: 8000 });
        await p.waitForTimeout(300);
        const n = await p.evaluate(() => [...document.querySelectorAll('.vc-pick .vc-app')].filter(b => b.offsetParent !== null && b.getAttribute('aria-label') === 'Open App Store').length);
        seen.push([shell, skin, 'app picker', n]); await shot(p, `desktop-${skin}-app-picker`);
        if (!broken) {
          assert.equal(n, 1, `desktop ${skin}: one App Store tile in the app picker`);
          assert.ok(await p.evaluate(() => [...document.querySelectorAll('.vc-pick .vc-more')].some(b => b.offsetParent !== null)), 'Get more tile still there');
          await p.click('.vc-pick .vc-app[aria-label="Open App Store"]');
          await storeOpened(p); await p.waitForTimeout(500); await shot(p, `desktop-${skin}-store-open`);
        } else assert.equal(n, 0);
      }
      await ctx.close();
    }
    console.log(JSON.stringify(seen));
    console.log(broken ? 'QA_EXPECT=broken: App Store missing as expected' : 'ok: App Store tile listed once and opens the Store');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
