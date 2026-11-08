#!/usr/bin/env node
// In-shell captures + checks for the in-app Downloads banner and sheet (web/core/downloads.js).
// Real phone/desktop shell from this checkout on a SYNTHETIC origin (never a live owner origin), skin chosen
// before boot (localStorage only on that throwaway origin). A fake wizardDownloadsPort (shell message port) stands in for the Android app.
//   QA_SKINS=nebula,sepia OUT=<dir> NODE_PATH=<playwright>/node_modules node tools/qa-downloads-shell.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require('./qa-playwright.cjs');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web');
const out = process.env.OUT || path.join(root, 'tmp', 'downloads-shell');
fs.mkdirSync(out, { recursive: true });
const ORIGIN = 'http://downloads-qa.test';
const TYPES = { '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const SKINS = (process.env.QA_SKINS || 'nebula,sepia').split(',');
const ITEMS = () => {
  const n = Date.now();
  return [
    { id: '21', name: 'Lease agreement.pdf', mime: 'application/pdf', size: 4_700_000, got: 4_700_000, status: 'done', started: n - 4000, finished: n - 1000 },
    { id: '20', name: 'site-visit-video.mp4', mime: 'video/mp4', size: 48_000_000, got: 22_560_000, status: 'running', started: n - 3000, finished: 0 },
    { id: '19', name: 'Budget 2027.xlsx', mime: 'application/vnd.ms-excel', size: 182_000, got: 182_000, status: 'done', started: n - 3_600_000, finished: n - 3_590_000 },
    { id: '18', name: 'broken-link.zip', mime: 'application/zip', size: -1, got: 0, status: 'failed', started: n - 7_200_000, finished: n - 7_190_000 },
  ];
};
const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const loud = Array.from({ length: 40 }, (_, i) => `<span style="color:${i % 2 ? '#ff00aa' : '#00ffcc'}">LOUD TEXT BEHIND ${i} </span>`).join('');
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' · ' + extra : '')); };

