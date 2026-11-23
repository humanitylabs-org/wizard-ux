// wizard-ux issue 1735: on a phone, the Apps panel has a visible close button. Real phone shell at 412 px, real CDP
// touches, synthetic routes (never a live API). The panel is opened the way a person does: a swipe up from the orb.
// Checks: an X labelled "Close Apps" sits at the bottom right, in Search's footer row, a 50 x 50 circle the height of
// Search with an 8 px gap; a tap closes the panel and opens, moves or focuses nothing else; Search still works.
// QA_WEB=<main worktree>/web QA_EXPECT=broken shows main without the button. QA_OUT=<dir> saves screenshots.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead, seedOwner } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(process.env.QA_WEB || path.join(__dirname, '..', 'web')), out = process.env.QA_OUT || '';
const broken = process.env.QA_EXPECT === 'broken';
const ORIGIN = 'http://apps-close-button.test';
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
async function swipe(cdp, x, y0, y1, steps = 12, ms = 180) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await sleep(ms / steps);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / steps, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const state = p => p.evaluate(() => {
  const d = document.querySelector('#device, .device');
  return { open: document.getElementById('launcher').classList.contains('open'), sheet: d?.dataset.sheet || null,
    frames: [...document.querySelectorAll('iframe')].filter(f => /\/qa-app-/.test(f.src)).length,
    wins: Object.keys(window.__wos?.wins || {}).length, idx: window.__wos?.idx ?? null,
    focus: document.activeElement?.id || document.activeElement?.tagName || null,
    orb: (() => { const r = document.getElementById('orbWrap').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })() };
});
const rect = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, radius: cs.borderRadius, visible: cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(sel) === e }; }, sel);
async function openFromOrb(p, cdp) {
  const opened = () => p.waitForFunction(() => document.getElementById('launcher').classList.contains('open'), null, { timeout: 3000 }).then(() => true, () => false);
  for (let i = 0; i < 2; i++) {
    const o = await rect(p, '#orbWrap');
    await swipe(cdp, o.x, o.y, o.y - 320, 14, 260);
    if (await opened()) return p.waitForTimeout(700);
    console.error('orb swipe did not open Apps, trying once more'); await p.waitForTimeout(800);
  }
  throw new Error('a swipe up from the orb did not open Apps');
}
async function tap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const CLOSE = '#launcher [aria-label="Close Apps"]';
(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ headless: true }), seen = {};
  try {
    for (const [skin, count] of [['nebula', 6], ['nebula', 40], ['grove', 6], ['obsidian', 40], ['landscapes', 6]]) {
      const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
      await transport(ctx, appList(count)); await ctx.addInitScript(seedOwner, { phone: true });
      await ctx.addInitScript(skin => { if (window !== top) return; localStorage.setItem('wux.shell', 'phone'); localStorage.setItem('wos.shell', 'phone'); localStorage.setItem('wos.skin', skin); }, skin);
      const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), name = `${skin}-${count}`;
      const errors = []; p.on('pageerror', e => errors.push(String(e)));
      await p.goto(`${ORIGIN}/wizard-os-home/index.html?phone`);
      await p.waitForFunction(() => document.documentElement.dataset.shell === 'phone' && window.__wos, null, { timeout: 20000 });
      await p.addStyleTag({ content: '#wosWelcome{display:none!important}' });
      await p.waitForFunction(() => window.WizConfig?.endpoint('apps'), null, { timeout: 8000 });
      await p.waitForTimeout(1000);
      const r = seen[name] = {};
      const before = await state(p);
      await openFromOrb(p, cdp); await shot(p, `${name}-open`);
      r.close = await rect(p, CLOSE); r.search = await rect(p, '#searchForm'); r.panel = await rect(p, '#launcher');
      if (broken) { assert.equal(r.close, null, `${name}: main has no Close Apps button`); await ctx.close(); continue; }
      const c = r.close, s = r.search, pn = r.panel;
      assert.ok(c && c.visible, `${name}: a visible Close Apps button is in the Apps panel`);
      assert.ok(Math.abs(c.w - 50) <= 0.5 && Math.abs(c.h - 50) <= 0.5, `${name}: the button is 50 x 50 (${c.w} x ${c.h})`);
      assert.ok(/^(25px|50%|9999px|999px)$/.test(c.radius) || parseFloat(c.radius) >= 25, `${name}: the button is a circle (${c.radius})`);
      assert.ok(Math.abs(c.h - s.h) <= 0.5 && Math.abs(c.y - s.y) <= 0.5, `${name}: same height and row as Search (${c.h}/${s.h}, ${c.y}/${s.y})`);
      assert.ok(Math.abs(c.left - s.right - 8) <= 0.5, `${name}: 8 px gap after Search (${c.left - s.right})`);
      assert.ok(c.right <= pn.right - 8 && pn.right - c.right <= 16, `${name}: at the right edge of the panel (${pn.right - c.right} px in)`);
      assert.ok(pn.bottom - c.bottom <= 16 && c.bottom <= pn.bottom, `${name}: at the bottom of the panel (${pn.bottom - c.bottom} px up)`);
      assert.ok(s.w >= 250, `${name}: Search keeps its width (${s.w})`);
      // A tap closes the panel and nothing else changes.
      await tap(cdp, c.x, c.y);
      await p.waitForTimeout(800); r.after = await state(p); await shot(p, `${name}-after-close`);
      assert.equal(r.after.open, false, `${name}: tapping Close Apps closes the panel`);
      assert.equal(r.after.sheet, null, `${name}: no sheet left open`);
      assert.equal(r.after.frames, before.frames, `${name}: no app opened`);
      assert.equal(r.after.wins, before.wins, `${name}: no window opened or closed`);
      assert.equal(r.after.idx, before.idx, `${name}: still on the same desk`);
      assert.deepEqual(r.after.orb, before.orb, `${name}: the orb did not move`);
      assert.notEqual(r.after.focus, 'search', `${name}: Search not focused`);
      // With the keyboard up (Search typed into), the button still closes and leaves no typed command running.
      await openFromOrb(p, cdp);
      await p.focus('#search'); await p.keyboard.type('App 1');
      await p.waitForTimeout(300);
      const c2 = await rect(p, CLOSE); assert.ok(c2?.visible, `${name}: button visible while searching`);
      await tap(cdp, c2.x, c2.y); await p.waitForTimeout(800); r.afterSearch = await state(p);
      assert.equal(r.afterSearch.open, false, `${name}: closes while searching`);
      assert.equal(r.afterSearch.frames, before.frames, `${name}: no app opened from the search results`);
      // Search itself still works: typing and Go opens the selected app.
      await openFromOrb(p, cdp);
      await p.fill('#search', 'App 2'); await p.waitForTimeout(300); await p.press('#search', 'Enter'); await p.waitForTimeout(1200);
      r.go = await state(p);
      assert.equal(r.go.open, false, `${name}: Search Go still runs`);
      assert.deepEqual(errors, [], `${name}: no page errors`);
      await ctx.close();
    }
    console.log(JSON.stringify(seen, null, 1));
    console.log(broken ? 'baseline: no Close Apps button on main' : 'ok: Close Apps button closes the Apps panel');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
