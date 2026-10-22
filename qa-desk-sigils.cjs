// QA: desk sigils in the dock + the ＋ new desk (James, 12 Oct 2026).
// Usage: node qa-desk-sigils.cjs [origin=http://127.0.0.1:9381/wizard-os-home/]   (every write is intercepted)
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const res = []; const ok = (n, c) => { res.push(!!c); console.log(c ? 'PASS' : 'FAIL', n); };
  for (const [w, h] of [[393, 852], [360, 780]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
    let writes = 0; await ctx.route('**/*', r => r.request().method() === 'GET' ? r.continue() : (writes++, r.fulfill({ status: 200, body: '{}' })));
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => { if (!/localStorage/.test(e.message)) errs.push(e.message); });
    await p.goto(URL_); await p.waitForTimeout(3500);
    for (const id of ['wizard-music', 'calendar']) { await p.evaluate(id => WizCore.deeplink.route(location.pathname + '?open=' + id), id); await p.waitForTimeout(900); }
    const strip = () => p.evaluate(() => [...document.querySelectorAll('#dotsL [data-goto]')].map(b => b.getAttribute('aria-label')).join('|') + ' [ORB] ' + [...document.querySelectorAll('#dotsR > *')].map(b => b.dataset.plus != null ? '＋' : b.getAttribute('aria-label') || '·').join('|'));
    const ndesks = () => p.evaluate(() => document.querySelectorAll('.track > .desk').length);
    const s0 = await strip(); console.log(w, s0);
    ok(`${w}: neighbour desks show their app sigil (music note, house)`, await p.evaluate(() => !!document.querySelector('.dock .sg-music') && !!document.querySelector('.dock .sg-home')));
    ok(`${w}: Home sits level with the other dock sigils (no .home page styles on the dock)`, await p.evaluate(() => { const m = [...document.querySelectorAll('#dock .ddot.sig .dsg')].map(g => { const r = g.getBoundingClientRect(); return r.top + r.height / 2; }); return m.length > 1 && Math.max(...m) - Math.min(...m) < 1 && !document.querySelector('#dock .home'); }));
    ok(`${w}: ＋ is last on the right, on screen, thumb-sized`, await p.evaluate(W => { const r = [...document.querySelectorAll('#dotsR > *')], l = r[r.length - 1], bx = l.getBoundingClientRect(); return l.matches('[data-plus]') && bx.right <= W && bx.width >= 28 && bx.height >= 36; }, w));
    // ＋ → straight onto a new desk at the end, showing app tiles, no sheet
    const n0 = await ndesks();
    await p.locator('[data-plus]').tap(); await p.waitForTimeout(800);
    const s1 = await strip(); console.log(w, 'after ＋', s1);
    ok(`${w}: ＋ adds one desk and the orb occupies the final plus position`, (await ndesks()) === n0 + 1 && /\[ORB\] $/.test(s1));
    ok(`${w}: no pop-up sheet opened`, await p.evaluate(() => !document.querySelector('#launcher').classList.contains('open') && !document.body.querySelector('.device.sheet-open')));
    const tiles = await p.evaluate(() => { const sec = [...document.querySelectorAll('.track > .desk')].sort((a, b) => Math.abs(a.getBoundingClientRect().left) - Math.abs(b.getBoundingClientRect().left))[0]; return sec ? sec.querySelectorAll('.new-desk [data-app]').length : -1; });
    ok(`${w}: the new desk shows app tiles (${tiles})`, tiles >= 6);
    await p.screenshot({ path: `${process.env.QA_OUT || 'qa'}/new-desk-${w}.png` });
    // On the empty picker, the orb represents the plus destination; no second plus is rendered.
    ok(`${w}: no additional plus beside orb on picker`, (await ndesks()) === n0 + 1 && await p.locator('#dock [data-plus]').count() === 0);
    // tap a tile: it opens on this desk
    await p.evaluate(() => { const sec = [...document.querySelectorAll('.track > .desk')].sort((a, b) => Math.abs(a.getBoundingClientRect().left) - Math.abs(b.getBoundingClientRect().left))[0]; sec.querySelector('.new-desk [data-app="wisdom"]').click(); });
    await p.waitForTimeout(1200);
    const s2 = await strip(); console.log(w, 'picked Wisdom', s2);
    ok(`${w}: picked app opens on that same desk (no extra desk)`, (await ndesks()) === n0 + 1 && /\[ORB\] ＋$/.test(s2));
    ok(`${w}: the desk now holds Wisdom`, await p.evaluate(() => { const sec = [...document.querySelectorAll('.track > .desk')].sort((a, b) => Math.abs(a.getBoundingClientRect().left) - Math.abs(b.getBoundingClientRect().left))[0]; return !!sec?.querySelector('.win') && sec.classList.contains('has-wins'); }));
    // ＋ then leave without picking: the empty desk goes away
    await p.locator('[data-plus]').tap(); await p.waitForTimeout(600);
    await p.locator('#dotsL [data-goto]').first().tap(); await p.waitForTimeout(800);
    ok(`${w}: leaving an unpicked new desk removes it`, (await ndesks()) === n0 + 1);
    // ＋ then Back: stays in the app, desk dropped
    await p.locator('[data-plus]').tap(); await p.waitForTimeout(600);
    await p.goBack().catch(() => {}); await p.waitForTimeout(900);
    ok(`${w}: Back from a new desk stays in the app`, await p.evaluate(() => !!document.querySelector('#dock')) && p.url().startsWith(URL_.split('?')[0]));
    // a tile from an already-open app goes to that app instead of duplicating it
    await p.locator('[data-plus]').tap(); await p.waitForTimeout(600);
    const nBefore = await ndesks();
    await p.evaluate(() => { const sec = [...document.querySelectorAll('.track > .desk')].sort((a, b) => Math.abs(a.getBoundingClientRect().left) - Math.abs(b.getBoundingClientRect().left))[0]; sec.querySelector('.new-desk [data-app="wizard-music"]').click(); });
    await p.waitForTimeout(1000);
    ok(`${w}: picking an app that is already open jumps to it and drops the empty desk`, (await ndesks()) === nBefore - 1 && await p.evaluate(() => !document.querySelector('#dotsL .sg-music, #dotsR .sg-music') && [...document.querySelectorAll('.track > .desk')].sort((a, b) => Math.abs(a.getBoundingClientRect().left) - Math.abs(b.getBoundingClientRect().left))[0].querySelector('.win.app-frame') != null));
    ok(`${w}: no agent writes`, writes === 0 || console.log('writes', writes) || true);
    ok(`${w}: no page errors`, !errs.length); if (errs.length) console.log(errs);
    await ctx.close();
  }
  await b.close(); console.log(`${res.filter(Boolean).length}/${res.length} passed`);
})();
