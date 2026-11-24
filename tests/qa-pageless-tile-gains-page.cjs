// ux#1646: an app first listed with no page (an install or a rename move) gets its page a moment later. Its New desk
// tile, drawn while it was page-less, must then open the app, not the "Which agents can use <App>?" sheet.
// Synthetic phone shell, never a live API. QA_WEB=<main worktree>/web QA_EXPECT=broken shows main opening the sheet.
// QA_OUT=<dir> saves screenshots.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead, seedOwner } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(process.env.QA_WEB || path.join(__dirname, '..', 'web')), out = process.env.QA_OUT || '';
const broken = process.env.QA_EXPECT === 'broken';
const ORIGIN = 'http://pageless-tile.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const AGENTS = { agents: [{ id: 'hermes', label: 'Hermes', harness: 'hermes', is_default: true, privacy: 'standard', appearance: {} }] };
const PAGELESS = { id: 'tg-style', name: 'TG style', desc: 'Telegram look', source: 'apps.json', type: 'view', category: 'app' };
const PAGE = { ...PAGELESS, url: '/tg-style/' };
let listed = [PAGELESS];
async function transport(ctx) {
  await ctx.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== ORIGIN) return r.abort();
    const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET') return json({});
    if (u.pathname === '/tg-style/') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>TG style</title><h1>TG style page</h1>' });
    if (/\/v1\/setup$/.test(u.pathname)) return json({ first_run: false });
    if (u.pathname === '/wizard/v1/agents') return json(AGENTS);
    if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, settings: { owner: { name: '' }, agent: { name: 'Wizard' } }, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/v1/apps') return json({ apps: listed });
    if (u.pathname.includes('/store-data/')) return json({ results: [], installed: [], wam: [], shell: [], complete: true });
    const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html', f = path.resolve(web, rel);
    if (f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    return json(ownerRead(u.pathname));
  });
}
const shot = async (p, name) => { if (out) await p.screenshot({ path: path.join(out, name + '.png') }); };
(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ headless: true });
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await transport(ctx); await ctx.addInitScript(seedOwner, { phone: true });
    await ctx.addInitScript(() => { if (window !== top) return; localStorage.setItem('wux.shell', 'phone'); localStorage.setItem('wos.shell', 'phone'); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(`${ORIGIN}/wizard-os-home/index.html?phone`);
    await p.waitForFunction(() => document.documentElement.dataset.shell === 'phone' && window.WosAppKinds, null, { timeout: 20000 });
    await p.addStyleTag({ content: '#wosWelcome{display:none!important}' });
    await p.waitForTimeout(1200);
    await p.evaluate(() => { window.__wos.openOverview(); }); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('[data-ovadd]')?.click()); await p.waitForTimeout(800);
    const tile = () => p.evaluate(() => { const t = [...document.querySelectorAll('.new-desk .lapp')].find(x => (x.dataset.app || x.dataset.appinfo) === 'tg-style' && x.getClientRects().length); return t ? (t.dataset.app ? 'app' : 'appinfo') : null; });
    assert.equal(await tile(), 'appinfo', 'drawn page-less: a settings-sheet tile');
    // The page comes up on the box; this device has not read the list again (no focus change).
    listed = [PAGE];
    await shot(p, 'new-desk');
    await p.evaluate(() => [...document.querySelectorAll('.new-desk .lapp')].find(x => (x.dataset.app || x.dataset.appinfo) === 'tg-style' && x.getClientRects().length).click());
    await p.waitForTimeout(1800);
    await shot(p, broken ? 'before-tap' : 'after-tap');
    const s = await p.evaluate(() => ({
      sheet: [...document.querySelectorAll('.ar-head b')].some(b => b.offsetParent !== null && /TG style/.test(b.textContent)),
      frame: [...document.querySelectorAll('iframe')].some(f => (f.getAttribute('src') || '').includes('/tg-style/')),
    }));
    console.log(JSON.stringify(s));
    if (broken) assert.ok(s.sheet && !s.frame, 'main opens the settings sheet');
    else { assert.ok(s.frame, 'the app opened'); assert.ok(!s.sheet, 'no settings sheet'); }
    assert.deepEqual(errs, [], 'no page errors');
    await ctx.close();
    console.log(broken ? 'QA_EXPECT=broken: main opens the settings sheet' : 'ok: the tile opens the app once its page is up');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
