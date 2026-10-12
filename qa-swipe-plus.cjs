// Real-touch regression: one swipe beyond the final occupied desk opens the app picker.
const { chromium } = require('playwright');
const fs = require('fs');
const url = process.argv[2];
const out = process.env.QA_OUT || 'qa-swipe-plus'; fs.mkdirSync(out, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, detail = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(detail)); };
(async () => {
  const browser = await chromium.launch();
  for (const width of [360, 393, 412]) for (const control of ['orb', 'dock']) {
    const ctx = await browser.newContext({ viewport: { width, height: 852 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
    const writes = []; const errors = [];
    await ctx.route('**/*', r => {
      const q = r.request();
      if (process.env.QA_APP && new URL(q.url()).pathname === '/wizard-os-home/app.js') return r.fulfill({ path: process.env.QA_APP, contentType: 'application/javascript' });
      if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
      return r.continue();
    });
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.goto(url); await p.waitForFunction(() => window.__wos?.desks); await p.waitForTimeout(1800);
    await p.evaluate(() => { WizCore.deeplink.route(location.pathname + '?open=wizard-music'); }); await p.waitForTimeout(800);
    await p.evaluate(() => __wos.goDesk(__wos.desks.length - 1, true)); await p.waitForTimeout(800);
    const state = () => p.evaluate(() => { const s = __wos, d = s.desks[s.idx], sec = document.querySelectorAll('.track > .desk')[s.idx], orb = document.querySelector('#orbWrap').getBoundingClientRect(); return { n: s.desks.length, idx: s.idx, wins: d.wins.length, picker: d.wins.length === 0 && !!sec?.querySelector('.new-desk'), tiles: sec?.querySelectorAll('.new-desk [data-app]').length || 0, plus: document.querySelectorAll('#dock [data-plus]').length, orbCentered: Math.abs(orb.x + orb.width / 2 - innerWidth / 2) < 2, transform: document.querySelector('.track').style.transform }; });
    const cdp = await ctx.newCDPSession(p);
    const swipe = async (direction, distance = 115, cancelled = false) => {
      const rect = await p.locator(control === 'orb' ? '#orbWrap' : '#dock').boundingBox();
      const x = control === 'orb' ? rect.x + rect.width / 2 : direction < 0 ? width - 30 : 30;
      const y = rect.y + rect.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let k = 1; k <= 8; k++) { await p.waitForTimeout(distance < 60 ? 70 : 20); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + direction * distance * k / 8, y, id: 1 }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: cancelled ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(900);
    };
    const tag = `${width} ${control}`; const before = await state();
    ok(before.plus === 1, `${tag}: occupied desk has one next plus destination`, before);
    await swipe(-1, 30); let s = await state(); ok(s.n === before.n && s.idx === before.idx, `${tag}: short drag stays on occupied desk`, s);
    await swipe(-1, 110, true); s = await state(); ok(s.n === before.n && s.idx === before.idx, `${tag}: cancelled swipe stays on occupied desk`, s);
    await swipe(-1); s = await state();
    ok(s.n === before.n + 1 && s.idx === before.n && s.picker && s.tiles >= 6, `${tag}: next swipe opens one app-selection desk`, s);
    if (s.picker) {
      ok(s.plus === 0 && s.orbCentered, `${tag}: orb occupies plus position, no extra plus and stays centred`, s);
      await p.screenshot({ path: `${out}/${width}-${control}-picker.png` });
      await swipe(-1); s = await state(); ok(s.n === before.n + 1 && s.idx === before.n, `${tag}: another swipe reuses picker`, s);
      ok(s.plus === 0, `${tag}: repeated end swipe does not create another plus`, s);
      await swipe(1); s = await state(); ok(s.n === before.n && s.idx === before.idx && !s.picker, `${tag}: reverse swipe removes unused picker and returns`, s);
      ok(s.plus === 1, `${tag}: leaving picker restores one plus destination`, s);
      await swipe(-1); s = await state();
      await p.locator('.track > .desk').nth(s.idx).locator('.new-desk [data-app="wisdom"]').tap(); await p.waitForTimeout(1200); s = await state();
      ok(s.n === before.n + 1 && s.idx === before.n && s.wins === 1 && !s.picker, `${tag}: app selection fills same desk`, s);
      ok(s.plus === 1, `${tag}: choosing an app restores one next plus destination`, s);
      await swipe(-1); s = await state(); ok(s.n === before.n + 2 && s.picker, `${tag}: next occupied desk can reach picker again`, s);
      ok(s.plus === 0 && s.orbCentered, `${tag}: next picker is again represented only by orb`, s);
      await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(800); s = await state();
      ok(s.idx === 0 && s.n === before.n + 1 && !!await p.locator('#dock').count(), `${tag}: Back returns Home, removes empty desk, keeps Wizard open`, s);
    }
    ok(!writes.some(u => /\/runs(?:\?|$)|\/steer(?:\?|$)/.test(u)), `${tag}: zero agent writes`, writes);
    ok(errors.length === 0, `${tag}: zero page errors`, errors);
    await ctx.close();
  }
  await browser.close(); console.log(JSON.stringify({ pass, fail })); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
