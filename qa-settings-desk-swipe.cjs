// Settings never blocks desk swipes (James, 21 Oct 2026): with Settings open on Home, a dock or orb swipe (or a dot
// tap) moves to the next desk; Settings stays open on Home and is there again, scroll kept, on the way back.
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require('playwright-core')); }
const fs = require('fs');
const url = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const out = process.env.QA_OUT || 'qa-settings-desk-swipe'; fs.mkdirSync(out, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, detail = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(detail)); };
(async () => {
  const browser = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  for (const width of [393, 412]) for (const control of ['dock', 'orb', 'dot']) {
    const ctx = await browser.newContext({ viewport: { width, height: 852 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tourDone', 'true'); });
    const writes = [], errors = [];
    await ctx.route('**/*', r => {
      const q = r.request();
      if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
      return r.continue();
    });
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.goto(url); await p.waitForFunction(() => window.__wos?.desks);
    // Let restored and synced desks settle (they can arrive a few seconds after boot) before the test begins.
    for (let last = -1, same = 0, k = 0; k < 20 && same < 3; k++) { await p.waitForTimeout(700); const n = await p.evaluate(() => __wos.desks.length); same = n === last ? same + 1 : 0; last = n; }
    await p.evaluate(() => { WizCore.deeplink.route(location.pathname + '?open=wizard-music'); }); await p.waitForTimeout(800);
    await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(800);
    const state = () => p.evaluate(() => {
      const s = __wos, st = document.querySelector('#settings').getBoundingClientRect(), dev = document.querySelector('#device');
      const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 3);
      return { idx: s.idx, n: s.desks.length, sheet: s.sheet, open: document.querySelector('#settings').classList.contains('open'),
        stX: Math.round(st.x), stVisible: st.right > 0 && st.x < innerWidth, blurred: dev.classList.contains('sheet-open'),
        scroll: document.querySelector('#settingsBody').scrollTop, hitSettings: !!hit?.closest('#settings'), hitScrim: !!hit?.closest('#scrim') };
    });
    const cdp = await ctx.newCDPSession(p);
    const swipe = async (direction, distance = 120) => {
      const rect = await p.locator(control === 'orb' ? '#orbWrap' : '#dock').boundingBox();
      const x = control === 'orb' ? rect.x + rect.width / 2 : direction < 0 ? width - 30 : 30, y = rect.y + rect.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let k = 1; k <= 8; k++) { await p.waitForTimeout(20); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + direction * distance * k / 8, y, id: 1 }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(900);
    };
    const move = async dir => {
      if (control !== 'dot') return swipe(dir);
      const target = await p.evaluate(d => __wos.idx + d, -dir);
      await p.locator(`#dock [data-goto="${target}"]`).tap(); await p.waitForTimeout(900);
    };
    const tag = `${width} ${control}`;
    await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(700);
    await p.locator('.track > .desk').nth(0).locator('.gear').tap(); await p.waitForTimeout(700);
    await p.evaluate(() => { document.querySelector('#settingsBody').scrollTop = 120; });
    let s = await state(); const scroll0 = s.scroll;
    ok(s.idx === 0 && s.sheet === 'settings' && s.open && s.stVisible, `${tag}: Settings opens on Home`, s);
    await p.screenshot({ path: `${out}/${width}-${control}-1-settings-home.png` });
    await move(-1); s = await state();
    ok(s.idx === 1, `${tag}: swipe with Settings open reaches the next desk`, s);
    ok(!s.sheet && !s.blurred && !s.stVisible && !s.hitSettings && !s.hitScrim, `${tag}: next desk is clear and usable`, s);
    await p.screenshot({ path: `${out}/${width}-${control}-2-next-desk.png` });
    await move(1); s = await state();
    ok(s.idx === 0 && s.sheet === 'settings' && s.open && s.stVisible && Math.abs(s.stX - 8) <= 2, `${tag}: Settings still open on Home after swiping back`, s);
    ok(s.scroll === scroll0, `${tag}: Settings keeps its scroll position`, { s, scroll0 });
    await p.screenshot({ path: `${out}/${width}-${control}-3-back-home.png` });
    // Back with Settings parked: the next desk's own Back runs (Settings never intercepts it there), Wizard stays open;
    // landing on Home shows Settings again, and Back there closes it.
    await move(-1);
    await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(900); s = await state();
    ok(!!(await p.locator('#dock').count()) && (s.idx === 0 ? s.sheet === 'settings' && s.stVisible : !s.blurred && !s.hitSettings), `${tag}: Back on the next desk is that desk's own; Settings shows only on Home`, s);
    await p.evaluate(() => __wos.goDesk(0)); await p.waitForTimeout(900); s = await state();
    ok(s.idx === 0 && s.sheet === 'settings' && s.stVisible, `${tag}: landing on Home shows Settings again`, s);
    await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(900); s = await state();
    ok(s.idx === 0 && !s.sheet && !s.open && !s.blurred && !!(await p.locator('#dock').count()), `${tag}: second Back closes Settings, Wizard open`, s);
    // Closed Settings stays closed across desks; reopening works normally.
    await move(-1); await move(1); s = await state();
    ok(s.idx === 0 && !s.sheet && !s.open, `${tag}: closed Settings does not reappear`, s);
    await p.locator('.track > .desk').nth(0).locator('.gear').tap(); await p.waitForTimeout(700); s = await state();
    ok(s.sheet === 'settings' && s.stVisible && Math.abs(s.stX - 8) <= 2, `${tag}: Settings reopens in place`, s);
    await p.locator('#settings [data-stclose]').tap(); await p.waitForTimeout(600); s = await state();
    ok(!s.sheet && !s.open, `${tag}: ✕ closes Settings`, s);
    ok(!writes.some(u => /\/runs(?:\?|$)|\/steer(?:\?|$)/.test(u)), `${tag}: zero agent writes`, writes);
    ok(errors.filter(e => !/frame-ancestors|localStorage' property/.test(e)).length === 0, `${tag}: zero page errors`, errors);
    await ctx.close();
  }
  await browser.close(); console.log(JSON.stringify({ pass, fail })); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
