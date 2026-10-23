// QA: every skin's New desk shows Miguel's app kinds (Apps first with system apps ringed, "For agents" folded).
// Usage: QA_BASE=http://127.0.0.1:<port> [QA_SHOTS=dir] node qa-new-desk-kinds.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:9371', SHOTS = process.env.QA_SHOTS || '';
const fails = [], ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
(async () => {
  const browser = await chromium.launch();
  for (const skin of ['nebula', 'grove', 'signal', 'obsidian', 'obsidian-light']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(s => { if (window !== top) return; try { localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.rvCoached', 'true'); } catch (_) {} }, skin);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + '/wizard-os-home/?myskin=off'); await p.waitForSelector('#orbWrap'); await p.waitForTimeout(2500);
    await p.evaluate(() => { const ov = window.__wos; ov.openOverview(); }); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('[data-ovadd]')?.click()); await p.waitForTimeout(700);
    const s = await p.evaluate(() => {
      const nd = window.__nd = [...document.querySelectorAll('.new-desk')].find(n => n.getBoundingClientRect().left >= 0 && n.getBoundingClientRect().left < innerWidth);
      if (!nd) return null;
      const sys = nd.querySelector('.kg-apps .lapp-sys .ic');
      const fa = nd.querySelector('.forag'), body = nd.querySelector('.forag .fa-body');
      return { kinds: nd.classList.contains('kinds'), first: nd.querySelector('.kg-apps h4')?.textContent, sysCount: nd.querySelectorAll('.kg-apps .lapp-sys').length,
        sysBorder: sys ? getComputedStyle(sys).borderTopWidth : null, folded: !!fa && getComputedStyle(body).display === 'none', faRow: fa ? getComputedStyle(fa.querySelector('.fa-row')).display : null,
        groups: [...nd.querySelectorAll('.lgroup h4')].map(h => h.textContent) };
    });
    ok(s && s.kinds && s.first === 'Apps', `${skin}: New desk uses app kinds (${JSON.stringify(s)})`);
    ok(s && s.sysCount > 0 && parseFloat(s.sysBorder) >= 2, `${skin}: system apps lead Apps with a ring`);
    ok(s && s.folded && s.faRow === 'flex', `${skin}: "For agents" row folded`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/newdesk-${skin}.png` });
    await p.evaluate(() => window.__nd?.querySelector('[data-fatoggle]')?.click()); await p.waitForTimeout(300);
    const open = await p.evaluate(() => { const b = window.__nd?.querySelector('.forag .fa-body'); return b && getComputedStyle(b).display !== 'none' ? [...b.querySelectorAll('h4')].map(h => h.textContent) : null; });
    ok(open && open.length > 0, `${skin}: tapping "For agents" shows ${JSON.stringify(open)}`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/newdesk-${skin}-open.png` });
    ok(!errs.length, `${skin}: no page errors ${errs.join(' | ').slice(0, 200)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `${fails.length} failed` : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
