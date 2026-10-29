// Default behavior (arrange/download tweak off): hold-and-release offers the sheet. Tweak-on QA: tools/qa-hold-arrange.cjs.
// Desks overview: hold a one-app desk and let go in place → Add to home screen sheet; hold and drag → reorder, no sheet.
// Native port is stubbed. Usage: node tools/qa-pin-desks.cjs http://127.0.0.1:PORT/wizard-os-home/ [skins]
const { chromium } = require('./qa-playwright.cjs');
const URL = process.argv[2]; const SKINS = (process.argv[3] || 'obsidian,landscapes').split(',');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  for (const skin of SKINS) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 WizardOS-Android/0.10.9' });
    await ctx.route('**/*', r => ['GET','HEAD','OPTIONS'].includes(r.request().method()) ? r.continue() : r.fulfill({status:405,body:'Read-only QA'}));
    await ctx.addInitScript(s => {
      try { localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.v1','true'); localStorage.setItem('wos.coached','true'); localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify({version:1,off:{miguel:['miguel/arrange-download']}})); } catch (_) {}
      window.wizardHomeScreenPort = { postMessage(raw) { const d = JSON.parse(raw); setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ requestId: d.requestId, status: 'ready' }) }), 10); } };
    }, skin);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/OVHOLD|OVEND/.test(m.text())) console.log(m.text()); });
    const cdp = await ctx.newCDPSession(p);
    const touch = async (x, y, ms, path = []) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await p.waitForTimeout(ms);
      for (const [px, py] of path) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py }] }); await p.waitForTimeout(30); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const overview = async () => {
      const o = await p.evaluate(() => { const b = document.querySelector('#orbWrap').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: o.x, y: o.y }] });
      for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: o.x, y: o.y - i * 25 }] }); await p.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(900);
    };
    await p.goto(URL); await p.waitForTimeout(3500); await p.getByText('Skip', { exact: true }).click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(400);
    const opened = []; // prefer installed app tiles (built-in shell tools like Setup are not pinnable)
    await p.evaluate(() => { window.PREF = ['wisdom', 'stories', 'messenger', 'reference', 'calendar', 'topics']; });
    for (let n = 0; n < 2; n++) { // two one-app desks
      await overview(); await p.click('#overview .ov-new').catch(() => {}); await p.waitForTimeout(1200);
      const c = await p.evaluate(skip => { const PREF = window.PREF; return [...document.querySelectorAll('.new-desk [data-app]')].map(r => { const b = r.getBoundingClientRect(); return { id: r.dataset.app, x: b.x + b.width / 2, y: b.y + b.height / 2, ok: b.width > 0 && b.y > 80 && b.y < innerHeight - 160 && b.x >= 0 && b.right <= innerWidth && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-app]') === r }; }).filter(c => c.ok && !skip.includes(c.id)).sort((a, b) => (PREF.indexOf(b.id) >>> 0) < (PREF.indexOf(a.id) >>> 0) ? 1 : -1)[0]; }, opened);
      if (!c) break; opened.push(c.id); await touch(c.x, c.y, 80); await p.waitForTimeout(1500);
    }
    await overview();
    const cards = () => p.evaluate(() => [...document.querySelectorAll('#overview .ov-card[data-ov]:not(.ov-home)')].map(c => { const b = c.getBoundingClientRect(); return { id: c.dataset.ov, label: c.getAttribute('aria-label') || '', x: b.x + b.width / 2, y: b.y + b.height / 2 }; }));
    let cs = await cards(); const mine = cs.filter(c => opened.some(id => c.label.toLowerCase().includes(id))); if (mine.length) cs = [...mine, ...cs.filter(c => !mine.includes(c))];
    if (cs.length < 2) { console.log(JSON.stringify({ skin, error: 'need two desks', opened, cards: cs.length })); fails++; await ctx.close(); continue; }
    await touch(cs[0].x, cs[0].y, 700); await p.waitForTimeout(500);
    const holdSheet = await p.evaluate(() => document.querySelector('.home-pin-sheet')?.textContent.trim().slice(0, 60) || '');
    const sheetOnTop = await p.evaluate(() => { const s = document.querySelector('.home-pin-sheet button'); if (!s) return false; const b = s.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === s; });
    const back = await p.evaluate(() => window.WizHomeScreenApps.back()); await p.waitForTimeout(400);
    const after = await p.evaluate(() => ({ sheet: !!document.querySelector('.home-pin-sheet'), ov: document.querySelector('#overview')?.classList.contains('open') }));
    if (!after.ov) await overview();
    cs = await cards(); const order0 = cs.map(c => c.id).join(',');
    const steps = []; for (let i = 1; i <= 10; i++) steps.push([cs[0].x + (cs[1].x - cs[0].x) * i / 10, cs[0].y + (cs[1].y - cs[0].y) * i / 10]);
    await touch(cs[0].x, cs[0].y, 600, steps); await p.waitForTimeout(600);
    const dragSheet = await p.evaluate(() => !!document.querySelector('.home-pin-sheet'));
    const order1 = (await cards()).map(c => c.id).join(',');
    const r = { skin, opened, holdSheet, sheetOnTop, back, afterBack: after, reordered: order0 !== order1, dragSheet, errs: errs.slice(0, 2) };
    console.log(JSON.stringify(r));
    if (!holdSheet || !sheetOnTop || after.sheet || !r.reordered || dragSheet || errs.length) fails++;
    await ctx.close();
  }
  await b.close(); console.log(fails ? 'FAIL ' + fails : 'PASS'); process.exit(fails ? 1 : 0);
})();
