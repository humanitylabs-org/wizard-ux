// Full-height Home layout (James, 12 Oct 2026): resources anchored near the dock, free height spread
// between the time block, attention rows and resources, no big blank band at the bottom.
// Usage: node qa-home-layout.cjs <home url> [webDirOverride]  (override serves the changed files from a local tree)
const pw = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const url = process.argv[2], dir = process.argv[3]; let pass = 0, fail = 0, writes = 0;
const ok = (v, n, d) => { console.log(v ? 'PASS' : 'FAIL', n, d ? JSON.stringify(d) : ''); v ? pass++ : fail++; };
const SIZES = [[360, 740], [390, 844], [412, 892]];
(async () => {
  const b = await pw.chromium.launch();
  for (const [w, h] of SIZES) for (const inset of [false, true]) {
    const c = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, serviceWorkers: 'block', ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36' });
    await c.addInitScript(() => localStorage.setItem('wos.coached', 'true'));
    const p = await c.newPage();
    await p.route('**/*', r => {
      const req = r.request(), u = new URL(req.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { writes++; return r.fulfill({ status: 204, body: '' }); }
      if (dir && u.pathname.startsWith('/wizard-os-home/')) {
        const f = path.join(dir, u.pathname.slice('/wizard-os-home/'.length));
        if (/\.(js|css)$/.test(f) && fs.existsSync(f)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(f) });
      }
      return r.continue();
    });
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    if (inset) await p.addStyleTag({ content: ':root{--safe-t:32px!important;--safe-b:24px!important}' });
    await p.waitForSelector('.home [data-home-resources] .rs-zone', { timeout: 30000 });
    await p.waitForTimeout(2500);
    const m = await p.evaluate(() => {
      const home = document.querySelector('.home'), rs = home.querySelector('[data-home-resources]'), dock = document.querySelector('.dock');
      const top = home.querySelector('.home-top').getBoundingClientRect(), cards = [...home.querySelectorAll('.now-card')].map(e => e.getBoundingClientRect());
      const R = rs.getBoundingClientRect(), D = dock.getBoundingClientRect(), H = home.getBoundingClientRect();
      const dockTop = Math.min(D.top, ...[...dock.children].map(e => e.getBoundingClientRect().top).filter(Number.isFinite));
      return { floorGap: Math.round(dockTop - R.bottom), rsBottomInHome: Math.round(H.bottom - R.bottom), topToCards: Math.round(cards[0].top - top.bottom),
        cardsToRes: Math.round(R.top - cards[cards.length - 1].bottom), cardH: cards.map(r => Math.round(r.height)), cardGap: Math.round(cards[1].top - cards[0].bottom),
        overflow: home.scrollHeight - home.clientHeight, chatsBg: getComputedStyle(document.documentElement).getPropertyValue('--glass') };
    });
    const tag = `${w}x${h}${inset ? ' insets' : ''}`, minCard = h <= 800 ? 64 : 68;
    ok(m.floorGap >= 18 && m.floorGap <= 48, `${tag}: resources sit just above the dock`, m);
    ok(m.rsBottomInHome <= 16, `${tag}: resources anchored to the Home floor (no blank band below)`);
    ok(m.topToCards >= 16 && m.cardsToRes >= 16, `${tag}: clear space time→attention and attention→resources`);
    ok(m.cardH.every(x => x >= minCard) && m.cardGap >= 14, `${tag}: roomy attention rows`);
    ok(m.overflow <= 1, `${tag}: no clipping or scroll needed`);
    if (w === 412 && h === 892) { ok(m.topToCards >= 60 && Math.abs(m.cardsToRes - m.topToCards) <= 12, `${tag}: tall phone spreads space evenly across bands`); await p.screenshot({ path: `home-layout-${w}${inset ? '-inset' : ''}.png` }); }
    if (w === 360) await p.screenshot({ path: `home-layout-${w}${inset ? '-inset' : ''}.png` });
    await c.close();
  }
  ok(writes === 0, 'Zero writes', { writes });
  console.log(`${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
