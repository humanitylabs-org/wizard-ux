// wizard-ux issue 1734: on a phone, a swipe down on the Apps panel's grip (or on its app grid scrolled to the top)
// closes it, like Settings. Real phone shell at 412 px, real CDP touches, synthetic routes (never a live API).
// The panel is opened the way a person does: a swipe up from the orb. Two app lists: a few apps (the grid fits) and
// many (the grid opens scrolled to its bottom, next to Search). Checks too that a swipe down on a grid that is
// scrolled down only scrolls it, that an upward drag on the grid leaves the panel open, that a short slow nudge on the
// grip snaps back and that a tile tap still opens its app. QA_WEB=<main worktree>/web QA_EXPECT=broken shows main leaving the panel open.
// QA_OUT=<dir> saves screenshots.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead, seedOwner } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(process.env.QA_WEB || path.join(__dirname, '..', 'web')), out = process.env.QA_OUT || '';
const broken = process.env.QA_EXPECT === 'broken';
const ORIGIN = 'http://apps-sheet-swipe.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const appList = n => Array.from({ length: n }, (_, i) => ({ id: `qa-app-${i}`, name: `App ${i + 1}`, url: `/qa-app-${i}/`, kind: 'app', source: 'apps.json' }));
async function transport(ctx, APPS) {
  await ctx.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== ORIGIN) return r.abort();
    const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET') return json({});
    if (/\/v1\/setup$/.test(u.pathname)) return json({ first_run: false });
    if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, settings: {}, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/v1/apps') return json({ apps: APPS });
    if (u.pathname.includes('/store-data/')) return json({ results: [], installed: [], wam: [], shell: [], complete: true });
    if (/^\/qa-app-/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>app</title>' });
    const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html', f = path.resolve(web, rel);
    if (f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    return json(ownerRead(u.pathname));
  });
}
const shot = async (p, name) => { if (out) await p.screenshot({ path: path.join(out, name + '.png') }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// One finger from (x, y0) to (x, y1) in `steps` moves over `ms`.
async function swipe(cdp, x, y0, y1, steps = 12, ms = 180) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await sleep(ms / steps);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / steps, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const state = p => p.evaluate(() => ({ open: document.getElementById('launcher').classList.contains('open'), sheet: document.querySelector('#device, .device')?.dataset.sheet || null, scroll: document.getElementById('launcherBody').scrollTop, opened: [...document.querySelectorAll('iframe')].filter(f => /\/qa-app-/.test(f.src)).length }));
const box = (p, sel) => p.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom }; }, sel);
async function openFromOrb(p, cdp) {
  const opened = () => p.waitForFunction(() => document.getElementById('launcher').classList.contains('open'), null, { timeout: 3000 }).then(() => true, () => false);
  for (let i = 0; i < 2; i++) {
    const o = await box(p, '#orbWrap');
    await swipe(cdp, o.x, o.y, o.y - 320, 14, 260);
    if (await opened()) return p.waitForTimeout(600);
    console.error('orb swipe did not open Apps, trying once more'); await p.waitForTimeout(800);
  }
  throw new Error('a swipe up from the orb did not open Apps');
}
(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ headless: true }), seen = {};
  try {
    for (const [skin, count] of [['nebula', 6], ['nebula', 40], ['grove', 6], ['grove', 40]]) {
      const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
      await transport(ctx, appList(count)); await ctx.addInitScript(seedOwner, { phone: true });
      await ctx.addInitScript(skin => { if (window !== top) return; localStorage.setItem('wux.shell', 'phone'); localStorage.setItem('wos.shell', 'phone'); localStorage.setItem('wos.skin', skin); }, skin);
      const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), name = `${skin}-${count}`;
      await p.goto(`${ORIGIN}/wizard-os-home/index.html?phone`);
      await p.waitForFunction(() => document.documentElement.dataset.shell === 'phone' && window.__wos, null, { timeout: 20000 });
      await p.addStyleTag({ content: '#wosWelcome{display:none!important}' });
      await p.waitForFunction(() => window.WizConfig?.endpoint('apps'), null, { timeout: 8000 });
      await p.waitForTimeout(1000);
      const r = seen[name] = {};
      const reset = async () => { if ((await state(p)).open) { await p.evaluate(() => __wos.closeSheets(true)); await p.waitForTimeout(600); } };

      // 1. Swipe down on the grip closes the panel.
      await openFromOrb(p, cdp); await shot(p, `${name}-open`);
      r.openScroll = (await state(p)).scroll;
      const g = await box(p, '#launcher > .sheet-grip');
      await swipe(cdp, g.x, g.y, g.y + 260);
      await p.waitForTimeout(700); r.grip = await state(p); await shot(p, `${name}-after-grip-swipe`);

      // 2. Swipe down on the app grid: it scrolls up while it can, then the next swipe down closes the panel.
      await reset(); await openFromOrb(p, cdp);
      const grid = await box(p, '#launcherBody');
      r.grid = [];
      for (let i = 0; i < 6; i++) {
        await swipe(cdp, grid.x, grid.top + 100, grid.top + 420, 12, 200);
        await p.waitForTimeout(1200); const st = await state(p); r.grid.push(st);
        if (!st.open) break;
      }
      await shot(p, `${name}-after-grid-swipe`);

      if (!broken) {
        // 3. An upward drag on the grid at its top leaves the panel open.
        await reset(); await openFromOrb(p, cdp);
        await p.evaluate(() => { document.getElementById('launcherBody').scrollTop = 0; }); await p.waitForTimeout(200);
        await swipe(cdp, grid.x, grid.top + 300, grid.top + 150, 8, 200);
        await p.waitForTimeout(700); r.up = await state(p);
        // 4. A slow short nudge on the grip snaps back.
        await swipe(cdp, g.x, g.y, g.y + 40, 10, 900);
        await p.waitForTimeout(700); r.nudge = { ...(await state(p)), transform: await p.evaluate(() => document.getElementById('launcher').style.transform) };
        // 5. A tile tap still opens the app.
        await p.evaluate(() => document.querySelector('#launcherBody .lapp[data-app="qa-app-0"]').scrollIntoView({ block: 'center' }));
        await p.waitForTimeout(300);
        // (Chromium's touch emulation drops the click for any moved touch, also on main, so the tap-jitter slop is
        // covered by the unit test in settings-preview-windows.test.mjs.)
        await p.tap('#launcherBody .lapp[data-app="qa-app-0"]');
        await p.waitForTimeout(1000); r.tap = await state(p);
      }
      await ctx.close();
    }
    console.log(JSON.stringify(seen));
    for (const [name, r] of Object.entries(seen)) {
      const last = r.grid[r.grid.length - 1];
      if (broken) { assert.equal(r.grip.open, true, `${name}: main leaves Apps open after a grip swipe`); assert.equal(last.open, true, `${name}: and after grid swipes`); continue; }
      assert.equal(r.grip.open, false, `${name}: swipe down on the grip closes Apps`);
      assert.equal(last.open, false, `${name}: swipe down on the app grid closes Apps once it is at its top`);
      assert.ok(r.grid.every(s => s.opened === 0), `${name}: no grid swipe opened an app`);
      if (r.openScroll > 50) {
        assert.equal(r.grid[0].open, true, `${name}: a grid scrolled down only scrolls on the first swipe`);
        assert.ok(r.grid[0].scroll < r.openScroll, `${name}: and it scrolled up`);
        assert.ok(r.grid.slice(0, -1).every(s => s.open), `${name}: it stays open until the grid is at its top`);
      } else assert.equal(r.grid.length, 1, `${name}: a grid that fits closes on the first swipe`);
      assert.equal(r.up.open, true, `${name}: an upward drag leaves Apps open`);
      assert.equal(r.nudge.open, true, `${name}: a slow short nudge snaps back`);
      assert.equal(r.nudge.transform, '', `${name}: and the panel sits back in place`);
      assert.equal(r.tap.opened, 1, `${name}: a tile tap still opens its app`);
    }
    assert.ok(Object.values(seen).some(r => r.openScroll > 50), 'the 40-app grid opens scrolled down (the scroll case ran)');
    console.log(broken ? 'QA_EXPECT=broken: main leaves Apps open after a swipe down' : 'ok: swipe down on the grip or grid closes Apps');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
