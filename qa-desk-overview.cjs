// Desk overview recognition and navigation. Real reads; agent writes always intercepted.
// Usage: node qa-desk-overview.cjs <origin> | QA_OUT=<directory> QA_PW=<playwright module>
let pw; try { pw = require(process.env.QA_PW || 'playwright-core'); } catch { pw = require('/home/developer/node_modules/playwright'); }
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9471/wizard-os-home/';
const out = process.env.QA_OUT || path.join(__dirname, 'qa-overview'); fs.mkdirSync(out, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, s) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', s); };
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  for (const width of [393, 360]) {
    const ctx = await b.newContext({ viewport: { width, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.rvCoached', 'true'); } catch {} });
    let agents = 0;
    const isolatedApps = new Set(['/wizard-music/', '/calendar/', '/wisdom/', '/topics/', '/mizel/']);
    await ctx.route('**/*', r => { const q = r.request(); if (!['GET', 'HEAD'].includes(q.method())) { if (/\/runs$|\/sessions$|\/steer/.test(q.url())) agents++; return r.fulfill({ status: 403, contentType: 'application/json', body: '{}' }); } if (q.isNavigationRequest() && q.frame().parentFrame() && [...isolatedApps].some(path => new URL(q.url()).pathname.startsWith(path))) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>QA app body</title><body style="background:#110e1c;color:white">App content excluded: testing shell navigation only</body>' }); return r.continue(); });
    const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(URL_); await p.waitForFunction(() => window.__wos); await p.waitForTimeout(3500);
    await p.evaluate(() => __wos.closeOverview());
    for (const id of ['wizard-music', 'calendar', 'wisdom']) { await p.evaluate(id => WizCore.deeplink.route(location.pathname + '?open=' + id), id); await p.waitForTimeout(500); }
    await p.evaluate(() => { const i = __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].appId === 'wizard-music')); __wos.goDesk(i, true); __wos.openOverview(); document.querySelector('#overview').scrollTop = 0; });
    await p.waitForTimeout(600);
    const info = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('.ov-card[data-ov]')];
      const music = cards.find(c => /Music/.test(c.getAttribute('aria-label')));
      const symbol = music.querySelector('.ov-symbol');
      const r = symbol?.getBoundingClientRect();
      return { home: !!cards[0].querySelector('.sg-home'), count: cards.length, desks: __wos.desks.length, big: r?.width || 0,
        bare: !document.querySelector('.ov-body .sgt'), here: music.classList.contains('here') && !!music.querySelector('.ov-here') && music.getAttribute('aria-current') === 'true',
        c: music.style.getPropertyValue('--ov-c'), appc: WizSigil.of({ id: 'wizard-music' }).color,
        keyboard: cards.every(c => c.tabIndex === 0), close: [...document.querySelectorAll('.ov-x')].every(c => { const r = c.getBoundingClientRect(); return r.width >= 36 && r.height >= 36; }),
        fit: document.documentElement.scrollWidth === innerWidth && cards.every(c => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) };
    });
    ok(info.home, `${width}: Home is the house sigil`);
    ok(info.count === info.desks, `${width}: every desk represented once`);
    ok(info.big >= 80 && info.bare, `${width}: large bare sigils replace nested mini-window boxes`);
    ok(info.here, `${width}: current desk has Here plus an accessible current state`);
    ok(info.c === info.appc, `${width}: Music shares the dock's color`);
    ok(info.keyboard && info.close, `${width}: cards keyboard reachable, close targets ≥36px`);
    ok(info.fit, `${width}: two-column cards fit the phone`);
    await p.screenshot({ path: path.join(out, `${width}-overview.png`) });
    if (!info.big) { console.log('Baseline has no redesigned overview; recognition checks above are the expected failures.'); await ctx.close(); continue; }
    // Tap the glyph; event goes through to its card.
    const cal = p.locator('.ov-card[data-ov]').filter({ has: p.locator('.sg-calendar') }).first();
    const did = await cal.getAttribute('data-ov'); await cal.tap(); await p.waitForTimeout(500);
    ok(await p.evaluate(did => __wos.desks[__wos.idx].id === did && !document.querySelector('.ov.open'), did), `${width}: tap a sigil opens its desk`);
    await p.evaluate(() => __wos.openOverview()); await p.waitForTimeout(500);
    const music = p.locator('.ov-card[data-ov]').filter({ has: p.locator('.sg-music') }).first();
    await music.focus(); const mid = await music.getAttribute('data-ov'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
    ok(await p.evaluate(id => __wos.desks[__wos.idx].id === id && !document.querySelector('.ov.open'), mid), `${width}: Enter navigates to a card`);
    // Two windows, then four, with real sigils/labels.
    await p.evaluate(() => { __wos.openWin({ app: 'frame', appId: 'calendar' }, { desk: __wos.idx }); __wos.openOverview(); }); await p.waitForTimeout(400);
    ok(await p.evaluate(() => document.querySelector('.ov-card.here .ov-n2')?.querySelectorAll('.ov-symbol').length === 2), `${width}: grouped desk shows both sigils`);
    await p.screenshot({ path: path.join(out, `${width}-pair.png`) });
    await p.evaluate(() => { __wos.closeOverview(); __wos.openWin({ app: 'frame', appId: 'wisdom' }, { desk: __wos.idx }); __wos.openWin({ app: 'frame', appId: 'topics' }, { desk: __wos.idx }); __wos.openOverview(); }); await p.waitForTimeout(500);
    ok(await p.evaluate(() => { const c = document.querySelector('.ov-card.here'); return c.querySelectorAll('.ov-symbol').length === 4 && c.querySelectorAll('.ov-win em').length === 4 && [...c.querySelectorAll('.ov-win')].every(w => w.getBoundingClientRect().bottom <= c.querySelector('.ov-top').getBoundingClientRect().top + 1); }), `${width}: four-window desk preserves labeled sigils without overlap`);
    await p.screenshot({ path: path.join(out, `${width}-quad.png`) });
    // Header Done and Back both return to the same desk, app still open.
    await p.locator('[data-ovdone]').tap(); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !document.querySelector('.ov.open')), `${width}: Done closes overview`);
    await p.evaluate(() => __wos.openOverview()); await p.waitForTimeout(300); await p.evaluate(() => window.__wosNativeBack());
    ok(await p.evaluate(() => !document.querySelector('.ov.open') && !!window.__wos), `${width}: Back closes overview and keeps Wizard open`);
    // Add goes to the real desk with tiles, never launcher sheet.
    const n = await p.evaluate(() => __wos.desks.length); await p.evaluate(() => __wos.openOverview()); await p.waitForTimeout(350);
    await p.locator('[data-ovadd]').tap(); await p.waitForTimeout(500);
    ok(await p.evaluate(n => __wos.desks.length === n + 1 && __wos.idx === n && document.querySelector('.desk[data-desk="' + n + '"] .new-desk') && !document.querySelector('#launcher.open'), n), `${width}: New desk opens a real desk of app tiles`);
    await p.evaluate(() => __wos.openOverview()); await p.waitForTimeout(350);
    ok(await p.evaluate(() => /^\d+ open$/.test(document.querySelector('.ov-head span').textContent) && parseInt(document.querySelector('.ov-head span').textContent) === __wos.desks.filter(d => !d.home && d.wins.length).length), `${width}: open count excludes Home and unpicked empty desk`);
    const empty = p.locator('.ov-card.here [data-ovx]'); await empty.tap(); await p.waitForTimeout(400);
    ok(await p.evaluate(n => __wos.desks.length === n, n), `${width}: close empty card removes only that desk`);
    // Reviews keep their amber cue even when current; long chat titles remain as a caption.
    await p.evaluate(() => { __wos.closeOverview(); __wos.openWin({ app: 'frame', appId: 'wizard-search', from: { sid: 'qa-overview-review', desk: __wos.desks[0].id } }); __wos.openOverview(); });
    await p.waitForTimeout(400);
    ok(await p.evaluate(() => { const c = document.querySelector('.ov-card.here.review'); return !!c?.querySelector('.ov-here') && !!c?.querySelector('.ov-review') && c.getAttribute('aria-label').includes('review'); }), `${width}: review and current desk states are both visible`);
    await p.screenshot({ path: path.join(out, `${width}-review.png`) });
    await p.evaluate(() => { __wos.closeOverview(); __wos.openWin({ app: 'chats', thread: '__new__' }); __wos.openOverview(); });
    await p.waitForTimeout(400);
    ok(await p.evaluate(() => { const c = document.querySelector('.ov-card.here'); return c.querySelector('.ov-top small')?.textContent === 'New chat' && !!c.querySelector('.sg-chats'); }), `${width}: a chat desk retains its thread caption`);
    await p.evaluate(() => document.querySelector('#overview').scrollTop = document.querySelector('#overview').scrollHeight); await p.waitForTimeout(300);
    ok(await p.locator('[data-ovadd]').isVisible() && await p.locator('.ov-hint').isVisible(), `${width}: New desk and the gesture hint are reachable at the bottom`);
    await p.screenshot({ path: path.join(out, `${width}-bottom.png`) });
    ok(!agents, `${width}: zero agent-run attempts`);
    ok(!errs.length, `${width}: no page errors${errs.length ? ' ' + errs.join(';') : ''}`);
    await ctx.close();
  }
  await b.close(); console.log(`${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
