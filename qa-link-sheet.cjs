// QA: the link sheet, the in-app browser for links tapped in Wizard (core/links.js).
// Usage: node qa-link-sheet.cjs [origin=http://127.0.0.1:9393/wizard-os-home/]
// Fixture pages under /qa-page/ are served by this suite (same origin); every Wizard write is intercepted.
let pw; try { pw = require('/home/developer/node_modules/playwright'); } catch (e) { pw = require('playwright-core'); }
const fs = require('fs'), path = require('path');
const WEB = process.env.QA_WEB_DIR || '';
const URL_ = process.argv[2] || 'http://127.0.0.1:9393/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || '/home/developer/.hermes/cache/scratch';
const EXE = process.env.QA_CHROME || undefined;
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width"></head><body style="background:#111;color:#eee;font:16px sans-serif;padding:16px;min-height:2400px">${body}</body></html>`;
const FIX = {
  '/qa-page/one/': page('Page One', `<h1>One</h1><a id="plain" href="/qa-page/two/">two (plain)</a><br><a id="blank" href="/qa-page/three/" target="_blank">three (_blank)</a><br><a id="top" href="/qa-page/two/" target="_top">two (_top)</a><br><button id="wo" onclick="window.open('/qa-page/three/')">window.open</button><br><a id="ext" href="https://example.com/">external</a>`),
  '/qa-page/two/': page('Page Two', '<h1>Two</h1>'),
  '/qa-page/host/': page('Host App', '<h1>Host</h1><a id="other" href="/qa-page/two/">other app</a><br><a id="blank" href="/qa-page/host/../two/" target="_blank">blank</a><br><button id="wopen" onclick="window.open(\'/qa-page/two/\', \'_blank\')">open</button><br><a id="inside" href="/qa-page/host/sub/">inside</a>'),
  '/qa-page/host/sub/': page('Host Sub', '<h1>Sub</h1>'),
  '/qa-page/three/': page('Page Three', '<h1>Three</h1>'),
  '/qa-page/gallery/': page('Gallery', '<h1>Mockups</h1><a id="img1" href="/qa-page/wide.png">original</a><br><a id="img2" href="wide2.png" target="_blank">second</a>'),
};
// A real 1280-px-wide mockup screenshot: wider than any phone.
const PNG = fs.readFileSync(process.env.QA_PNG || '/home/developer/.hermes/data/apps/private-reports/herdr-to-wizard/herdr-homepage-demo.png');

