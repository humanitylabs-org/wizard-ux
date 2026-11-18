'use strict';
// Desktop tiles follow a native window resize (ux#1478, ux#1541), in a real browser. In the Mac app's WKWebView the
// window `resize` event can arrive BEFORE the stage has its new bounds. This replays that order: the stage is held at
// its old width, the viewport shrinks (the resize event lays out against the old bounds), then the stage is let go with
// no further window event. The tile must still end inside the new stage, and tiles must jump (no geometry transition)
// while a resize is under way. Synthetic origin; every write is refused. QA_EXPECT=broken for main (the tile stays wide).
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..'), prefix = '/wizard-os-home/', origin = 'https://resize.test';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'native-resize-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const errors = [], writes = [];
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
    await context.routeWebSocket('**/*', ws => ws.close());
    await context.addInitScript(() => {
      if (window !== top) return;
      for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true',
        'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
    });
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url());
      if (u.origin !== origin) return r.abort();
      if (u.pathname.includes('/v1/runs')) return r.abort();
      if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: { error: 'QA refuses all writes' } }); }
      if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
      if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
      if (u.pathname.startsWith(prefix)) {
        const f = decodeURIComponent(u.pathname.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
        if (abs.startsWith(web + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
      }
      if (q.resourceType() === 'document') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>QA app</title><h1>Synthetic app</h1>' });
      return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
    });
    page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + prefix + 'desktop.html');
    await page.waitForFunction(() => window.__wux && document.querySelector('#stage') && !window.WosWelcome?.active);
    // one tile on the current desk, Home closed
    await page.evaluate(() => {
      const u = __wux; window.WosTour?.desk?.finish?.('skip'); u.closePalette?.();
      if (!u.ws[u.cur].wins.length) u.newWin({ app: 'frame', appId: 'qa', url: '/wizard-os-home/qa-app.html', title: 'QA app' });
      u.closePalette?.(); if (u.homeOpen) u.closeHome?.() ?? u.goWs?.(u.cur);
    });
    await page.waitForFunction(() => { const w = [...document.querySelectorAll('.win')].find(n => !n.classList.contains('gone') && n.getClientRects().length); return w && w.offsetWidth > 0; });
    await page.waitForTimeout(500);
    const measure = () => page.evaluate(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const w = [...document.querySelectorAll('.win')].find(n => !n.classList.contains('gone') && n.getClientRects().length).getBoundingClientRect();
      return { stage: Math.round(stage.width), left: Math.round(w.left - stage.left), right: Math.round(w.right - stage.left), width: Math.round(w.width) };
    });
    const before = await measure();
    console.log('before', JSON.stringify(before));
    assert.ok(before.right <= before.stage, 'tile starts inside the stage');
    // WKWebView order: hold the stage at its old size, shrink the window (resize fires against the old bounds) ...
    await page.evaluate(w => { const s = document.querySelector('#stage'); s.style.right = 'auto'; s.style.width = w + 'px'; }, before.stage);
    await page.setViewportSize({ width: 820, height: 640 });
    await page.waitForTimeout(250);
    const during = await measure();
    console.log('resize event, old stage bounds', JSON.stringify(during));
    // ... then the stage gets its new bounds later, with no window event of its own.
    const transition = await page.evaluate(() => {
      const s = document.querySelector('#stage'); s.style.right = ''; s.style.width = '';
      return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
        const w = [...document.querySelectorAll('.win')].find(n => !n.classList.contains('gone') && n.getClientRects().length);
        r({ resizing: document.body.classList.contains('desktop-resizing'), props: getComputedStyle(w).transitionProperty });
      })));
    });
    await page.waitForTimeout(600);
    const after = await measure();
    console.log('stage bounds changed later', JSON.stringify(after), JSON.stringify(transition));
    await page.screenshot({ path: path.join(out, 'after-delayed-stage-resize.png') });
    const fits = after.stage < before.stage && after.right <= after.stage && after.left >= 0 && after.width < before.width;
    const jumps = transition.resizing && !/\b(width|left|top|height)\b/.test(transition.props);
    if (broken) {
      assert.ok(!fits || !jumps, 'main is expected to leave the tile at the old size or animate it');
      console.log('PASS broken baseline: fits', fits, 'jumps', jumps);
    } else {
      assert.ok(fits, `tile fits the new stage after a late stage resize: ${JSON.stringify(after)}`);
      assert.ok(jumps, `tile geometry does not animate while resizing: ${JSON.stringify(transition)}`);
      assert.equal(await page.evaluate(() => document.body.classList.contains('desktop-resizing')), false, 'resizing mark clears once settled');
      console.log('PASS tiles follow a delayed stage resize');
    }
    assert.deepEqual(writes, [], 'no owner writes');
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
