// Wizard OS Home — phone-viewport QA. Usage: node qa.cjs [baseUrl]
const { chromium } = require('/home/telos/node_modules/playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:9271/';
const OUT = process.env.QA_OUT || '/home/telos/apps/wizard-os-home/qa';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const extra = process.env.QA_RESOLVE ? ['--host-resolver-rules=' + process.env.QA_RESOLVE] : [];
  const browser = await chromium.launch({ args: [...extra, '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  // Never send a real message from QA: capture Hermes writes and answer them locally.
  const sent = [];
  await ctx.route('**/wizard/hermes/**', route => {
    const r = route.request(), m = r.method(), u = new URL(r.url());
    if (m === 'GET' || m === 'HEAD') return route.continue();
    sent.push({ m, path: u.pathname, body: r.postDataJSON?.() ?? null, idem: r.headers()['idempotency-key'] || '' });
    if (u.pathname.endsWith('/api/sessions')) return route.fulfill({ status: 200, json: { session: { id: (r.postDataJSON() || {}).id } } });
    if (u.pathname.endsWith('/v1/runs')) return route.fulfill({ status: 202, json: { run_id: 'qa_run', status: 'queued' } });
    return route.abort();
  });
  await ctx.route('**/wizard/thread-seen', route => route.request().method() === 'GET' ? route.continue() : route.fulfill({ status: 200, json: {} }));
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // Shell-only errors: hosted apps (CineQueue posters, Wizard) have their own lifecycles.
  page.on('console', m => { if (m.type() === 'error' && !/422/.test(m.text()) && (!m.location().url || m.location().url.includes('/wizard-os-home/'))) errors.push('console: ' + m.text() + ' @' + m.location().url); });
  page.on('request', r => { const u = new URL(r.url()); if (!BASE.startsWith(u.origin) && r.frame() === page.mainFrame()) external.push(r.url()); });
  const results = [];
  const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); };
  const shot = async n => { await page.screenshot({ path: `${OUT}/${n}.png` }); await page.waitForTimeout(400); };

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wos && window.__wos.live && (window.__wos.live.ok || window.__wos.live.error), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  check('coach shows first run', await page.isVisible('#coach'));
  await shot('00-coach');
  await page.click('#coachGo');
  await page.waitForTimeout(900);
  check('webgl orb', await page.evaluate(() => window.Orb.webgl));
  check('home desk active', await page.evaluate(() => window.__wos.idx === 2));
  const dots = await page.evaluate(() => [document.querySelectorAll('#dotsL .ddot').length, document.querySelectorAll('#dotsR .ddot').length]);
  check('dots 2 left / 2 right on home', dots[0] === 2 && dots[1] === 2, JSON.stringify(dots));
  await shot('01-home');

  let cx = 0, cy = 0;
  // The orb moves (big on home desks, compact on app desks): re-measure before each gesture.
  async function locateOrb() { await page.waitForTimeout(450); const o = await page.locator('#orbWrap').boundingBox(); cx = o.x + o.width / 2; cy = o.y + o.height / 2; }
  await locateOrb();
  async function drag(dx, dy, steps = 10) {
    await locateOrb();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx * i / steps, y: cy + dy * i / steps }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(650);
  }
  // swipe orb left -> next desk (yesterday's review window lives on desk 4 on first run)
  await drag(-150, 0);
  check('swipe left moves to desk 4', await page.evaluate(() => window.__wos.idx === 3));
  const dots2 = await page.evaluate(() => [document.querySelectorAll('#dotsL .ddot').length, document.querySelectorAll('#dotsR .ddot').length]);
  check('dots 3 left / 1 right on desk 4', dots2[0] === 3 && dots2[1] === 1, JSON.stringify(dots2));
  await shot('03-review-day');
  let at = await page.evaluate(() => window.__wos.idx);

  // pinch out on review -> week
  async function pinch(scale) {
    const st = await page.locator('.desk[data-desk="3"] .zstage').boundingBox();
    const mx = st.x + st.width / 2, my = st.y + 220, d0 = scale > 1 ? 40 : 150, d1 = d0 * scale;
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mx - d0 / 2, y: my, id: 1 }, { x: mx + d0 / 2, y: my, id: 2 }] });
    for (let i = 1; i <= 10; i++) { const d = d0 + (d1 - d0) * i / 10; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mx - d / 2, y: my, id: 1 }, { x: mx + d / 2, y: my, id: 2 }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(700);
  }
  const lvl = () => page.evaluate(() => { const w = window.__wos.wins; const id = window.__wos.desks[3].wins.find(x => w[x].app === 'review'); return w[id].z.level; });
  await pinch(0.35); check('pinch in-to-out: day -> week', (await lvl()) === 'week', await lvl());
  await shot('04-review-week');
  await pinch(0.35); check('pinch: week -> month', (await lvl()) === 'month', await lvl());
  await shot('05-review-month');
  await pinch(3.2); check('pinch open: month -> week', (await lvl()) === 'week', await lvl());
  // tap a day card to dive
  await page.locator('.desk[data-desk="3"] .zlayer:last-child [data-z]').first().click(); await page.waitForTimeout(700);
  check('tap dives week -> day', (await lvl()) === 'day', await lvl());
  await page.locator('.desk[data-desk="3"] .zlayer:last-child [data-z]').first().click(); await page.waitForTimeout(700);
  check('tap dives day -> focus', (await lvl()) === 'group', await lvl());
  await shot('06-review-focus');
  await page.locator('.desk[data-desk="3"] .zlayer:last-child [data-z]').first().click(); await page.waitForTimeout(700);
  check('tap dives focus -> thread', (await lvl()) === 'thread', await lvl());
  await shot('07-review-thread');
  await page.locator('.desk[data-desk="3"] .crumb [data-crumb="0"]').click(); await page.waitForTimeout(700);
  check('breadcrumb jumps back to month', (await lvl()) === 'month', await lvl());

  // swipe up -> launcher
  await drag(0, -260);
  check('swipe up opens launcher', await page.evaluate(() => document.querySelector('#launcher').classList.contains('open')));
  await shot('08-launcher');
  await page.fill('#search', 'cine'); await page.waitForTimeout(200);
  await shot('09-launcher-search');
  await page.press('#search', 'Enter'); await page.waitForTimeout(800);
  const d = await page.evaluate(() => { const s = window.__wos, dk = s.desks[s.idx]; return { idx: s.idx, wins: dk.wins.map(x => s.wins[x].app + ':' + (s.wins[x].appId || '')) }; });
  check('search+enter opens CineQueue as a window, tiled beside the review', d.wins.includes('frame:cinequeue') && d.wins.length === 2, JSON.stringify(d));
  const ob = await page.locator('#orbWrap').boundingBox();
  check('orb stays big and centred with apps open', Math.abs(ob.x + ob.width / 2 - 393 / 2) < 3 && ob.width >= 80, JSON.stringify(ob));
  await page.waitForTimeout(2500); await shot('09b-cinequeue-desk');

  // swipe down -> inbox (from the home desk, where the big orb lives)
  await page.evaluate(() => window.__wos.goDesk(2, true)); await page.waitForTimeout(600);
  await drag(0, 260);
  check('swipe down opens inbox', await page.evaluate(() => document.querySelector('#inbox').classList.contains('open')));
  await shot('10-inbox');
  await drag(0, -120);
  check('swipe up on orb closes inbox', await page.evaluate(() => !document.querySelector('#inbox').classList.contains('open')));

  // go home, tap orb -> recording with arc
  await page.evaluate(() => window.__wos.goDesk(2, true)); await page.waitForTimeout(600);
  await locateOrb(); await page.touchscreen.tap(cx, cy); await page.waitForTimeout(1600);
  check('tap orb starts recording', await page.evaluate(() => window.__wos.voice === 'listen'), await page.evaluate(() => window.__wos.voice));
  check('arc buttons visible', await page.evaluate(() => document.querySelector('#voice').classList.contains('on')));
  check('timer counting', (await page.textContent('#timer')) !== '0:00', await page.textContent('#timer'));
  await shot('11-recording');
  await page.click('#arcPause'); await page.waitForTimeout(400);
  check('pause works', await page.evaluate(() => window.__wos.voice === 'paused'));
  await shot('12-paused');
  await page.click('#arcCancel'); await page.waitForTimeout(400);
  check('cancel returns idle', await page.evaluate(() => window.__wos.voice === 'idle'));

  check('tapping the orb leaves the route on Auto', await page.evaluate(() => localStorage.getItem('wos.route')) === '"auto"', await page.evaluate(() => localStorage.getItem('wos.route')));
  // Typed command through real router (DeepSeek Flash) — natural phrasing not caught by local parser
  await page.evaluate(() => window.__wos.runUtterance('can you get me to the Bangkok airport', 'auto', true));
  await page.waitForFunction(() => /DeepSeek|on-device|Archimedes/.test(document.querySelector('#txRouteText').textContent) && !/Routing/.test(document.querySelector('#txRouteText').textContent), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const rt = await page.textContent('#txRouteText');
  const md = await page.evaluate(() => { const s = window.__wos; return s.desks[s.idx].wins.map(x => s.wins[x]).find(w => w.app === 'maps') || null; });
  check('router -> maps directions', md && md.mode === 'dir', rt + ' ' + JSON.stringify(md));
  await shot('13-voice-maps');
  await page.waitForTimeout(2200);

  // agent route
  await page.evaluate(() => { const s = window.__wos; [...s.desks[4].wins].forEach(id => s.closeWin(id)); s.goDesk(4, true); }); await page.waitForTimeout(500);
  await page.evaluate(() => window.__wos.runUtterance('what should I prioritize for the Wizard OS launch next week?', 'auto', true));
  await page.waitForFunction(() => /Archimedes/.test(document.querySelector('#txRouteText').textContent), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.waitForTimeout(1200);
  const ad = await page.evaluate(() => { const s = window.__wos; return s.desks[4].wins.map(x => s.wins[x]); });
  const run = sent.find(s => s.path.endsWith('/v1/runs')), ses = sent.find(s => s.path.endsWith('/api/sessions'));
  check('reasoning request creates a real Wizard thread request', !!ses && ses.body?.source === 'wizard-mobile' && /^wizard_\d+_[0-9a-f]{12}$/.test(ses.body?.id || ''), JSON.stringify(ses?.body));
  check('run admitted with idempotency key and same session', !!run && run.body?.session_id === ses?.body?.id && run.idem.length >= 32 && /prioritize/.test(run.body?.input || ''), JSON.stringify(run?.body));
  check('the reply opens as a Chats window on that thread', ad.some(w => w.app === 'chats' && w.thread === ses?.body?.id), JSON.stringify(ad));
  check('send carries view context for Archimedes', typeof run?.body?.instructions === 'string' && /Wizard OS/.test(run.body.instructions), (run?.body?.instructions || '').slice(0, 160));
  await shot('14-agent');

  // hold for command (fake mic)
  await page.evaluate(() => window.__wos.goDesk(2, true)); await page.waitForTimeout(800); await locateOrb();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await page.waitForTimeout(900);
  check('hold enters command mode', await page.evaluate(() => window.__wos.voice === 'command'));
  await shot('15-hold-command');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);

  check('no page errors', errors.length === 0, errors.join(' | '));
  check('no external requests', external.length === 0, external.slice(0, 3).join(' '));
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ base: BASE, results, errors, external }, null, 2));
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
