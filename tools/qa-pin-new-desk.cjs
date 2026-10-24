// Long-press a tile in the New desk grid (the app picker on Miguel's skins, where swipe up shows Desks)
// opens the Add to home screen sheet; Back closes it and leaves the grid. Native port is stubbed.
// Usage: node tools/qa-pin-new-desk.cjs http://127.0.0.1:PORT/wizard-os-home/ [skins]
const { chromium } = require('./qa-playwright.cjs');
const URL = process.argv[2]; const SKINS = (process.argv[3] || 'obsidian,landscapes,nebula').split(',');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  for (const skin of SKINS) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 WizardOS-Android/0.10.9' });
    await ctx.addInitScript(s => {
      try { if (s !== 'nebula') localStorage.setItem('wos.skin', s); } catch (_) {} // sandboxed app frames have no storage
      window.wizardHomeScreenPort = { postMessage(raw) { const d = JSON.parse(raw); setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ requestId: d.requestId, status: 'ready' }) }), 10); } };
    }, skin);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(3500); await p.getByText('Skip', { exact: true }).click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(400); // first-run tour covers the grid
    const plus = await p.$('#dock [data-plus]');
    if (plus) await plus.click().catch(() => {});
    else { // Miguel's skins: swipe up on the orb shows Desks; New desk opens the app picker
      const o = await p.evaluate(() => { const b = document.querySelector('#orbWrap').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      const s = await ctx.newCDPSession(p);
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: o.x, y: o.y }] });
      for (let i = 1; i <= 8; i++) { await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: o.x, y: o.y - i * 25 }] }); await p.waitForTimeout(16); }
      await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(900);
      await p.click('#overview .ov-new').catch(() => {});
    }
    await p.waitForTimeout(1200);
    const cands = await p.evaluate(() => [...document.querySelectorAll('.new-desk [data-app]')].map(r => { const b = r.getBoundingClientRect(); return { id: r.dataset.app, x: b.x + b.width / 2, y: b.y + b.height / 2, ok: b.width > 0 && b.y > 80 && b.y < innerHeight - 160 && b.x >= 0 && b.right <= innerWidth && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-app]') === r }; }).filter(c => c.ok && c.id !== 'app-store'));
    if (!cands.length) { console.log(JSON.stringify({ skin, error: 'no visible New desk tile', plus: !!plus })); fails++; await ctx.close(); continue; }
    let sheet = false, used = null; const cdp = await ctx.newCDPSession(p);
    for (const c of cands.slice(0, 14)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] }); await p.waitForTimeout(650);
      sheet = await p.evaluate(() => !!document.querySelector('.home-pin-sheet')); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(200);
      if (sheet) { used = c.id; break; }
    }
    const label = sheet ? await p.evaluate(() => document.querySelector('.home-pin-sheet').textContent.trim().slice(0, 80)) : '';
    let backClosed = null;
    if (sheet) { await p.evaluate(() => window.WizHomeScreenApps.back()); await p.waitForTimeout(400); backClosed = await p.evaluate(() => !document.querySelector('.home-pin-sheet') && !!document.querySelector('.new-desk')); }
    let tapOpened = null;
    if (sheet) {
      const c = cands.find(x => x.id === used); const before = await p.evaluate(() => document.querySelectorAll('.win').length);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] }); await p.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(1200);
      tapOpened = await p.evaluate(n => document.querySelectorAll('.win').length > n && !document.querySelector('.home-pin-sheet'), before);
    }
    console.log(JSON.stringify({ skin, tiles: cands.length, sheet, used, label, backClosed, tapOpened, errs: errs.slice(0, 2) }));
    if (!sheet || !backClosed || !tapOpened || errs.length) fails++;
    await ctx.close();
  }
  await b.close(); console.log(fails ? 'FAIL ' + fails : 'PASS'); process.exit(fails ? 1 : 0);
})();
