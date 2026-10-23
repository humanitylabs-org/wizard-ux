// QA: New desk search bar (bottom centre, above the dock) filters apps live; Enter opens the first match.
// Usage: QA_BASE=http://127.0.0.1:<port> [QA_SHOTS=dir] node qa-new-desk-search.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:9371', SHOTS = process.env.QA_SHOTS || '';
const fails = [], ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
(async () => {
  const browser = await chromium.launch();
  for (const skin of ['nebula', 'grove', 'obsidian']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(s => { if (window !== top) return; try { localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.rvCoached', 'true'); localStorage.setItem('wos.obsidian.live', 'true'); } catch (_) {} }, skin);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + '/wizard-os-home/?myskin=off'); await p.waitForSelector('#orbWrap'); await p.waitForTimeout(2500);
    await p.evaluate(() => __wos.openOverview()); await p.waitForTimeout(300); await p.evaluate(() => document.querySelector('[data-ovadd]')?.click());
    await p.waitForFunction(() => [...document.querySelectorAll('.nd-search')].some(n => { const r = n.getBoundingClientRect(); return r.width && Math.abs(r.left + r.width / 2 - innerWidth / 2) < 3; }), null, { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(400);
    const geo = await p.evaluate(() => {
      const f = [...document.querySelectorAll('.nd-search')].find(n => { const r = n.getBoundingClientRect(); return r.width && r.left >= 0 && r.left < innerWidth; });
      if (!f) return null; window.__ndf = f; const r = f.getBoundingClientRect(); const dock = document.querySelector('.dock')?.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { cx: Math.round(r.left + r.width / 2), bottom: Math.round(r.bottom), dockTop: dock ? Math.round(dock.top) : null, onTop: !!hit && f.contains(hit), W: innerWidth };
    });
    ok(geo && Math.abs(geo.cx - geo.W / 2) < 4 && geo.onTop && (geo.dockTop == null || geo.bottom <= geo.dockTop + 10), `${skin}: search pill bottom centre, above the dock, tappable ${JSON.stringify(geo)}`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/search-${skin}.png` });
    // Pick a real app name from the visible tiles, type its first letters.
    const target = await p.evaluate(() => { const nd = window.__ndf.closest('.glance').querySelector('.new-desk'); const t = [...nd.querySelectorAll('.kg-apps .lapp[data-app]')].filter(x => x.dataset.app !== 'app-store' && !x.classList.contains('lapp-sys')).at(-1); return { id: t.dataset.app, name: t.querySelector('.nm').textContent, total: nd.querySelectorAll('.lapp').length }; });
    const q = target.name.slice(0, 4);
    await p.evaluate(() => window.__ndf.querySelector('input').focus()); await p.keyboard.type(q); await p.waitForTimeout(300);
    const f1 = await p.evaluate(() => { const nd = window.__ndf.closest('.glance').querySelector('.new-desk'); return [...nd.querySelectorAll('.lapp')].filter(t => !t.hidden && t.offsetParent).map(t => t.querySelector('.nm').textContent); });
    ok(f1.length >= 1 && f1.length < target.total && f1.some(n => n === target.name), `${skin}: "${q}" narrows ${target.total} apps to ${JSON.stringify(f1)}`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/search-${skin}-typed.png` });
    await p.evaluate(() => window.__ndf.querySelector('input').value = ''); await p.keyboard.type('zzqxv'); await p.waitForTimeout(250);
    ok(await p.evaluate(() => !window.__ndf.closest('.glance').querySelector('.nd-none').hidden), `${skin}: no-match message shows`);
    // Agent-side app is findable while folded: Connectors / Agents unfold under a query.
    await p.evaluate(() => { const i = window.__ndf.querySelector('input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); }); 
    const agentName = await p.evaluate(() => window.__ndf.closest('.glance').querySelector('.forag .lapp .nm')?.textContent || '');
    if (agentName) { await p.keyboard.type(agentName.slice(0, 5)); await p.waitForTimeout(250); ok(await p.evaluate(n => [...window.__ndf.closest('.glance').querySelectorAll('.forag .lapp')].some(t => t.offsetParent && t.querySelector('.nm').textContent === n), agentName), `${skin}: folded "For agents" app "${agentName}" is found by search`); }
    await p.evaluate(() => { const i = window.__ndf.querySelector('input'); i.value = ''; }); await p.keyboard.type(q); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
    const opened = await p.evaluate(() => { const d = window.__ndf?.closest('.desk'); return { here: !!d?.classList.contains('has-wins'), title: d?.querySelector('.win .wt, .win [data-title], .win')?.textContent?.trim().slice(0, 30) }; });
    ok(opened.here, `${skin}: Enter opens the first match ${JSON.stringify(opened)}`);
    ok(!errs.length, `${skin}: no page errors ${errs.join(' | ').slice(0, 200)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `${fails.length} failed` : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
