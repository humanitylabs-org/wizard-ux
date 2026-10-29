// QA: New desk "In development" row: launcher-linked screens and test copies fold under it; the row only exists when
// there is at least one such app. Usage: QA_BASE=http://127.0.0.1:<port> [QA_SHOTS=dir] node qa-new-desk-in-dev.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:9371', SHOTS = process.env.QA_SHOTS || '';
const fails = [], ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
let OWN = []; const isDev = a => OWN.includes(a.id) || a.source === 'launcher.json' || /-next$/.test(a.id) || /\(test\)\s*$/i.test(a.name || '');
(async () => {
  const browser = await chromium.launch();
  for (const [skin, strip] of [['nebula', false], ['grove', false], ['obsidian', false], ['nebula', true], ['obsidian', true]]) {
    const tag = `${skin}${strip ? '/no-dev' : ''}`;
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(s => { if (window !== top) return; try { localStorage.removeItem('wux.apps.v1'); localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.rvCoached', 'true'); localStorage.setItem('wos.obsidian.live', 'true'); } catch (_) {} }, skin);
    let devIds = [];
    await ctx.route(/\/wizard\/v1\/apps(\?.*)?$/, async route => {
      const r = await route.fetch(); const j = await r.json(); if (!strip && !j.in_development) j.in_development = ['usuals', 'outline-streaming-demo', 'reference']; OWN = j.in_development || [];
      devIds = (j.apps || []).filter(a => isDev(a) && !a.system).map(a => a.id);
      if (strip) { j.apps = (j.apps || []).filter(a => !isDev(a)); delete j.in_development; }
      await route.fulfill({ response: r, json: j });
    });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + '/wizard-os-home/?myskin=off'); await p.waitForSelector('#orbWrap'); await p.waitForTimeout(3000);
    await p.evaluate(() => { __wos.openOverview(); document.querySelector('[data-ovadd]')?.click(); }); await p.waitForTimeout(900);
    const s = await p.evaluate(() => {
      const nd = [...document.querySelectorAll('.new-desk')].find(n => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.left < innerWidth; }); window.__nd = nd;
      const dev = nd.querySelector('.forag[data-fold="dev"]');
      const ids = el => [...(el ? el.querySelectorAll('.lapp') : [])].map(t => t.dataset.app || t.dataset.appinfo);
      return { dev: !!dev, folded: dev ? getComputedStyle(dev.querySelector('.fa-body')).display === 'none' : null, count: dev?.querySelector('small')?.textContent, devTiles: ids(dev), appTiles: ids(nd.querySelector('.kg-apps')), order: [...nd.querySelectorAll('.kg-apps, .forag')].map(e => e.dataset.fold || 'apps') };
    });
    if (strip) ok(!s.dev && s.order.join() === 'apps,agents', `${tag}: no In development row when nothing is in development ${JSON.stringify(s.order)}`);
    else {
      ok(devIds.length > 0, `${tag}: box has ${devIds.length} in-development apps`);
      ok(s.dev && s.folded && s.order.join() === 'apps,dev,agents', `${tag}: folded In development row between Apps and For agents ${JSON.stringify(s.order)}`);
      ok(devIds.every(id => !s.appTiles.includes(id)), `${tag}: Apps holds no in-development app`);
      ok(['outline-streaming-demo', 'reference'].every(id => s.devTiles.includes(id)) && !s.appTiles.some(id => /^v-(day|week|month)$/.test(id)) && !s.devTiles.some(id => /^v-/.test(id)), `${tag}: owner list (Outline, Reference) folded; review views gone`);
      ok(await p.evaluate(() => window.WizCore.isInDevelopment({ id: 'usuals' }) && !window.WizCore.isInDevelopment({ id: 'wisdom' })), `${tag}: Food (phone-app only tile) is marked in development`);
      ok(String(s.devTiles.length) === s.count && devIds.every(id => s.devTiles.includes(id)), `${tag}: In development holds all ${s.count}: ${s.devTiles.join(', ')}`);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-${skin}.png` });
      await p.evaluate(() => window.__nd.querySelector('[data-fatoggle="dev"]').click()); await p.waitForTimeout(300);
      const o = await p.evaluate(() => ({ dev: getComputedStyle(window.__nd.querySelector('[data-fold="dev"] .fa-body')).display !== 'none', agents: getComputedStyle(window.__nd.querySelector('[data-fold="agents"] .fa-body')).display !== 'none' }));
      ok(o.dev && !o.agents, `${tag}: tapping it opens only In development ${JSON.stringify(o)}`);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-${skin}-open.png` });
      await p.evaluate(() => window.__nd.querySelector('[data-fatoggle="dev"]').click()); await p.waitForTimeout(200);
      const name = await p.evaluate(id => window.__nd.querySelector(`[data-fold="dev"] [data-app="${id}"] .nm, [data-fold="dev"] [data-appinfo="${id}"] .nm`)?.textContent, s.devTiles[0]);
      await p.evaluate(() => window.__nd.closest('.glance').querySelector('[data-ndq]').focus()); await p.keyboard.type(name.slice(0, 5)); await p.waitForTimeout(300);
      ok(await p.evaluate(n => [...window.__nd.querySelectorAll('[data-fold="dev"] .lapp')].some(t => t.offsetParent && t.querySelector('.nm').textContent === n), name), `${tag}: search finds folded "${name}"`);
    }
    ok(!errs.length, `${tag}: no page errors ${errs.join(' | ').slice(0, 200)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `${fails.length} failed` : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
