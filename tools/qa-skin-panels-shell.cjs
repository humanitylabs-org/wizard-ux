#!/usr/bin/env node
// In-shell skin-panel captures for the solid-panels proposal: the real phone/desktop shell from this checkout
// on Miguel's Obsidian and Landscapes plus inherited Nebula/Grove, skin chosen before boot.
// Records, per text-bearing panel, whether its interior changes over a loud sibling (see-through) instead of
// failing: James already ordered preserving Miguel's explicit skin overrides. Base defaults only;
// transparency is NOT a new owner decision. APIs answer empty; no network.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('./qa-playwright.cjs');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web');
const out = process.env.OUT || path.join(root, 'tmp', 'skin-panels-shell');
fs.mkdirSync(out, { recursive: true });
const ORIGIN = 'http://skin-panels.test';
const TYPES = { '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const SKINS = (process.env.QA_SKINS || 'obsidian,landscapes,nebula,grove').split(',');
const loud = Array.from({ length: 40 }, (_, i) => `<span style="color:${i % 2 ? '#ff00aa' : '#00ffcc'}">LOUD TEXT BEHIND ${i} </span>`).join('');
const webDigest = () => {
  const h = crypto.createHash('sha256');
  const walk = d => fs.readdirSync(d).sort().forEach(n => { const p = path.join(d, n); const s = fs.lstatSync(p);
    if (s.isDirectory()) walk(p); else if (s.isFile()) h.update(path.relative(web, p) + '\0').update(fs.readFileSync(p)); });
  walk(web); return h.digest('hex');
};
const PANELS = {
  phone: { settings: ['?shell=phone&view=settings', '#settings.open'], overview: ['?shell=phone', '#overview.open', () => window.__wos.openOverview()] },
  desktop: { settings: ['desktop.html?view=settings', '.win .settings-host'], palette: ['desktop.html', '.pal-card', () => window.__wux.openPalette()] },
};
async function seeThrough(page, sel) {
  const panel = page.locator(sel).first();
  await panel.waitFor({ state: 'visible', timeout: 20000 });
  await panel.evaluate((e, loud) => {
    const b = document.createElement('div'); b.id = 'qa-loud'; b.innerHTML = loud;
    b.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:900 26px/30px sans-serif;overflow:hidden';
    b.style.zIndex = String((Number(getComputedStyle(e).zIndex) || 1) - 1); e.before(b);
  }, loud);
  const box = await panel.boundingBox();
  const inset = Math.min(32, box.height / 5);
  const clip = { x: box.x + 32, y: box.y + inset, width: Math.max(8, box.width - 64), height: Math.max(8, box.height - inset * 2) };
  const over = await page.screenshot({ clip });
  await page.evaluate(() => document.querySelector('#qa-loud').remove());
  const bare = await page.screenshot({ clip });
  const material = await panel.evaluate(e => { const s = getComputedStyle(e); return { bg: s.backgroundColor, image: s.backgroundImage.slice(0, 160), blur: s.backdropFilter }; });
  return { opaque: over.equals(bare), material };
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text', '--disable-gpu'] });
  const rows = [];
  for (const shell of ['phone', 'desktop']) for (const skin of SKINS) for (const [name, [entry, sel, open]] of Object.entries(PANELS[shell])) {
    const ctx = await browser.newContext(shell === 'phone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } });
    await ctx.route('**/*', r => {
      const req = r.request(), u = new URL(req.url());
      if (u.origin !== ORIGIN) return r.abort();
      const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html';
      const f = path.resolve(web, rel);
      if (req.method() === 'GET' && f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile())
        return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      if (req.method() !== 'GET') return r.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(/\/sessions$/.test(u.pathname) ? { data: [], has_more: false } : {}) });
    });
    await ctx.addInitScript(({ shell, skin }) => {
      try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour', 'done'); localStorage.setItem('wos.tour.done', '1');
        localStorage.setItem('wux.shell', shell); localStorage.setItem('wos.skin', skin); } catch (_) {}
    }, { shell, skin });
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/wizard-os-home/${entry}`, { waitUntil: 'load' });
    await page.waitForFunction(([sh, sk]) => document.documentElement.dataset.shell === sh && document.documentElement.dataset.skin === sk, [shell, skin], { timeout: 30000 });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    if (open) await page.evaluate(open);
    await page.locator(sel).first().waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(1200); // package CSS and photo background settle
    await page.screenshot({ path: path.join(out, `${shell}-${skin}-${name}.png`) });
    rows.push({ shell, skin, panel: name, ...(await seeThrough(page, sel)) });
    await ctx.close();
  }
  await browser.close();
  const result = { captured: rows.length, see_through: rows.filter(r => !r.opaque).map(r => `${r.shell}/${r.skin}/${r.panel}`), web_sha256: webDigest(), rows };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ captured: rows.length, see_through: result.see_through, web_sha256: result.web_sha256, out }));
})().catch(e => { console.error(e); process.exitCode = 1; });
