// Mizel.ai inside Wizard OS Home: the Mizel desk frame loads the canonical Mizel Live view.
const { chromium } = require('/home/telos/node_modules/playwright');
const URL_ = 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP wizard.tailc0f369.ts.net 127.0.0.1:18443'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET' && /\/v1\/runs|\/wizard\/hermes/.test(q.url())) return r.fulfill({ status: 200, body: '{}' }); return r.continue(); });
  const p = await ctx.newPage();
  // Seed a phone that already has a Mizel desk saved on the retired /meetings/ view.
  await p.addInitScript(() => { try {
    if (sessionStorage.getItem('qa-seeded')) return; sessionStorage.setItem('qa-seeded', '1');
    localStorage.setItem('wos.coached', 'true'); localStorage.removeItem('wux.apps.v1');
    const W = { w1: { id: 'w1', app: 'frame', appId: 'mizel', url: '/meetings/' } };
    const desks = [0, 1, 2, 3, 4].map(i => ({ wins: i === 4 ? ['w1'] : [], focus: i === 4 ? 'w1' : null, full: false }));
    localStorage.setItem('wos.wins', JSON.stringify(W)); localStorage.setItem('wos.desks3', JSON.stringify(desks)); localStorage.setItem('wos.layoutV', '2');
  } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos, null, { timeout: 30000 });
  await p.waitForTimeout(2000);
  // Swipe right through the desks until the Mizel frame mounts (it sits at HOME + 2).
  for (let i = 0; i < 4; i++) {
    const has = await p.evaluate(() => [...document.querySelectorAll('iframe')].some(f => /mizel|meetings/.test(f.getAttribute('src') || '')));
    if (has) break;
    await p.mouse.move(360, 400); await p.mouse.down(); await p.mouse.move(60, 405, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(900);
  }
  const dbg = await p.evaluate(() => ({ apps: (JSON.parse(localStorage.getItem('wux.apps.v1') || '[]') || []).filter(a => a.id === 'mizel'), mizelTile: (window.WizApps && JSON.stringify(Object.keys(window.WizApps))) || null, wins: localStorage.getItem('wos.wins'), frames: [...document.querySelectorAll('iframe')].map(f => f.getAttribute('src')), deskWins: [...document.querySelectorAll('.desk')].map(d => d.querySelectorAll('.win').length) }));
  console.log('DEBUG', JSON.stringify(dbg).slice(0, 900));
  const src = await p.evaluate(() => [...document.querySelectorAll('iframe')].map(f => f.getAttribute('src') || '').filter(s => /mizel|meetings/.test(s)));
  ok(src.some(s => s.includes('/mizel-live/')), 'Mizel desk frame points at /mizel-live/', JSON.stringify(src));
  ok(!src.some(s => s.includes('/meetings/')), 'old /meetings/ view no longer framed', JSON.stringify(src));
  const fr = p.frames().find(f => f.url().includes('/mizel-live/'));
  if (fr) {
    await fr.waitForSelector('#app', { timeout: 20000 }).catch(() => {});
    const t = await fr.evaluate(() => document.title).catch(() => '');
    ok(!!t, 'Mizel Live renders inside the frame', t);
    const port = await fr.evaluate(() => typeof window.wizardMizelPort).catch(() => 'err');
    console.log('INFO wizardMizelPort in plain browser:', port, '(expected undefined outside the Android app)');
  } else ok(false, 'Mizel Live frame loaded');
  await p.screenshot({ path: '/home/developer/apps/wizard-os-home/qa-live/mizel-desk.png' });
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