async function opaque(page, sel) {
  const panel = page.locator(sel).first();
  await panel.evaluate((e, loud) => {
    const b = document.createElement('div'); b.id = 'qa-loud'; b.innerHTML = loud;
    b.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:900 26px/30px sans-serif;overflow:hidden;z-index:' + ((Number(getComputedStyle(e).zIndex) || 1) - 1);
    document.body.appendChild(b);
  }, loud);
  const box = await panel.boundingBox();
  const clip = { x: box.x + 6, y: box.y + 6, width: Math.max(8, box.width - 12), height: Math.max(8, box.height - 12) };
  const over = await page.screenshot({ clip });
  await page.evaluate(() => document.querySelector('#qa-loud').remove());
  const bare = await page.screenshot({ clip });
  return over.equals(bare);
}
const styleOf = (page, sel) => page.locator(sel).first().evaluate(e => { const s = getComputedStyle(e); return { bg: s.backgroundColor, color: s.color, blur: s.backdropFilter, border: s.borderTopColor }; });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text', '--disable-gpu'] });
  for (const shell of ['phone', 'desktop']) for (const skin of SKINS) {
    const tag = `${shell}-${skin}`;
    const ctx = await browser.newContext(shell === 'phone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } });
    await ctx.route('**/*', r => {
      const req = r.request(), u = new URL(req.url());
      if (u.origin !== ORIGIN) return r.abort();
      const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html';
      const f = path.resolve(web, rel);
      if (req.method() === 'GET' && f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile())
        return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      if (req.method() !== 'GET') return r.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(/\/sessions$/.test(u.pathname) ? { data: [], has_more: false } : {}) });
    });
    await ctx.addInitScript(({ shell, skin, items }) => {
      try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour', 'done'); localStorage.setItem('wos.tour.done', '1');
        localStorage.setItem('wux.shell', shell); localStorage.setItem('wos.skin', skin); } catch (_) {}
      window.__dl = items; window.__calls = [];
      // Fake of the Android shell message port (window.wizardDownloadsPort, protocol v1). Web-side QA only: native frame
      // isolation is covered by DownloadsCallerPolicyTest and a device check, not by this fake.
      const fakePort = () => { const hs = []; const answer = m => {
        if (m.method === 'list') return { ok: true, result: { v: 1, items: window.__dl } };
        const id = m.params && m.params.id;
        if (m.method === 'open') { window.__calls.push(['open', id]); return { ok: true, result: 'ok' }; }
        if (m.method === 'cancel' || m.method === 'remove') { window.__calls.push([m.method, id]); window.__dl = window.__dl.filter(x => x.id !== id); return { ok: true, result: 'ok' }; }
        return { ok: false, error: 'unknown method' }; };
        return { push(ev) { hs.forEach(f => f({ data: JSON.stringify({ v: 1, event: ev }) })); }, postMessage(t) { const m = JSON.parse(t); const r = answer(m); setTimeout(() => hs.forEach(f => f({ data: JSON.stringify({ v: 1, id: m.id, ...r }) })), 0); }, addEventListener(t, f) { if (t === 'message') hs.push(f); } }; };
      const fp = fakePort(); window.wizardDownloadsPort = fp; window.__qaPush = ev => fp.push(ev);   // QA harness only: stands in for native posting an event on the port
    }, { shell, skin, items: ITEMS() });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const entry = shell === 'phone' ? '?shell=phone' : 'desktop.html';
    await page.goto(`${ORIGIN}/wizard-os-home/${entry}`, { waitUntil: 'load' });
    await page.waitForFunction(([sh, sk]) => document.documentElement.dataset.shell === sh && document.documentElement.dataset.skin === sk && window.WosDownloads, [shell, skin], { timeout: 30000 });
    await page.waitForTimeout(1500);
    check(`${tag}: module present, bridge seen`, await page.evaluate(() => window.WosDownloads.available()));

    // 1. finished download → banner
    await page.evaluate(() => window.__qaPush({ type: 'done', item: window.__dl[0] }));
    await page.locator('.wdl-banner.on').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `${tag}-banner.png`) });
    const bs = await styleOf(page, '.wdl-banner');
    const ob = await opaque(page, '.wdl-banner');
    const bt = await page.locator('.wdl-banner .wdl-tx b').evaluate(e => getComputedStyle(e).color);
    const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const btn = await styleOf(page, '.wdl-open');
    check(`${tag}: banner fully opaque over loud text`, ob);
    check(`${tag}: banner has no blur`, !bs.blur || bs.blur === 'none');
    check(`${tag}: banner text readable (contrast ≥ 4.5)`, contrast(bs.bg, bt) >= 4.5, `bg ${bs.bg} text ${bt} ratio ${contrast(bs.bg, bt).toFixed(1)}`);
    check(`${tag}: Open button readable (contrast ≥ 3)`, contrast(btn.bg, btn.color) >= 3, `bg ${btn.bg} text ${btn.color} ratio ${contrast(btn.bg, btn.color).toFixed(1)}`);
    results.push({ name: `${tag}: banner bg`, ok: true, extra: `banner ${bs.bg} · page ${pageBg} · skin dark=${await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)}` });
    // never a bright box on a dark skin / dark box on a light skin: banner tracks the skin's own surface
    const skinBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    const skinDark = ['nebula', 'grove', 'tide', 'ember', 'signal', 'novairecito', 'obsidian', 'landscapes'].includes(skin);
    check(`${tag}: banner luminance matches the skin (${skinDark ? 'dark' : 'light'})`, skinDark ? lum(bs.bg) < .25 : lum(bs.bg) > .5, `banner ${bs.bg} · --bg ${skinBg}`);
    const geo = await page.evaluate(() => {
      const r = e => { const b = e?.getBoundingClientRect(); return b && b.width ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; };
      return { banner: r(document.querySelector('.wdl-banner')), orb: r(document.querySelector('#orbWrap')), dock: r(document.querySelector('.dock')), vh: innerHeight, vw: innerWidth };
    });
    if (shell === 'phone') {
      const hit = (a, b) => a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      check(`${tag}: banner does not cover the orb or bottom bar`, !hit(geo.banner, geo.orb) && !hit(geo.banner, geo.dock), JSON.stringify(geo));
    } else check(`${tag}: banner sits top-right`, geo.banner && geo.banner.x > geo.vw / 2 && geo.banner.y < 120, JSON.stringify(geo.banner));

    // 2. Open on banner → native open, banner closes
    await page.locator('.wdl-banner .wdl-open').click();
    await page.waitForFunction(() => window.__calls.some(c => c[0] === 'open' && c[1] === '21'), null, { timeout: 3000 });
    check(`${tag}: banner Open calls native open with the id`, true);
    await page.waitForTimeout(400);
    check(`${tag}: banner closes after Open`, await page.locator('.wdl-banner').count() === 0);

    // 3. banner auto-dismiss ~6 s, tap on body opens sheet
    await page.evaluate(() => window.__qaPush({ type: 'done', item: window.__dl[0] }));
    await page.locator('.wdl-banner.on').waitFor({ timeout: 3000 });
    const t0 = Date.now();
    await page.locator('.wdl-banner').waitFor({ state: 'detached', timeout: 9000 });
    const dt = Date.now() - t0;
    check(`${tag}: banner auto-dismisses at ~6 s`, dt > 5000 && dt < 7500, `${dt} ms`);
    await page.evaluate(() => window.__qaPush({ type: 'done', item: window.__dl[0] }));
    await page.locator('.wdl-banner.on').waitFor({ timeout: 3000 });
    await page.locator('.wdl-banner .wdl-main').click();
    await page.locator('.wdl-sheet.on .wdl-row').first().waitFor({ state: 'visible', timeout: 3000 });
    await page.waitForTimeout(500);
    check(`${tag}: banner tap opens the Downloads sheet`, await page.evaluate(() => window.WosDownloads.isOpen()));
    await page.screenshot({ path: path.join(out, `${tag}-sheet.png`) });
    const ps = await styleOf(page, '.wdl-panel');
    check(`${tag}: sheet panel fully opaque`, await opaque(page, '.wdl-panel'));
    check(`${tag}: sheet has no blur`, !ps.blur || ps.blur === 'none');
    const rows = await page.locator('.wdl-row').allInnerTexts();
    check(`${tag}: sheet lists 4 rows (done ×2, running with %, failed)`, rows.length === 4 && /47%/.test(rows.join('\n')) && /Cancel/.test(rows.join('\n')) && /Open/.test(rows.join('\n')) && /Remove/.test(rows.join('\n')), rows.join(' | ').replace(/\n/g, ' '));
    // row Open
    // by the name on screen: rows carry no download id
    await page.locator('.wdl-row', { hasText: 'Budget 2027.xlsx' }).locator('[data-wdl="open"]').click();
    await page.waitForFunction(() => window.__calls.some(c => c[0] === 'open' && c[1] === '19'), null, { timeout: 3000 });
    check(`${tag}: sheet row Open calls native open`, true);
    // Back closes one layer
    await page.evaluate(() => window.WosBack.escape({ preventDefault() {}, stopImmediatePropagation() {} }));
    await page.waitForTimeout(400);
    check(`${tag}: Back/Esc closes the sheet first (one layer)`, await page.evaluate(() => !window.WosDownloads.isOpen()) && await page.locator('.wdl-sheet').count() === 0);
    // outside tap closes
    await page.evaluate(() => window.__qaPush({ type: 'done', item: window.__dl[0] }));   // show() is no longer public: reopen via the banner like a user
    await page.locator('.wdl-banner.on').waitFor({ timeout: 3000 });
    await page.locator('.wdl-banner .wdl-main').click();
    await page.locator('.wdl-sheet.on').waitFor({ timeout: 3000 });
    await page.mouse.click(shell === 'phone' ? 195 : 100, shell === 'phone' ? 60 : 60);
    await page.waitForTimeout(400);
    check(`${tag}: tapping outside closes the sheet`, await page.locator('.wdl-sheet').count() === 0);
    check(`${tag}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' / '));
    await ctx.close();
  }
  // Settings row (phone shell, bridge present) and inert-without-bridge, on the first skin.
  for (const bridge of [true, false]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.route('**/*', r => {
      const u = new URL(r.request().url()); if (u.origin !== ORIGIN) return r.abort();
      const f = path.resolve(web, decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html');
      if (r.request().method() === 'GET' && f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      return r.fulfill({ status: r.request().method() === 'GET' ? 200 : 403, contentType: 'application/json', body: /\/sessions$/.test(u.pathname) ? '{"data":[],"has_more":false}' : '{}' });
    });
    await ctx.addInitScript(({ bridge, items, skin }) => {
      try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour', 'done'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wux.shell', 'phone'); localStorage.setItem('wos.skin', skin); } catch (_) {}
      window.__dl = items; window.__calls = [];
      // Fake of the Android shell message port (window.wizardDownloadsPort, protocol v1). Web-side QA only: native frame
      // isolation is covered by DownloadsCallerPolicyTest and a device check, not by this fake.
      const fakePort = () => { const hs = []; const answer = m => {
        if (m.method === 'list') return { ok: true, result: { v: 1, items: window.__dl } };
        const id = m.params && m.params.id;
        if (m.method === 'open') { window.__calls.push(['open', id]); return { ok: true, result: 'ok' }; }
        if (m.method === 'cancel' || m.method === 'remove') { window.__calls.push([m.method, id]); window.__dl = window.__dl.filter(x => x.id !== id); return { ok: true, result: 'ok' }; }
        return { ok: false, error: 'unknown method' }; };
        return { push(ev) { hs.forEach(f => f({ data: JSON.stringify({ v: 1, event: ev }) })); }, postMessage(t) { const m = JSON.parse(t); const r = answer(m); setTimeout(() => hs.forEach(f => f({ data: JSON.stringify({ v: 1, id: m.id, ...r }) })), 0); }, addEventListener(t, f) { if (t === 'message') hs.push(f); } }; };
      if (bridge) { const fp = fakePort(); window.wizardDownloadsPort = fp; window.__qaPush = ev => fp.push(ev); }   // QA harness only: stands in for native posting an event on the port
    }, { bridge, items: ITEMS(), skin: SKINS[0] });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(`${ORIGIN}/wizard-os-home/?shell=phone&view=settings`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WosDownloads, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    if (bridge) {
      // The Phone page is a Settings sub-page; open it through the registry's own deep link.
      const n = await page.evaluate(() => { try { window.WosSettings.focus?.('downloads'); } catch (_) {} return document.querySelectorAll('[data-st="downloads"]').length; });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, `phone-${SKINS[0]}-settings-downloads.png`) });
      check('settings: Downloads row present with the bridge', n > 0 || await page.locator('[data-st="downloads"]').count() > 0, `rows ${n}`);
      if (await page.locator('[data-st="downloads"]').count()) {
        await page.locator('[data-st="downloads"]').first().click();
        await page.locator('.wdl-sheet.on').waitFor({ timeout: 3000 });
        check('settings: Downloads row opens the sheet above Settings', true);
      }
    } else {
      check('no bridge: module inert, no Settings row, no banner', !(await page.evaluate(() => window.WosDownloads.available())) && await page.locator('[data-st="downloads"]').count() === 0);
      // No port exists, so there is no push hook: a stray page-side event must still show nothing (inert without a port).
      await page.evaluate(() => { window.dispatchEvent(new MessageEvent('message', { data: { v: 1, event: { type: 'done', item: (window.__dl || [])[0] } } })); });
      check('no bridge: no push hook exists', await page.evaluate(() => typeof window.__qaPush === 'undefined'));
      check('no bridge: a stray push shows nothing', await page.locator('.wdl').count() === 0);
    }
    check(`settings/${bridge ? 'bridge' : 'nobridge'}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' / '));
    await ctx.close();
  }
  await browser.close();
  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ failed: failed.map(f => f.name), results }, null, 2));
  console.log(JSON.stringify({ total: results.length, failed: failed.map(f => f.name), out }));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
