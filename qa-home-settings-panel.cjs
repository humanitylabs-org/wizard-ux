// James, 31 Oct 2026: on desktop, Settings opened from Home stays on Home as a centred panel; it never switches to a
// desk and tiles a Settings window beside Chats. Usage: node qa-home-settings-panel.cjs <origin>/wizard-os-home/
const { chromium } = require('./tools/qa-playwright.cjs');
const ORIGIN = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const SHOT = process.env.QA_SHOT || '', SKIN = process.env.QA_SKIN || '';
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  let writes = 0;
  await ctx.route('**/*', r => { const m = r.request().method(); if (m !== 'GET' && m !== 'HEAD') { writes++; return r.fulfill({ status: 403, body: '{}' }); } return r.continue(); });
  await ctx.addInitScript(skin => { try { if (!sessionStorage.qaSeeded) { localStorage.setItem('wux.desk.homeOpen', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.coached', '1'); if (skin) localStorage.setItem('wos.skin', skin); sessionStorage.qaSeeded = 1; } } catch {} }, SKIN);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(ORIGIN + 'desktop.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-home-settings]', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(1500);
  const before = await p.evaluate(() => ({ wins: document.querySelectorAll('.win').length, home: !!document.querySelector('[data-home-settings]')?.getClientRects().length }));
  ok(before.home, 'Home is in front with its Settings button');
  await p.click('[data-home-settings]');
  await p.waitForTimeout(800);
  const after = await p.evaluate(() => {
    const s = document.getElementById('dsettings'), r = s?.getBoundingClientRect();
    return { modal: !!s?.classList.contains('is-modal'), shown: !!s && !s.hidden && r.width > 0, inBody: s?.parentNode === document.body,
      wins: document.querySelectorAll('.win').length, settingsWin: !!document.querySelector('.win .settings-host'),
      home: !!document.querySelector('[data-home-settings]')?.getClientRects().length,
      scrim: !!document.querySelector('.dsettings-scrim:not([hidden])') };
  });
  if (SHOT) await p.screenshot({ path: SHOT });
  ok(after.shown && after.modal && after.inBody, 'Settings shows as the centred panel over Home');
  ok(!after.settingsWin && after.wins === before.wins, `no Settings window was tiled on a desk (windows ${before.wins} → ${after.wins})`);
  ok(after.home, 'Home is still behind the panel (no switch to Chats)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  const closed = await p.evaluate(() => ({ hidden: document.getElementById('dsettings').hidden, home: !!document.querySelector('[data-home-settings]')?.getClientRects().length }));
  ok(closed.hidden && closed.home, 'Esc closes it and leaves Home in front');
  ok(writes === 0, 'zero agent writes');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
  console.log(`${pass}/${pass + fail}`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