(async () => {
  const RES = process.env.QA_RESOLVE; const b = await pw.chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), ...(RES ? { args: ['--host-resolver-rules=' + RES] } : {}) });
  for (const shell of ['phone', 'desktop']) {
    const phone = shell === 'phone';
    const ctx = await b.newContext(phone
      ? { viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' }
      : { viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    const writes = [], popups = [];
    await ctx.route('**/*', r => {
      const q = r.request(), u = new URL(q.url());
      if (u.origin === ORIGIN && /^\/qa-page\/(gallery\/)?wide2?\.png$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (u.origin === ORIGIN && FIX[u.pathname]) return r.fulfill({ status: 200, contentType: 'text/html', body: FIX[u.pathname] });
      // QA_WEB_DIR: serve this branch's shell files in place of the live ones (real gateway, real apps).
      const m = WEB && u.origin === ORIGIN && q.method() === 'GET' && u.pathname.match(/^\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)$/);
      if (m && !/^(data|summaries)\.js$/.test(m[1])) {
        const f = m[1] || (phone ? 'index.html' : 'desktop.html'), fp = path.join(WEB, 'web', f);
        if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) });
      }
      if (u.origin === ORIGIN && u.pathname.startsWith('/wizard/') && q.method() !== 'GET' && q.method() !== 'HEAD') { writes.push(u.pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
      if (u.hostname === 'example.com') return r.fulfill({ status: 200, contentType: 'text/html', body: '<title>ext</title>' });
      return r.continue();
    });
    const p = await ctx.newPage();
    ctx.on("page", x => { if (x !== p) popups.push(x); });
    await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await p.goto(URL_ + `?shell=${phone ? 'phone' : 'desktop'}`, { waitUntil: 'load' });
    await p.waitForTimeout(2500);
    const api = phone ? '__wos' : '__wux';
    // Desk strip: phone links open as review desks (qa-desk-strip.cjs covers that). Turn the route off so this
    // suite keeps testing the sheet itself, which still serves desktop, quick search and declined links.
    if (phone) await p.evaluate(() => { if (window.__wos.links) window.__wos.links.route = null; });
    const shellUrl = p.url();
    const st = () => p.evaluate(a => window[a].links.state(), api);
    // A chat bubble with two links, like an agent reply.
    const tapLink = async (href) => {
      await p.evaluate(h => { let d = document.getElementById('qa-bub'); if (!d) { d = document.createElement('div'); d.className = 'bub'; d.id = 'qa-bub'; d.style.cssText = 'position:fixed;left:20px;top:120px;z-index:30;padding:8px;background:#222'; (document.getElementById('device') || document.body).appendChild(d); } d.innerHTML = `<a id="qa-a" href="${h}" target="_blank" rel="noopener">link</a>`; }, href);
      await p.click('#qa-a');
      await p.waitForTimeout(900);
    };
    const back = () => phone ? p.evaluate(() => window.__wosNativeBack()) : p.keyboard.press('Escape');

    // 1. Same-origin link opens in the sheet; the shell never navigates.
    await tapLink(ORIGIN + '/qa-page/one/');
    let s = await st();
    ok(s.open && /\/qa-page\/one\/$/.test(s.url) && p.url() === shellUrl, `${shell}: same-origin link opens in the sheet, shell stays`, JSON.stringify(s));
    ok(s.title === 'Page One', `${shell}: sheet shows the page title`, s.title);
    await p.screenshot({ path: `${SHOTS}/ls-${shell}-open.png` });

    // 2. In-page steps stay in the sheet: plain link, _blank, _top, window.open.
    const fr = () => p.frameLocator('.linksheet iframe');
    await fr().locator('#plain').click(); await p.waitForTimeout(700);
    s = await st(); ok(s.depth === 2 && /two/.test(s.url), `${shell}: plain link inside the sheet → depth 2`, JSON.stringify(s));
    await back(); await p.waitForTimeout(700);
    s = await st(); ok(s.open && s.depth === 1 && /one/.test(s.url), `${shell}: Back steps the sheet page first`, JSON.stringify(s));
    await fr().locator('#blank').click(); await p.waitForTimeout(700);
    s = await st(); ok(s.depth === 2 && /three/.test(s.url) && !popups.length, `${shell}: target=_blank loads in the sheet (no new tab)`, JSON.stringify({ s, popups: popups.length }));
    await back(); await p.waitForTimeout(700);
    await fr().locator('#top').click(); await p.waitForTimeout(700);
    s = await st(); ok(s.depth === 2 && p.url() === shellUrl, `${shell}: target=_top never replaces the shell`, JSON.stringify({ s, url: p.url() }));
    await back(); await p.waitForTimeout(700);
    await fr().locator('#wo').click(); await p.waitForTimeout(700);
    s = await st(); ok(s.depth === 2 && /three/.test(s.url) && !popups.length, `${shell}: window.open loads in the sheet`, JSON.stringify(s));

    // 3. Back unwinds the sheet, then closes it; the shell stays (never exits).
    await back(); await p.waitForTimeout(500); await back(); await p.waitForTimeout(600);
    s = await st(); ok(!s.open && p.url() === shellUrl, `${shell}: Back twice closes the sheet, shell still open`, JSON.stringify(s));

    // 4. External links go to the system browser; no sheet appears.
    await tapLink('https://example.com/');
    await p.waitForTimeout(500);
    s = await st(); ok(!s.open && popups.some(x => /example\.com/.test(x.url())), `${shell}: external link → system browser, no sheet`, JSON.stringify({ s, popups: popups.map(x => x.url()) }));
    for (const x of popups.splice(0)) await x.close().catch(() => {});

    // 5. Keep: becomes a window on the current desk, sheet gone, desk count unchanged.
    await tapLink(ORIGIN + '/qa-page/two/');
    const before = await p.evaluate(a => a === '__wos' ? { desk: __wos.idx ?? null, n: document.querySelectorAll('.desk').length, wins: JSON.parse(localStorage.getItem('wos.wins') || '{}') } : { n: document.querySelectorAll('.ws, [data-ws]').length, wins: JSON.parse(localStorage.getItem('wux.desk.wins') || '{}') }, api);
    await p.click('.linksheet [data-ls="keep"]'); await p.waitForTimeout(900);
    s = await st();
    const after = await p.evaluate(a => a === '__wos' ? { n: document.querySelectorAll('.desk').length, wins: JSON.parse(localStorage.getItem('wos.wins') || '{}') } : { n: document.querySelectorAll('.ws, [data-ws]').length, wins: JSON.parse(localStorage.getItem('wux.desk.wins') || '{}') }, api);
    const kept = await p.evaluate(() => [...document.querySelectorAll('iframe')].map(f => f.getAttribute('src') || '').filter(x => /qa-page\/two/.test(x)).length);
    ok(!s.open && kept >= 1 && after.n === before.n + (shell === 'phone' ? 1 : 0), shell === 'phone' ? 'phone: Keep → window on its own desk right beside this one (desk strip), sheet gone' : `${shell}: Keep → window on this desk, sheet gone, no new desk`, JSON.stringify({ kept, before: before.n, after: after.n }));
    await p.screenshot({ path: `${SHOTS}/ls-${shell}-kept.png` });

    // 6. Opening the sheet over the Apps sheet: Back closes the link sheet first.
    if (phone) {
      await tapLink(ORIGIN + '/qa-page/one/');
      await back(); await p.waitForTimeout(500);
      s = await st(); ok(!s.open && p.url() === shellUrl, 'phone: one Back closes a one-page sheet', JSON.stringify(s));
      // drag the bar down to dismiss
      await tapLink(ORIGIN + '/qa-page/one/');
      const box = await p.locator('.linksheet .ls-title').boundingBox();
      await p.mouse.move(box.x + 20, box.y + 10); await p.mouse.down(); await p.mouse.move(box.x + 20, box.y + 260, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(500);
      s = await st(); ok(!s.open, 'phone: drag the top bar down dismisses the sheet', JSON.stringify(s));
    }
    // James's case (Wisdom thread, 9 Oct): internal app links in a chat open in the sheet over the desk, never full screen.
    for (const path of ['/wisdom/', '/wizard-signal/', '/wisdom/#/read/jobs-have-it-your-way']) {
      await tapLink(ORIGIN + path); await p.waitForTimeout(1800);
      s = await st();
      const real = await p.evaluate(() => { try { const d = document.querySelector('.linksheet iframe').contentDocument; return { t: d.title, n: d.body ? d.body.innerText.length : 0 }; } catch (e) { return { t: 'x', n: 0 }; } });
      ok(s.open && s.url.includes(path.replace(/#.*$/, '')) && p.url() === shellUrl && real.n > 20, `${shell}: ${path} in a chat → sheet over this desk, page renders, shell stays`, JSON.stringify({ s, real }));
      if (phone && path === '/wisdom/') {
        await p.screenshot({ path: `${SHOTS}/ls-phone-wisdom.png` });
        const usable = await p.evaluate(() => { const d = document.querySelector('#dock').getBoundingClientRect(); const el = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2); return !!(el && el.closest('#dock')); });
        ok(usable, 'phone: with Wisdom open, the dock and orb stay on top and tappable', '');
        const d0 = await p.evaluate(() => __wos.idx);
        await p.evaluate(() => __wos.goDesk((__wos.idx + 1) % 5)); await p.waitForTimeout(600);
        s = await st(); ok(!s.open, 'phone: switching desk dismisses the sheet (desks stay usable)', JSON.stringify(s));
        await p.evaluate(d => __wos.goDesk(d), d0); await p.waitForTimeout(500);
        continue;
      }
      await back(); await p.waitForTimeout(700);
      s = await st(); if (s.open) { await back(); await p.waitForTimeout(600); s = await st(); }
      ok(!s.open && p.url() === shellUrl, `${shell}: Back closes ${path}, Wizard stays open`, JSON.stringify(s));
    }
    // 7b. Phone (James, 10 Oct): the sheet opens full height by default; ⤡ shrinks it to ~3/4, ⤢ restores full,
    //     and the next link opens full again.
    if (phone) {
      await tapLink(ORIGIN + '/qa-page/two/'); await p.waitForTimeout(700);
      const h = () => p.evaluate(() => { const pn = document.querySelector('.linksheet .ls-panel').getBoundingClientRect(), dv = document.querySelector('#device').getBoundingClientRect(); return Math.round(pn.height / dv.height * 100); });
      const h0 = await h();
      await p.click('.linksheet [data-ls="full"]'); await p.waitForTimeout(500);
      const h1 = await h();
      ok(h0 >= 85 && h1 >= 60 && h1 <= 72, 'phone: sheet opens full height by default, ⤡ shrinks it to ~3/4', JSON.stringify({ h0, h1 }));
      await p.screenshot({ path: `${SHOTS}/ls-phone-34.png` });
      await p.click('.linksheet [data-ls="full"]'); await p.waitForTimeout(400);
      const h2 = await h();
      ok(h2 >= 85, 'phone: ⤢ restores full height', JSON.stringify({ h2 }));
      await p.screenshot({ path: `${SHOTS}/ls-phone-full.png` });
      const dockOk = await p.evaluate(() => { const d = document.querySelector('#dock').getBoundingClientRect(); const el = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2); return !!(el && el.closest('#dock')); });
      ok(dockOk, 'phone: full-height sheet keeps the dock and orb tappable', '');
      await p.click('.linksheet [data-ls="full"]'); await p.waitForTimeout(300);
      await back(); await p.waitForTimeout(600);
      s = await st(); ok(!s.open, 'phone: one Back closes it', JSON.stringify(s));
      await tapLink(ORIGIN + '/qa-page/one/'); await p.waitForTimeout(700);
      const h3 = await h();
      ok(h3 >= 85, 'phone: after shrinking, the next link opens full height again', JSON.stringify({ h3 }));
      await back(); await p.waitForTimeout(600);
    }
    // 7b. James's case: a mockup image link opens fit to the screen width with pinch zoom, never as a raw
    //     full-size page wider than the viewport. Back closes the image first, then the page, never Wizard.
    {
      const vs = () => p.evaluate(() => window.WosChat.viewer.state);
      const fit = () => p.evaluate(() => { const i = document.querySelector('.mviewer .mv-stage img'), r = i && i.getBoundingClientRect(); return i ? { w: Math.round(r.width), vw: innerWidth, nat: i.naturalWidth, overflow: document.documentElement.scrollWidth > innerWidth } : null; });
      await tapLink(ORIGIN + '/qa-page/gallery/');
      const g = p.frameLocator('.linksheet iframe');
      await g.locator('#img1').click(); await p.waitForTimeout(900);
      let v = await vs(), f = await fit(); s = await st();
      ok(v.open && v.kind === 'image' && v.n === 2 && v.i === 0 && s.open && /gallery/.test(s.url) && s.depth === 1, `${shell}: image link in a page → image viewer over the page`, JSON.stringify({ v, s }));
      ok(f && f.nat === 1280 && f.w <= f.vw && !f.overflow, `${shell}: 1280-px mockup opens no wider than the screen`, JSON.stringify(f));
      if (phone) {
        await p.screenshot({ path: `${SHOTS}/ls-phone-image-fit.png` });
        // Real two-finger pinch (CDP touch → genuine pointer events).
        const cdp = await ctx.newCDPSession(p);
        const r = await p.locator('.mviewer .mv-stage').boundingBox(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        const tp = d => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(40) });
        for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(40 + k * 14) }); await p.waitForTimeout(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await p.waitForTimeout(300); v = await vs();
        ok(v.scale > 2, 'phone: pinch zooms the mockup', JSON.stringify(v));
        await p.screenshot({ path: `${SHOTS}/ls-phone-image-zoom.png` });
      }
      await back(); await p.waitForTimeout(500);
      v = await vs(); s = await st();
      ok(!v.open && s.open && /gallery/.test(s.url) && p.url() === shellUrl, `${shell}: Back closes the image, the page stays`, JSON.stringify({ v, s }));
      await g.locator('#img2').click(); await p.waitForTimeout(900);
      v = await vs(); ok(v.open && v.i === 1 && !popups.length, `${shell}: target=_blank image opens in the viewer, no new tab`, JSON.stringify({ v, popups: popups.length }));
      await back(); await p.waitForTimeout(400); await back(); await p.waitForTimeout(600);
      s = await st(); ok(!s.open && p.url() === shellUrl, `${shell}: Back twice → page closed, Wizard stays`, JSON.stringify(s));
      // An image link straight in a chat bubble.
      await tapLink(ORIGIN + '/qa-page/wide.png');
      v = await vs(); f = await fit(); s = await st();
      ok(v.open && !s.open && f && f.w <= f.vw, `${shell}: image link in chat → viewer, fit to width`, JSON.stringify({ v, s, f }));
      await back(); await p.waitForTimeout(500);
      v = await vs(); ok(!v.open && p.url() === shellUrl, `${shell}: one Back closes it, Wizard stays`, JSON.stringify(v));
    }
    // 8. James's case: a link INSIDE an embedded app (a window on the desk) to another app or _blank must
    //    never replace Wizard; it opens in the sheet, and ONE Back returns to the app window.
    {
      await p.evaluate(a => { if (a === '__wos') { __wos.closeSheets && __wos.closeSheets(true); __wos.openWin({ app: 'frame', url: '/qa-page/host/', title: 'Host' }); }
        else __wux.newWin({ app: 'frame', url: '/qa-page/host/', title: 'Host' }); }, api);
      await p.waitForTimeout(1800);
      const host = p.frameLocator('iframe[src="/qa-page/host/"]');
      for (const [sel, label] of [['#other', 'link to another app'], ['#blank', 'target=_blank link'], ['#wopen', 'window.open']]) {
        await host.locator(sel).click(); await p.waitForTimeout(1200);
        s = await st();
        const top = p.url();
        ok(s.open && /qa-page\/two/.test(s.url) && top === shellUrl && !popups.length, `${shell}: ${label} inside an app opens in the sheet, Wizard stays`, JSON.stringify({ s, top, popups: popups.length }));
        await back(); await p.waitForTimeout(800);
        s = await st();
        const still = await p.evaluate(() => !!document.querySelector('iframe[src="/qa-page/host/"]'));
        ok(!s.open && still && p.url() === shellUrl, `${shell}: one Back after the ${label} returns to the app`, JSON.stringify({ s, still }));
        for (const x of popups.splice(0)) await x.close().catch(() => {});
      }
      await host.locator('#inside').click(); await p.waitForTimeout(900);
      s = await st();
      const innerUrl = await p.evaluate(() => { try { return document.querySelector('iframe[src="/qa-page/host/"]').contentWindow.location.pathname; } catch (e) { return 'x'; } });
      ok(!s.open && innerUrl === '/qa-page/host/sub/', `${shell}: a link inside the app's own pages stays normal in-app navigation`, JSON.stringify({ s, innerUrl }));
    }
    ok(!errs.length, `${shell}: no page errors`, JSON.stringify(errs));
    ok(!writes.length, `${shell}: zero writes`, JSON.stringify(writes));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
