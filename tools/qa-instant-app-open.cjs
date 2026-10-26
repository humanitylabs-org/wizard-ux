// Tapping an app on the Apps sheet or the New desk grid answers at once (James, 26 Oct 2026: "tapping an app like
// notes I get no UX response for a few seconds and tap it twice"). The app's page and its setup check are both
// slowed by 2.5 s; within 150 ms of the tap something must show it is opening, a second tap must not open a second
// copy, the window shows a loading veil until the page loads, and the veil lifts after.
// Usage: node tools/qa-instant-app-open.cjs http://127.0.0.1:PORT/wizard-os-home/ [skins] [app]
const { chromium } = require('./qa-playwright.cjs');
const URL = process.argv[2]; const SKINS = (process.argv[3] || 'nebula,obsidian').split(','); const WANT = process.argv[4] || 'notes';
const DELAY = 2500;
(async () => {
  const b = await chromium.launch(); let fails = 0;
  for (const skin of SKINS) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 WizardOS-Android/0.10.9' });
    await ctx.addInitScript(s => { try { if (s !== 'nebula') localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.coached', 'true'); } catch (_) {} }, skin);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    let needsHits = 0;
    await p.route('**/store-data/router/v1/needs/**', async r => { needsHits++; await new Promise(f => setTimeout(f, DELAY)); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [], ready_to_open: true }) }); });
    await p.goto(URL); await p.waitForTimeout(3500); await p.getByText('Skip', { exact: true }).click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(400);
    const cdp = await ctx.newCDPSession(p);
    const tap = async (x, y) => { await p.mouse.click(x, y); };
    const plus = await p.$('#dock [data-plus]'); let surface;
    if (plus) { await plus.click().catch(() => {}); surface = '#launcherBody'; }
    else {
      const o = await p.evaluate(() => { const b = document.querySelector('#orbWrap').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: o.x, y: o.y }] });
      for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: o.x, y: o.y - i * 25 }] }); await p.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(900);
      await p.click('#overview .ov-new').catch(() => {}); surface = '.new-desk';
    }
    await p.waitForTimeout(1200);
    const tile = await p.evaluate(([sel, want]) => {
      const vis = r => { const b = r.getBoundingClientRect(); return b.width > 0 && b.y > 60 && b.bottom < innerHeight - 100 && b.x >= 0 && b.right <= innerWidth && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-app]') === r; };
      const rows = [...document.querySelectorAll(`.lapp[data-app]`)].filter(vis);
      const r = rows.find(x => x.dataset.app === want) || rows.find(x => /notes|wisdom|stories|reference/.test(x.dataset.app)); if (!r) return null;
      const b = r.getBoundingClientRect(); return { id: r.dataset.app, x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, [surface, WANT]);
    if (!tile) { console.log(JSON.stringify({ skin, error: 'no visible app tile', surface })); fails++; await ctx.close(); continue; }
    const appUrl = await p.evaluate(id => { try { return window.WizCore.apps('mobile').APP[id]?.url || ''; } catch (_) { return ''; } }, tile.id);
    const prefix = new globalThis.URL(appUrl || `/${tile.id}/`, URL).pathname;
    await p.route(u => new globalThis.URL(u).pathname.startsWith(prefix), async r => { if (r.request().resourceType() === 'document') await new Promise(f => setTimeout(f, DELAY)); r.continue(); });
    const before = await p.evaluate(id => document.querySelectorAll(`.win`).length, tile.id);
    const feedback = () => p.evaluate(id => {
      const shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
      const t = document.querySelector('#toast');
      const tl = document.querySelector(`.lapp.opening[data-app="${id}"]`), sp = tl?.querySelector('.ic .open-spin'), sr = sp?.getBoundingClientRect(), ir = tl?.querySelector('.ic')?.getBoundingClientRect();
      return { tile: !!tl, spinOnIcon: !!sr && sr.width > 8 && sr.left >= ir.left && sr.right <= ir.right && sr.top >= ir.top && sr.bottom <= ir.bottom && getComputedStyle(tl).pointerEvents === 'none', toast: !!t?.classList.contains('show') && /Opening/.test(t.textContent),
        veil: [...document.querySelectorAll('.frame-loading')].some(shown), sheetClosing: !document.querySelector('.sheet.open, .launcher.open') };
    }, tile.id);
    await tap(tile.x, tile.y); await p.waitForTimeout(120);
    const at120 = await feedback();
    await p.waitForTimeout(200); await tap(tile.x, tile.y); // impatient second tap while it opens
    await p.waitForTimeout(700); const at1s = await feedback();
    await p.waitForTimeout(DELAY * 2 + 800); const after = await feedback();
    const wins = await p.evaluate(() => document.querySelectorAll('.win').length);
    const ownWins = await p.evaluate(id => [...document.querySelectorAll('.win iframe.appframe')].filter(f => f.dataset.ownApp === id).length, tile.id);
    // The answer must be on the icon the finger is on (James, 26 Oct: "spin on the icon they tapped itself"), or the app already up.
    const instant = at120.spinOnIcon || at120.veil;
    const holding = (at1s.spinOnIcon || at1s.veil) && !at1s.toast;
    const ok = instant && holding && ownWins === 1 && !after.veil && !after.toast && !after.tile && !errs.length;
    console.log(JSON.stringify({ skin, app: tile.id, surface, needsHits, at120, at1s, after, windowsBefore: before, windowsAfter: wins, ownWins, errs: errs.slice(0, 2), ok }));
    if (!ok) fails++;
    await ctx.close();
  }
  await b.close(); console.log(fails ? 'FAIL ' + fails : 'PASS'); process.exit(fails ? 1 : 0);
})();
