// QA (James, 10 Oct: "when I open the apps manager it refreshes every 10 seconds"): the Apps sheet (launcher)
// must stay still while it is open. Live-session polls (every 15 s) used to rebuild its whole body and yank the
// scroll to the bottom. Checks: opening still lands at the bottom (nearest the thumb); live refreshes with
// unchanged content do not touch the DOM; a live refresh never moves the scroll; typing a search still repaints;
// one real 15 s poll passes with zero repaints. Real Wizard reads through qa-origin; every write intercepted.
// Usage: node qa-launcher-still.cjs [base=http://127.0.0.1:9381/wizard-os-home/]
const { chromium } = require('/home/developer/node_modules/playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  const writes = [];
  await ctx.route('**/*', r => { const q = r.request(); if (['GET', 'HEAD'].includes(q.method())) return r.continue(); writes.push(q.url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(BASE + '?open=apps', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.WizLive && window.WizLive.ok, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const open = await p.evaluate(() => {
    if (window.__wos.sheet !== 'launcher') window.__wos.openSheet('launcher');
    const body = document.querySelector('#launcherBody');
    return { sheet: window.__wos.sheet, atBottom: Math.abs(body.scrollTop + body.clientHeight - body.scrollHeight) < 4, scrollable: body.scrollHeight > body.clientHeight + 20, tiles: body.querySelectorAll('.lapp').length };
  });
  ok(open.sheet === 'launcher' && open.tiles > 3, 'Apps sheet opens with app tiles', JSON.stringify(open));
  ok(open.atBottom, 'Apps sheet opens scrolled to the bottom (nearest the thumb)', JSON.stringify(open));

  // Scroll to the top like James reading the list, then fire live refreshes.
  const still = await p.evaluate(async () => {
    const body = document.querySelector('#launcherBody');
    body.scrollTop = 0; const first = body.firstElementChild;
    let muts = 0; const mo = new MutationObserver(ms => { muts += ms.length; }); mo.observe(body, { childList: true, subtree: true, characterData: true, attributes: true });
    for (let i = 0; i < 5; i++) { window.WizLive.emit(); await new Promise(r => setTimeout(r, 120)); }
    await window.WizLive.refresh?.(); await new Promise(r => setTimeout(r, 400));
    mo.disconnect();
    return { muts, top: body.scrollTop, same: body.firstElementChild === first };
  });
  ok(still.muts === 0 && still.same, 'live refreshes with unchanged content leave the sheet untouched', JSON.stringify(still));
  ok(still.top === 0, 'live refresh keeps the scroll where James left it', JSON.stringify(still));

  // A live refresh that DOES change content (a new Recent app) repaints in place without moving the scroll.
  const changed = await p.evaluate(async () => {
    const body = document.querySelector('#launcherBody'); body.scrollTop = 40; const top = body.scrollTop;
    const ids = [...document.querySelectorAll('#launcherBody .lapp')].map(x => x.dataset.app);
    const r = JSON.parse(localStorage.getItem('wos.recent') || '[]'); const pick = ids.find(id => !r.slice(0, 4).includes(id));
    localStorage.setItem('wos.recent', JSON.stringify([pick, ...r]));
    window.WizLive.emit(); await new Promise(r => setTimeout(r, 150));
    return { pick, top, now: body.scrollTop, firstRecent: body.querySelector('.lgroup .lapp')?.dataset.app };
  });
  ok(changed.firstRecent === changed.pick, 'changed content still repaints (new Recent app shows)', JSON.stringify(changed));
  ok(changed.now === changed.top, 'repaint from a live change keeps the scroll', JSON.stringify(changed));

  // Typing a search still repaints.
  await p.fill('#search', 'mus');
  const typed = await p.evaluate(() => [...document.querySelectorAll('#launcherBody .lrow')].map(x => x.textContent).join('|'));
  ok(/Command/.test(await p.evaluate(() => document.querySelector('#launcherBody').textContent)) && typed.length > 0, 'typing a search repaints the sheet', typed.slice(0, 120));
  const searchStill = await p.evaluate(async () => {
    const body = document.querySelector('#launcherBody'); const first = body.firstElementChild;
    for (let i = 0; i < 3; i++) { window.WizLive.emit(); await new Promise(r => setTimeout(r, 100)); }
    return body.firstElementChild === first;
  });
  ok(searchStill, 'search results stay still across live refreshes');
  await p.fill('#search', '');

  // James, 11 Oct: "searched wisdom and it didn't pop up". The sheet is bottom-anchored, so with the keyboard up
  // (sheet ~300 px) the best app match must sit right above the search bar, in view, and be the Enter pick.
  await p.setViewportSize({ width: 412, height: 520 });
  await p.fill('#search', 'wisdom'); await p.waitForTimeout(300);
  const kb = await p.evaluate(() => {
    const body = document.querySelector('#launcherBody'), br = body.getBoundingClientRect();
    const rows = [...body.querySelectorAll('.lrow')]; const last = rows[rows.length - 1];
    const w = body.querySelector('.lrow[data-app="wisdom"]'); const r = w && w.getBoundingClientRect();
    return { last: last?.dataset.app || last?.dataset.cmd || '', sel: body.querySelector('.lrow.sel')?.dataset.app || '',
      visible: !!r && r.top >= br.top - 1 && r.bottom <= br.bottom + 1, h: Math.round(br.height) };
  });
  ok(kb.last === 'wisdom' && kb.visible, 'keyboard up: "wisdom" shows the Wisdom app right above the search bar', JSON.stringify(kb));
  ok(kb.sel === 'wisdom', 'keyboard up: Wisdom is the Enter pick', JSON.stringify(kb));
  await p.fill('#search', ''); await p.setViewportSize({ width: 412, height: 892 });

  // One real poll cycle (15 s) with the sheet open: no repaint.
  const real = await p.evaluate(async () => {
    const body = document.querySelector('#launcherBody'); body.scrollTop = 0; let n = 0, e = 0;
    const off = window.WizLive.onChange(() => e++);
    const mo = new MutationObserver(ms => { if (ms.some(m => m.target === body)) n++; }); mo.observe(body, { childList: true });
    await new Promise(r => setTimeout(r, 17000)); mo.disconnect(); off();
    return { repaints: n, emits: e, top: body.scrollTop };
  });
  ok(real.emits >= 1, 'a real live poll ran while the sheet was open', JSON.stringify(real));
  ok(real.repaints === 0 && real.top === 0, 'no repaint and no scroll jump across a real poll', JSON.stringify(real));
  ok(!errs.length, 'no page errors', errs.join(' | ').slice(0, 300));
  ok(!writes.some(u => /\/v1\/runs/.test(u)), 'no agent runs started');
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
