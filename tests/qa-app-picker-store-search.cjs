// wizard-os#721: on the AI apps desktop, "Add an app" (the Apps column's +) opens the app picker; typing a name there
// also finds apps in the App Store that are not installed yet (on for everyone), and picking one opens that app's page
// in the App Store. Synthetic shell and a fake Store index, never a live API.
//   QA_OUT=<dir>: screenshots (picker-<skin>.png, cropped to the picker's left 412 px: picker-<skin>-crop.png).
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead, seedOwner } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(process.env.QA_WEB || path.join(__dirname, '..', 'web')), out = process.env.QA_OUT || '';
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
const ORIGIN = 'http://app-picker-store-search.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
// The Store index: two apps this Wizard does not have, one agent-only thing (not an app with a screen).
const INDEX = { apps: [
  { id: 'wizard-maps', name: 'Maps', summary: 'Maps, places and directions', type: 'view' },
  { id: 'wizard-podcasts', name: 'Podcasts', summary: 'Listen to your shows', type: 'view' },
  { id: 'wizard-mapper', name: 'Mapper agent', summary: 'Maps for agents', type: 'agent' },
], next_offset: null };
async function transport(ctx, seen) {
  await ctx.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== ORIGIN) return r.abort();
    const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET') return json({});
    if (/\/v1\/setup$/.test(u.pathname)) return json({ first_run: false });
    if (u.pathname.endsWith('/store-data/wizard/v1/index/search')) { seen.push(u.pathname + u.search); return json(INDEX); }
    if (u.pathname.includes('/store-data/')) return json({ results: [], installed: [], wam: [], shell: [], complete: true });
    const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html', f = path.resolve(web, rel);
    if (f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    return json(ownerRead(u.pathname));
  });
}
const visible = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel)].filter(b => b.offsetParent !== null).map(b => b.getAttribute('aria-label') || b.textContent.trim()), sel);
(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ headless: true }), report = { cases: [] };
  try {
    for (const skin of SKINS) {
      const reads = [], ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await transport(ctx, reads); await ctx.addInitScript(seedOwner, { phone: false });
      const mix = {};
      await ctx.addInitScript(([skin, mix]) => { if (window !== top) return; for (const [k, v] of Object.entries({ 'wux.shell': 'desktop', 'wos.shell': 'desktop', 'wos.skin': skin,
        'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v); }, [skin, mix]);
      const p = await ctx.newPage(), errors = [];
      p.on('pageerror', e => errors.push(String(e)));
      await p.goto(`${ORIGIN}/wizard-os-home/desktop.html`);
      await p.waitForFunction(() => document.documentElement.dataset.shell === 'desktop' && window.WosAppKinds, null, { timeout: 20000 });
      await p.addStyleTag({ content: '#wosWelcome{display:none!important}' });
      await p.waitForTimeout(800);
      await p.click('.aad-vall');
      await p.waitForSelector('.vc-pick .vc-q', { timeout: 8000 });
      await p.waitForTimeout(400);
      const idle = { store: await visible(p, '.vc-pick .vc-get'), reads: reads.length };
      await p.fill('.vc-pick .vc-q', 'map');
      await p.waitForTimeout(800);
      const typed = { heads: await p.evaluate(() => [...document.querySelectorAll('.vc-pick .vc-sec-h > span')].map(s => s.textContent)), store: await visible(p, '.vc-pick .vc-get'), installed: await visible(p, '.vc-pick .vc-app'), reads: reads.length };
      if (out) { await p.screenshot({ path: path.join(out, `picker-${skin}.png`) });
        const card = await p.evaluate(() => { const r = document.querySelector('.vc-pick .vc-card').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        const w = 412, x = Math.max(0, Math.round(card.x));
        await p.screenshot({ path: path.join(out, `picker-${skin}-crop.png`), clip: { x, y: Math.max(0, card.y - 16), width: w, height: Math.min(900 - Math.max(0, card.y - 16), Math.max(500, card.height + 32)) } }); }
      const entry = { skin, idle, typed, errors };
      {
        assert.deepEqual(typed.store, ['Get Maps from the App Store'], `${skin}: the search finds Maps in the App Store (not the agent-only item, not Podcasts)`);
        assert.ok(typed.heads.includes('In the App Store'), `${skin}: an In the App Store section`);
        assert.deepEqual(idle.store, [], `${skin}: nothing from the Store before typing`);
        await p.press('.vc-pick .vc-q', 'Enter').catch(() => {});
        // Enter picks the first match; with no installed match that is the Store row, which opens its Store page
        await p.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.offsetParent !== null && /\/store\/index\.html\?app=wizard-maps/.test(f.src)), null, { timeout: 8000 });
        entry.opened = await p.evaluate(() => [...document.querySelectorAll('iframe')].map(f => f.src).find(s => /store\/index\.html\?app=/.test(s)).replace(location.origin, ''));
        assert.ok(!(await p.$('.vc-pick')), `${skin}: the picker closed`);
      }
      assert.deepEqual(errors, [], `${skin}: no page errors`);
      report.cases.push(entry);
      await ctx.close();
    }
    console.log(JSON.stringify(report, null, 1));
    console.log('ok: Add an app search finds App Store apps and opens their Store page');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
