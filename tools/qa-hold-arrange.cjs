// Arrange/download tweak: hold = arrange (drag, ✕ to close), a download button beside ✕ opens Add to home screen. Trusted CDP touch on phone 402x874.
// Usage: node tools/qa-hold-arrange.cjs <base ending /wizard-os-home/> <outdir> [skins]   (read-only: non-GET requests are blocked)
const { chromium } = require('./qa-playwright.cjs');
const fs = require('fs');
const BASE = process.argv[2], OUT = process.argv[3], SKINS = (process.argv[4] || 'landscapes,obsidian,obsidian-light').split(',');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: process.env.HRR ? ['--host-resolver-rules=' + process.env.HRR] : [] });
  const results = []; let fails = 0;
  for (const skin of SKINS) {
    const r = { skin, checks: {} }; const ok = (k, v, extra) => { r.checks[k] = extra === undefined ? !!v : { ok: !!v, ...extra }; if (!v) fails++; };
    const ctx = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin }).catch(() => {});
    // Read-only QA: block every non-read request.
    await ctx.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript(s => { try { if (!sessionStorage.getItem('qa.init')) { localStorage.clear(); sessionStorage.setItem('qa.init', '1'); } localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.coached', 'true'); } catch (_) {} }, skin);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p);
    const touch = async (x, y, ms, path = []) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await p.waitForTimeout(ms);
      for (const [px, py] of path) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py }] }); await p.waitForTimeout(30); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const center = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; }, sel);
    const swipeUp = async () => { const o = await center('#orbWrap'); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: o.x, y: o.y }] }); for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: o.x, y: o.y - i * 25 }] }); await p.waitForTimeout(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(900); };
    await p.goto(BASE); await p.waitForFunction(() => window.__wos && window.WizHomeScreenApps && window.WizCore?.apps, null, { timeout: 20000 }); await p.waitForTimeout(3500);
    // Two one-app desks of registered frontends + one two-window desk.
    const picks = await p.evaluate(() => { const { APP } = window.WizCore.apps(); return Object.values(APP).filter(a => window.WizHomeScreenApps.canOffer(a) && !a.system && a.source === 'apps.json').map(a => ({ id: a.id, url: a.url, name: a.name })).slice(0, 4); });
    r.picks = picks.map(a => a.id);
    if (picks.length < 4) { ok('enough apps', false, { picks }); results.push(r); await ctx.close(); continue; }
    for (const a of picks) { await p.evaluate(id => window.__wos.openApp(window.WizCore.apps().APP[id]), a.id); await p.waitForTimeout(900); }
    // Merge the last two into one desk (multi-app desk must get no download button).
    await p.evaluate(() => { const ds = window.__wos.desks; window.__wos.mergeDesks(ds[ds.length - 2].id, ds[ds.length - 1].id); });
    await p.waitForTimeout(600); await p.evaluate(() => window.__wos.goDesk(0)); await p.waitForTimeout(600);
    await swipeUp();
    let ovOpen = await p.evaluate(() => document.querySelector('#overview')?.classList.contains('open'));
    if (!ovOpen) { await p.evaluate(() => window.__wos.openOverview('pill')); await p.waitForTimeout(800); r.openedVia = 'api'; } else r.openedVia = 'swipe';
    const state = () => p.evaluate(() => {
      const ov = document.querySelector('#overview'), vis = e => { if (!e) return false; const cs = getComputedStyle(e), b = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
      const cards = [...ov.querySelectorAll('.ov-card[data-ov]:not(.ghost)')].map(c => { const d = window.__wos.desks.find(x => x.id === c.dataset.ov), x = c.querySelector('.ov-x'), dl = c.querySelector('.ov-dl');
        const hit = dl && (() => { const s = getComputedStyle(dl, '::before'); return { w: parseFloat(s.width), h: parseFloat(s.height) }; })();
        const db = dl?.getBoundingClientRect(), xb = x?.getBoundingClientRect();
        return { id: c.dataset.ov, home: !!d?.home, wins: d?.wins.length || 0, x: vis(x), dl: vis(dl), dlLabel: dl?.getAttribute('aria-label') || '', hit, dlBox: db && { x: db.x + db.width / 2, y: db.y + db.height / 2, w: db.width }, xBox: xb && { x: xb.x + xb.width / 2, y: xb.y + xb.height / 2, w: xb.width } }; });
      const cb = c => { const e = ov.querySelector(`.ov-card[data-ov="${c}"]`).getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; };
      return { open: ov.classList.contains('open'), pill: ov.classList.contains('ov-pill'), editing: ov.classList.contains('editing'), sheet: !!document.querySelector('.home-pin-backdrop'), cards: cards.map(c => ({ ...c, at: cb(c.id) })) };
    });
    let s0 = await state();
    ok('overview open', s0.open, { via: r.openedVia, pill: s0.pill });
    ok('no ✕/download before hold', !s0.editing && s0.cards.every(c => !c.dl), { editing: s0.editing });
    const one = s0.cards.find(c => !c.home && c.wins === 1), multi = s0.cards.find(c => c.wins > 1);
    // 1) Hold in place → arrange mode, no sheet.
    await touch(one.at.x, one.at.y, 700); await p.waitForTimeout(500);
    let s1 = await state();
    ok('hold → arrange (editing), no sheet', s1.editing && !s1.sheet && s1.open, { editing: s1.editing, sheet: s1.sheet });
    const c1 = s1.cards.find(c => c.id === one.id), m1 = s1.cards.find(c => c.id === multi.id);
    ok('one-app desk: ✕ and download visible', c1.x && c1.dl, { label: c1.dlLabel, hit: c1.hit, dlBox: c1.dlBox, xBox: c1.xBox });
    ok('download label "Add <App> to home screen"', /^Add .+ to home screen$/.test(c1.dlLabel), { label: c1.dlLabel });
    ok('download touch target ≥44px', c1.hit && c1.hit.w >= 44 && c1.hit.h >= 44, { hit: c1.hit });
    ok('multi-app desk: ✕ but no download', m1.x && !m1.dl);
    ok('Home: no ✕/download', s1.cards.filter(c => c.home).every(c => !c.x && !c.dl));
    await p.screenshot({ path: `${OUT}/${skin}-arrange.png` });
    // 2) Drag reorder still works.
    const order0 = s1.cards.filter(c => !c.home).map(c => c.id).join(',');
    const a0 = s1.cards.filter(c => !c.home)[0], a1 = s1.cards.filter(c => !c.home)[1];
    const steps = []; for (let i = 1; i <= 10; i++) steps.push([a0.at.x + (a1.at.x - a0.at.x) * i / 10, a0.at.y + (a1.at.y - a0.at.y) * i / 10]);
    await touch(a0.at.x, a0.at.y, 600, steps); await p.waitForTimeout(600);
    let s2 = await state(); const order1 = s2.cards.filter(c => !c.home).map(c => c.id).join(',');
    ok('drag reorders, no sheet', order0 !== order1 && !s2.sheet, { order0, order1 });
    if (!s2.editing) { const c = s2.cards.find(c => c.id === one.id); await touch(c.at.x, c.at.y, 700); await p.waitForTimeout(500); s2 = await state(); }
    // 3) Download opens the guide with the direct registered app URL; does not close or drag.
    const c2 = s2.cards.find(c => c.id === one.id); const deskApp = await p.evaluate(id => { const d = window.__wos.desks.find(x => x.id === id), w = window.__wos.wins[d.wins[0]]; return window.WizCore.apps().APP[w.appId]; }, one.id);
    const desksBefore = await p.evaluate(() => window.__wos.desks.length);
    await touch(c2.dlBox.x, c2.dlBox.y, 60); await p.waitForTimeout(700);
    const g = await p.evaluate(() => { const s = document.querySelector('.home-pin-sheet'); return s && { guide: s.classList.contains('home-pin-guide'), link: s.querySelector('textarea')?.value || '', text: s.textContent.replace(/\s+/g, ' ').slice(0, 220), copy: !![...s.querySelectorAll('button')].find(x => x.textContent === 'Copy link') }; });
    const want = new URL(deskApp.url, new URL(BASE).origin).href;
    ok('download → two-step guide with direct app URL', g && g.guide && g.link === want && g.copy && /Safari/.test(g.text), { guide: g, want });
    ok('download did not close desk or drag', (await p.evaluate(() => window.__wos.desks.length)) === desksBefore && !(await p.evaluate(() => document.querySelector('#overview .drag'))));
    await p.screenshot({ path: `${OUT}/${skin}-guide.png` });
    // Copy link with real clipboard readback.
    const copyAt = await p.evaluate(() => { const bt = [...document.querySelectorAll('.home-pin-sheet button')].find(x => x.textContent === 'Copy link'); const bb = bt.getBoundingClientRect(); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; });
    await touch(copyAt.x, copyAt.y, 60); await p.waitForTimeout(500);
    const clip = await p.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e.message));
    ok('Copy link writes the direct URL', clip === want, { clip });
    await p.evaluate(() => window.WizHomeScreenApps.back()); await p.waitForTimeout(400);
    // 4) ✕ closes the desk.
    let s3 = await state(); if (!s3.editing) { const c = s3.cards.find(c => c.id === one.id); await touch(c.at.x, c.at.y, 700); await p.waitForTimeout(500); s3 = await state(); }
    const c3 = s3.cards.find(c => c.id === one.id); const n0 = await p.evaluate(() => window.__wos.desks.length);
    await touch(c3.xBox.x, c3.xBox.y, 60); await p.waitForTimeout(700);
    const gone = await p.evaluate(id => !window.__wos.desks.some(d => d.id === id), one.id);
    ok('✕ closes the desk', gone && (await p.evaluate(() => window.__wos.desks.length)) === n0 - 1 && !(await p.evaluate(() => !!document.querySelector('.home-pin-backdrop'))));
    // 5) Classic (non-pill) Desks overview: same arrange mode + download.
    await p.evaluate(() => { window.__wos.closeOverview(); window.__wos.openOverview(); }); await p.waitForTimeout(700);
    let s4 = await state(); const one4 = s4.cards.find(c => !c.home && c.wins === 1);
    if (one4) { await touch(one4.at.x, one4.at.y, 700); await p.waitForTimeout(500); const s5 = await state(); const c5 = s5.cards.find(c => c.id === one4.id);
      ok('classic Desks: hold → arrange with ✕+download, no sheet', s5.editing && !s5.sheet && c5.x && c5.dl, { pill: s5.pill, dlBox: c5.dlBox, xBox: c5.xBox });
      await p.screenshot({ path: `${OUT}/${skin}-classic-arrange.png` }); }
    await p.evaluate(() => window.__wos.closeOverview()); await p.waitForTimeout(400);
    // 6) New desk grid: hold a tile → no sheet (and the tap after it doesn't open the app).
    await p.evaluate(() => { window.__wos.openOverview('pill'); }); await p.waitForTimeout(600);
    const add = await center('#overview [data-ovadd]'); if (add) { await touch(add.x, add.y, 60); await p.waitForTimeout(1200); }
    const tile = await p.evaluate(() => { const t = [...document.querySelectorAll('.new-desk [data-app]')].find(r => { const b = r.getBoundingClientRect(); return b.width > 0 && b.y > 80 && b.y < innerHeight - 160 && window.WizHomeScreenApps.canOffer(window.WizCore.apps().APP[r.dataset.app]); }); if (!t) return null; const b = t.getBoundingClientRect(); return { id: t.dataset.app, x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    if (tile) { await touch(tile.x, tile.y, 800); await p.waitForTimeout(600); ok('New desk grid: hold opens no sheet', !(await p.evaluate(() => !!document.querySelector('.home-pin-backdrop'))), { tile: tile.id }); }
    else ok('New desk grid tile found', false);
    ok('no page errors', errs.length === 0, { errs: errs.slice(0, 3) });
    results.push(r); await ctx.close();
  }
  // Desktop parity probe: no hold-to-sheet surfaces and module still loaded.
  const dctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true }); await dctx.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 204, body: '' }));
  await dctx.addInitScript(() => { localStorage.setItem('wos.skin', 'obsidian'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.coached', 'true'); });
  const dp = await dctx.newPage(); const derrs = []; dp.on('pageerror', e => derrs.push(e.message)); await dp.goto(BASE + 'desktop.html'); await dp.waitForTimeout(4000);
  const desk = { errs: derrs.slice(0, 3), dl: await dp.evaluate(() => document.querySelectorAll('.ov-dl').length), mine: await dp.evaluate(() => document.documentElement.dataset.mine != null) };
  results.push({ desktop: desk }); if (derrs.length) fails++;
  await b.close();
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1)); console.log(fails ? 'FAIL ' + fails : 'PASS'); process.exit(fails ? 1 : 0);
})();
