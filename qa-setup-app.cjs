// QA: Setup app (web/setup/, core/setup-launch.js) against the fake Setup API (tools/fake-setup-api.cjs).
// Design: Claude Fable (two rounds, 14 Oct 2026). Covers, on the phone layout and the desktop window layout:
//   first-run auto-open exactly once + seen POSTed once, the tour held until the first return Home, deep-link launch,
//   every phone-API state (unavailable, off, signin, https, serving, phone_seen, error, 500, 401, 403, 404),
//   sign-in start flow (1 s polling, auth_url opened outside exactly once, anchor fallback never POSTs),
//   QR codes decoded from real rendered pixels (jsQR) to the exact URL, copyable URL rows,
//   polling only while the phone screen is on screen, Back never exits (layers → checklist → shell/Home),
//   every live skin with transparent canvas like Chats, the disconnect menu + sheet, no private strings, no window.open.
// Usage: node tools/fake-setup-api.cjs 9473 & node qa-setup-app.cjs [http://127.0.0.1:9473/wizard-os-home/]
//   env: QA_SHOTS=<dir> for screenshots, QA_JSQR=<path to jsqr module>.
let pw; try { pw = require(process.env.QA_PLAYWRIGHT || 'playwright'); } catch (e) { pw = require('playwright-core'); }
const jsQR = require(process.env.QA_JSQR || 'jsqr');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:9473/wizard-os-home/';
const ORIGIN = new URL(BASE).origin;
const SHOTS = process.env.QA_SHOTS || path.join(process.env.TMPDIR || process.cwd(), 'setup-app-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const results = [];
const ok = (c, n, x = '') => { results.push({ ok: !!c, name: n }); if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, typeof x === 'string' ? x : JSON.stringify(x)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fake = async (body) => (await fetch(ORIGIN + '/__fake/state', { method: 'POST', body: JSON.stringify(body) })).json();
const fakeReset = async () => (await fetch(ORIGIN + '/__fake/reset', { method: 'POST' })).json();
const fakeLog = async () => (await fetch(ORIGIN + '/__fake/log')).json();
const count = (log, method, p, since = 0) => log.filter(e => e.method === method && e.path === p && e.t >= since).length;
const URLS = { install: 'https://tailscale.com/download', wiz: 'https://wizard.tail1234.ts.net/', auth: 'https://login.tailscale.com/a/example-sign-in', https: 'https://login.tailscale.com/f/serve?node=example' };
const shot = async (p, name) => { const f = path.join(SHOTS, name + '.png'); await p.screenshot({ path: f }); return f; };

async function context(b, mode, { coached = true, extra = {} } = {}) {
  const opts = mode === 'phone'
    ? { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
  const ctx = await b.newContext({ ...opts, ...extra });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  const T = { outside: [], errors: [] };
  await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.origin === ORIGIN) return r.continue(); T.outside.push(u.href); return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>outside</title>' }); });
  await ctx.addInitScript(([coached, shell]) => {
    try { localStorage.setItem('wux.shell', shell); if (coached) { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); } } catch (e) {}
    addEventListener('error', e => { (window.top.__qaErr = window.top.__qaErr || []).push(location.pathname + ': ' + e.message); });
    addEventListener('unhandledrejection', e => { (window.top.__qaErr = window.top.__qaErr || []).push(location.pathname + ': ' + String(e.reason)); });
  }, [coached, mode]);
  const p = await ctx.newPage();
  p.on('pageerror', e => T.errors.push(String(e)));
  return { ctx, p, T };
}
const setupFrame = p => p.frames().find(f => /\/setup\/(index\.html)?(\?|#|$)/.test(f.url()));
async function waitFrame(p, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const f = setupFrame(p); if (f) { try { await f.waitForFunction(() => !!window.__setup, null, { timeout: 5000 }); return f; } catch (e) {} } await sleep(150); } return null; }
const fs_ = (f) => f.evaluate(() => ({ screen: __setup.state.screen, polling: __setup.polling, inView: __setup.inView, layout: __setup.layout, phone: __setup.state.phone.status, step: __setup.state.phone.data?.step || '' }));
const txt = (f, sel) => f.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(e => e.textContent.trim()).join(' | '), sel);
const glyphs = f => f.evaluate(() => [...document.querySelectorAll('#phone .step')].map(s => s.querySelector('.gl')?.dataset.g));
async function waitStep(f, step, extra = '') { try { await f.waitForFunction(([s, e]) => __setup.state.phone.data?.step === s && !__setup.state.starting && (!e || !!document.querySelector(e)), [step, extra], { timeout: 8000 }); return true; } catch (e) { return false; } }
async function decodeQR(page, b, el) {
  const png = await el.screenshot();
  const tmp = await b.newPage();
  const img = await tmp.evaluate(async b64 => { const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return { w: i.width, h: i.height, d: Array.from(x.getImageData(0, 0, i.width, i.height).data) }; }, png.toString('base64'));
  await tmp.close();
  const r = jsQR(new Uint8ClampedArray(img.d), img.w, img.h);
  return r ? r.data : null;
}
const shellBack = p => p.evaluate(() => window.__wosNativeBack());
const setupWin = p => p.evaluate(() => { const w = Object.values(__wos.wins).find(w => w.app === 'frame' && w.appId === 'setup'); return w ? { id: w.id, desk: __wos.desks.findIndex(d => d.wins.includes(w.id)), idx: __wos.idx } : null; });

(async () => {
  const b = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  /* ================= static ================= */
  {
    const root = __dirname, read = f => fs.readFileSync(path.join(root, f), 'utf8');
    const files = ['web/setup/index.html', 'web/setup/setup.js', 'web/setup/setup.css', 'web/core/setup-launch.js', 'tools/fake-setup-api.cjs', 'web/setup/provenance.json'];
    const bad = ['wizard0' + '01', 'tailc0' + 'f369', 'Ja' + 'mes'];
    const hits = files.flatMap(f => bad.filter(w => read(f).includes(w)).map(w => f + ':' + w));
    ok(!hits.length, 'no private addresses or owner names in Setup files', hits.join(' '));
    ok(!/window\.open\s*\(/.test(read('web/setup/setup.js')), 'Setup never calls window.open (links leave through anchors the shell routes outside)');
    // Outside :root (where each --wz-* token gets its Nebula fallback) the only literal colours are the white QR tile
    // and the ok/warn glyph colours; everything else reads the shell's tokens.
    const css = read('web/setup/setup.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[\s\S]*?\n\}/, '').replace(/var\(--wz-[a-z-]+,\s*#[0-9a-f]+\)/gi, '');
    const own = (css.match(/#[0-9a-f]{3,8}\b/gi) || []).filter(c => !/^#(fff)$/i.test(c));
    ok(!own.length, 'stylesheet colours: shell tokens (with fallbacks) + --setup-ok/--setup-warn + the white QR tile only', own.join(' '));
    const prov = JSON.parse(read('web/setup/provenance.json'));
    const sha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'web/setup/vendor/qrcode.js'))).digest('hex');
    ok(prov.license === 'MIT' && prov.copiedSources[0].sha256 === sha && fs.existsSync(path.join(root, 'web/setup/vendor/LICENSE-qrcode-generator')), 'vendored QR library matches its provenance record (MIT, sha256)');
  }

  /* ================= phone: first run ================= */
  await fakeReset(); await fake({ owner: 'Robin' });
  {
    const { ctx, p, T } = await context(b, 'phone', { coached: false });
    await p.goto(BASE + '?shell=phone', { waitUntil: 'load' });
    const f = await waitFrame(p);
    ok(!!f, 'phone first run: Setup opens by itself');
    const w = await setupWin(p);
    ok(w && w.desk === w.idx && w.idx !== 0, 'phone first run: Setup is the desk in front (not Home)', w);
    await f.waitForFunction(() => document.querySelector('.greet'), null, { timeout: 8000 }).catch(() => {});
    ok(await txt(f, '.greet') === 'Hi Robin. One thing to set up for now.', 'greeting uses the owner name from settings', await txt(f, '.greet'));
    await sleep(1500);
    let log = await fakeLog();
    ok(count(log, 'POST', '/wizard/v1/setup/seen') === 1, 'seen POSTed exactly once (by the app)', count(log, 'POST', '/wizard/v1/setup/seen'));
    ok(!(await p.evaluate(() => WosTour.active)), 'the tour does not start while Setup is in front');
    ok((await txt(f, '.foot')).includes('The 30-second tour starts when you go back to Home.'), 'footer says the tour starts back on Home', await txt(f, '.foot'));
    ok(await f.locator('[data-act="tour"]').isVisible(), 'phone layout shows "Show the 30-second tour"');
    console.log('shot', await shot(p, 'phone-01-checklist-first-run'));
    // Back contract: phone screen → checklist → Home; never exits.
    await f.locator('[data-act="open-phone"]').tap();
    await waitStep(f, 'off');
    const r1 = await shellBack(p); await sleep(400);
    let st = await fs_(f), sw = await setupWin(p);
    ok(r1 === 'hosted' && st.screen === 'list' && sw && sw.idx === sw.desk, 'Back on the phone screen → checklist, Setup still open', { r1, st, sw });
    const r2 = await shellBack(p); await sleep(300);
    sw = await setupWin(p);
    ok(r2 === 'home' && sw && sw.idx === 0, 'Back at the checklist → the shell goes Home; Setup window kept', { r2, sw });
    await p.waitForFunction(() => WosTour.active, null, { timeout: 4000 }).catch(() => {});
    ok(await p.evaluate(() => WosTour.active && WosTour.step === 1), 'the held tour starts on the first return Home');
    console.log('shot', await shot(p, 'phone-02-tour-after-setup'));
    await p.evaluate(() => WosTour.finish('skip')); await sleep(400);
    await p.evaluate(d => __wos.goDesk(d), sw.desk); await sleep(900);
    ok(!(await txt(f, '.foot')).includes('tour starts'), 'footer reverts once the tour has run', await txt(f, '.foot'));
    await p.evaluate(() => __wos.goDesk(0)); await sleep(1300);
    ok(!(await p.evaluate(() => WosTour.active)), 'the tour does not run twice');
    const back3 = await shellBack(p); await sleep(300);
    ok((back3 === null || back3 === 'root') && await p.evaluate(() => !!document.querySelector('#device') && (window.__backLog || []).slice(-1)[0] === 'native:root'), 'Back at the true root: stays put, the shell is still here', back3);
    // Second launch: first_run is now false → no auto-open.
    const t0 = Date.now();
    await p.goto(BASE, { waitUntil: 'load' }); await sleep(3500);
    const ll = await p.evaluate(() => WosSetupLaunch.log);
    log = await fakeLog();
    ok(ll.includes('first_run:false') && !ll.includes('open') && count(log, 'POST', '/wizard/v1/setup/seen') === 1, 'second launch: Setup does not auto-open again', ll);
    ok(!T.errors.length && !(await p.evaluate(() => window.__qaErr || [])).length, 'phone first run: no page errors', T.errors.concat(await p.evaluate(() => window.__qaErr || [])));
    await ctx.close();
  }

  /* ================= phone: deep-link launch + tour link ================= */
  await fakeReset();
  {
    const { ctx, p } = await context(b, 'phone', { coached: false });
    await p.goto(BASE + '?shell=phone&view=chats', { waitUntil: 'load' }); await sleep(3500);
    const ll = await p.evaluate(() => WosSetupLaunch.log), log = await fakeLog();
    ok(ll.includes('deeplink') && !setupFrame(p) && !(await p.evaluate(() => WosTour.active)) && count(log, 'POST', '/wizard/v1/setup/seen') === 0, 'deep-link launch keeps the asked-for place: no Setup, no tour, seen not posted', ll);
    await p.evaluate(() => __wos.openApp(WizCore.apps('mobile').APP.setup)); const f = await waitFrame(p);
    await f.waitForFunction(() => document.querySelector('[data-act="tour"]'), null, { timeout: 8000 });
    ok(await txt(f, '.greet') === 'One thing to set up for now.', 'manual open before first run is consumed: greeting without a name');
    await sleep(800);
    ok(count(await fakeLog(), 'POST', '/wizard/v1/setup/seen') === 1, 'manual open posts seen');
    await f.locator('[data-act="tour"]').tap();
    await p.waitForFunction(() => WosTour.active, null, { timeout: 4000 }).catch(() => {});
    const sw = await setupWin(p);
    ok(await p.evaluate(() => WosTour.active && __wos.idx === 0) && sw && sw.desk > 0, '"Show the 30-second tour" runs the tour on Home; Setup stays on its desk', sw);
    await p.evaluate(() => WosTour.finish('skip'));
    await ctx.close();
  }

  /* ================= phone: the tour is unchanged when Setup has nothing to say ================= */
  for (const [label, body] of [['first_run false', { firstRun: false }], ['old box without the Setup API (404)', { fail: { '/wizard/v1/setup': 404 } }]]) {
    await fakeReset(); await fake(body);
    const { ctx, p, T } = await context(b, 'phone', { coached: false });
    await p.goto(BASE + '?shell=phone', { waitUntil: 'load' });
    await p.waitForFunction(() => WosTour.active, null, { timeout: 6000 }).catch(() => {});
    ok(await p.evaluate(() => WosTour.active && WosTour.step === 1 && __wos.idx === 0) && !setupFrame(p) && count(await fakeLog(), 'POST', '/wizard/v1/setup/seen') === 0, `${label}: fresh phone gets the first-run tour on Home as before; Setup stays closed`);
    ok(!T.errors.length, `${label}: no page errors`, T.errors);
    await ctx.close();
  }

  /* ================= phone: every state ================= */
  await fakeReset(); await fake({ firstRun: false, startDelayMs: 2500 });
  {
    const { ctx, p, T } = await context(b, 'phone');
    await p.goto(BASE + '?shell=phone', { waitUntil: 'load' }); await sleep(1500);
    await p.evaluate(() => __wos.openApp(WizCore.apps('mobile').APP.setup)); const f = await waitFrame(p);
    await f.waitForFunction(() => document.querySelector('[data-act="open-phone"]'), null, { timeout: 8000 });
    ok(!(await f.locator('.greet').count()), 'no greeting after first run');
    ok(await f.evaluate(() => document.querySelector('.row small').textContent) === 'From anywhere, not just at home.', 'checklist row: todo line');
    await f.locator('[data-act="open-phone"]').tap();
    ok(await waitStep(f, 'off'), 'phone screen loads (off)');
    let g = await glyphs(f);
    ok(g.join() === 'todo,todo,locked', 'off: step 1 todo, step 2 open, step 3 locked', g);
    ok(await f.locator('[data-act="start"]').innerText() === 'Sign in with Tailscale' && !(await f.locator('[data-act="menu"]').count()), 'off: "Sign in with Tailscale", no overflow menu');
    ok(!(await f.locator('.qr').count()) && await f.locator('[data-step="2"] a[data-out]').getAttribute('href') === URLS.install, 'phone layout: no QR codes; "Get Tailscale" links to the install page');
    ok(await f.evaluate(() => document.querySelector('[data-step="2"] .url .u').textContent) === 'tailscale.com/download', 'step 2 shows the install address as copyable text');
    console.log('shot', await shot(p, 'phone-03-off'));
    // Polling cadence + stop when hidden.
    let t = Date.now(); await sleep(5000);
    let n = count(await fakeLog(), 'GET', '/wizard/v1/setup/phone', t);
    ok(n >= 2 && n <= 4, 'polls every 2 s while the phone screen is visible', n);
    const sw = await setupWin(p);
    await p.evaluate(() => __wos.goDesk(0)); await sleep(300); t = Date.now(); await sleep(4500);
    n = count(await fakeLog(), 'GET', '/wizard/v1/setup/phone', t);
    ok(n === 0 && !(await fs_(f)).polling, 'polling stops when Setup is on another desk', n);
    t = Date.now(); await p.evaluate(d => __wos.goDesk(d), sw.desk);
    let back1 = 0; while (Date.now() - t < 4000) { const e = (await fakeLog()).find(e => e.method === 'GET' && e.path === '/wizard/v1/setup/phone' && e.t >= t); if (e) { back1 = e.t - t; break; } await sleep(100); }
    ok(back1 > 0 && back1 <= 1500, 'coming back to the desk fetches at once (no 2 s wait)', back1 + ' ms');
    await f.evaluate(() => { Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    t = Date.now(); await sleep(4500);
    ok(count(await fakeLog(), 'GET', '/wizard/v1/setup/phone', t) === 0, 'polling stops while the page is hidden');
    await f.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(600);
    // Start flow.
    t = Date.now();
    await f.locator('[data-act="start"]').tap(); await sleep(250);
    ok(!(await f.locator('[data-act="start"]').count()) && (await txt(f, '[data-step="1"] p')) === 'Getting the sign-in page ready…' && (await glyphs(f))[0] === 'working', 'tap: button hidden, "Getting the sign-in page ready…", working glyph');
    await sleep(2000);
    const fast = count(await fakeLog(), 'GET', '/wizard/v1/setup/phone', t);
    ok(fast >= 2, 'while starting it polls every second', fast);
    ok(await waitStep(f, 'signin', '[data-step="1"] a[data-out]'), 'auth_url arrives → sign-in state');
    await sleep(600);
    const opened = T.outside.filter(u => u === URLS.auth).length;
    ok(opened === 1, 'the sign-in page is opened outside exactly once', T.outside);
    const a = f.locator('[data-step="1"] a[data-out]');
    ok(await a.innerText() === 'Open the sign-in page' && await a.getAttribute('href') === URLS.auth && await a.getAttribute('target') === '_blank', 'signin: "Open the sign-in page" is a real new-tab link to auth_url');
    ok((await txt(f, '[data-step="1"] p')).startsWith('Sign in on the Tailscale page, then come back here.'), 'signin copy');
    console.log('shot', await shot(p, 'phone-04-signin'));
    const starts0 = count(await fakeLog(), 'POST', '/wizard/v1/setup/phone/start');
    await a.tap(); await sleep(800);
    ok(count(await fakeLog(), 'POST', '/wizard/v1/setup/phone/start') === starts0 && T.outside.filter(u => u === URLS.auth).length === 2 && setupFrame(p), 'tapping the link opens it again outside, no POST, Wizard stays put');
    ok(await f.evaluate(() => location.pathname.endsWith('/setup/index.html')), 'the Setup frame never navigates');
    ok(await f.locator('[data-act="menu"]').isVisible(), 'overflow menu appears once sign-in started');
    // Error alongside signin.
    await fake({ phone: { error: 'Tailscale stopped. Try again.' } });
    await f.waitForFunction(() => document.querySelector('[data-step="1"] .err'), null, { timeout: 5000 }).catch(() => {});
    ok((await glyphs(f))[0] === 'attn' && await txt(f, '[data-step="1"] .err') === 'Tailscale stopped. Try again.' && await f.locator('[data-act="start"]').innerText() === 'Try again', 'error: attention glyph, the error line, "Try again"');
    console.log('shot', await shot(p, 'phone-05-error'));
    const s1 = count(await fakeLog(), 'POST', '/wizard/v1/setup/phone/start');
    await f.locator('[data-act="start"]').tap(); await sleep(700);
    ok(count(await fakeLog(), 'POST', '/wizard/v1/setup/phone/start') === s1 + 1, '"Try again" POSTs start');
    // https.
    await fake({ phone: { step: 'https' } });
    ok(await waitStep(f, 'https', '[data-step="1"] a[data-out]'), 'https state renders');
    ok((await glyphs(f))[0] === 'attn' && await f.locator('[data-step="1"] a[data-out]').innerText() === 'Turn on secure addresses' && await f.locator('[data-step="1"] a[data-out]').getAttribute('href') === URLS.https, 'https: attention + "Turn on secure addresses" → https_enable_url');
    console.log('shot', await shot(p, 'phone-06-https'));
    // serving.
    await fake({ phone: { step: 'serving' } });
    ok(await waitStep(f, 'serving', '[data-step="3"] a[data-out]'), 'serving state renders');
    g = await glyphs(f);
    ok(g[0] === 'done' && g[2] === 'todo' && (await txt(f, '[data-step="1"] p')).includes('wizard.tail1234.ts.net'), 'serving: step 1 green with the device name, step 3 unlocked', g);
    ok(await f.locator('[data-step="3"] a[data-out]').getAttribute('href') === URLS.wiz && !(await f.locator('.qr').count()), 'phone layout step 3: "Open Wizard at this address" link, no QR');
    ok(await f.evaluate(() => document.querySelector('[data-step="3"] .url .u').textContent) === 'wizard.tail1234.ts.net', 'step 3 shows the Wizard address as text');
    await f.locator('[data-step="3"] .url').tap(); await sleep(300);
    const clip = await f.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e));
    ok(clip === URLS.wiz && await txt(f, '#toast') === 'Copied', 'tapping the address row copies the full URL and says "Copied"', clip);
    console.log('shot', await shot(p, 'phone-07-serving'));
    // phone_seen.
    await fake({ phone: { step: 'phone_seen' } });
    ok(await waitStep(f, 'phone_seen'), 'phone_seen state renders');
    g = await glyphs(f);
    ok(g.join() === 'done,done,done' && (await txt(f, '[data-step="3"] p')).startsWith('Your phone is connected. Add Wizard to your home screen.') && (await txt(f, '[data-step="2"] p')).startsWith('Found Pixel 8.'), 'phone_seen: all green, home-screen copy, phone found', g);
    console.log('shot', await shot(p, 'phone-08-phone-seen'));
    // Back → checklist reads done.
    await shellBack(p); await sleep(900);
    ok(await f.evaluate(() => document.querySelector('.row')?.dataset.state) === 'done' && await f.locator('.okmark').count() === 1, 'checklist row reads done after Back');
    console.log('shot', await shot(p, 'phone-09-checklist-done'));
    // 500 banner, then recovery.
    await f.locator('[data-act="open-phone"]').tap(); await waitStep(f, 'phone_seen');
    await fake({ fail: { '/wizard/v1/setup/phone': 500 } });
    await f.waitForFunction(() => document.querySelector('.banner'), null, { timeout: 6000 }).catch(() => {});
    ok(await txt(f, '.banner') === 'Wizard can’t check on this right now. Trying again.' && (await glyphs(f)).join() === 'done,done,done', '500 while polling: banner, steps keep their state');
    console.log('shot', await shot(p, 'phone-10-banner'));
    await fake({ fail: {} });
    await f.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 6000 }).catch(() => {});
    ok(!(await f.locator('.banner').count()), 'banner clears on the next good answer');
    // Disconnect: menu → sheet, Back closes each layer first.
    await fake({ phone: { step: 'serving' } }); await waitStep(f, 'serving');
    await f.locator('[data-act="menu"]').tap(); await sleep(200);
    ok(await f.locator('#menu').isVisible(), 'overflow menu opens');
    let r = await shellBack(p); await sleep(250);
    ok(r === 'hosted' && !(await f.locator('#menu').isVisible()) && (await fs_(f)).screen === 'phone', 'Back closes the menu only');
    await f.locator('[data-act="menu"]').tap(); await f.locator('[data-act="ask-reset"]').tap(); await sleep(200);
    ok(await f.locator('#sheet').isVisible() && await txt(f, '#sheetTitle') === 'Disconnect and start over?', 'disconnect asks first');
    console.log('shot', await shot(p, 'phone-11-disconnect-sheet'));
    r = await shellBack(p); await sleep(250);
    ok(r === 'hosted' && !(await f.locator('#sheet').isVisible()) && (await fs_(f)).screen === 'phone', 'Back closes the sheet only');
    await f.locator('[data-act="menu"]').tap(); await f.locator('[data-act="ask-reset"]').tap(); await f.locator('[data-act="reset"]').tap();
    await sleep(500);
    ok(count(await fakeLog(), 'POST', '/wizard/v1/setup/phone/reset') === 1 && await txt(f, '#toast') === 'Disconnected' && await waitStep(f, 'off'), 'Disconnect POSTs reset, says "Disconnected", back to off');
    // unavailable.
    await fake({ phone: { step: 'unavailable' } });
    ok(await waitStep(f, 'unavailable'), 'unavailable renders');
    ok(!(await f.locator('#phone .btn, #phone [data-act="menu"]').count()) && (await txt(f, '#phone .state p')).startsWith('This Wizard can’t make a private connection yet'), 'unavailable: explains, no buttons, no menu');
    console.log('shot', await shot(p, 'phone-12-unavailable'));
    // 401 / 403 / 404 on both screens.
    for (const code of [401, 403, 404]) {
      await fake({ fail: { '/wizard/v1/setup/phone': code, '/wizard/v1/setup': code } });
      await f.waitForFunction(c => __setup.state.phone.status === (c === 404 ? 'missing' : 'denied'), code, { timeout: 6000 }).catch(() => {});
      const want = code === 404 ? 'This Wizard doesn’t have Setup yet.' : 'Only Wizard’s owner can do this.';
      ok((await txt(f, '#phone .state p')).startsWith(want) && !(await fs_(f)).polling, `${code} on the phone screen: "${want}", polling stops`);
      if (code === 404) console.log('shot', await shot(p, 'phone-13-missing'));
      await shellBack(p); await sleep(700);
      const wantL = code === 404 ? 'This Wizard doesn’t have Setup yet.' : 'Only Wizard’s owner can use Setup.';
      ok((await txt(f, '#list .state p')).startsWith(wantL), `${code} on the checklist: "${wantL}"`);
      await fake({ fail: {} }); await f.evaluate(() => { __setup.state.list.status = 'loading'; }); await p.evaluate(() => 0);
      await f.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(600);
      await f.locator('[data-act="open-phone"]').tap(); await sleep(900);
    }
    // Network failure on first load.
    await shellBack(p); await sleep(400);
    await fake({ fail: { '/wizard/v1/setup/phone': 'drop' } });
    await f.locator('[data-act="open-phone"]').tap();
    await f.waitForFunction(() => __setup.state.phone.status === 'neterr' || __setup.state.phone.banner, null, { timeout: 6000 }).catch(() => {});
    ok(await f.evaluate(() => __setup.state.phone.banner || !!document.querySelector('[data-act="retry-phone"]')), 'network failure: banner or "Try again", never a blank screen');
    await fake({ fail: {} });
    // Polling stops back on the checklist.
    await shellBack(p); await sleep(300); const t9 = Date.now(); await sleep(4500);
    ok(count(await fakeLog(), 'GET', '/wizard/v1/setup/phone', t9) === 0, 'no polling on the checklist');
    ok(!T.errors.length && !(await p.evaluate(() => window.__qaErr || [])).length, 'phone states: no page errors', T.errors.concat(await p.evaluate(() => window.__qaErr || [])));
    await ctx.close();
  }

  /* ================= phone: every live skin ================= */
  await fakeReset(); await fake({ firstRun: false, phone: { step: 'serving' } });
  {
    const { ctx, p, T } = await context(b, 'phone');
    await p.goto(BASE + '?shell=phone', { waitUntil: 'load' }); await sleep(1500);
    await p.evaluate(() => __wos.openApp(WizCore.apps('mobile').APP.wizard)); await sleep(800);
    await p.evaluate(() => __wos.openApp(WizCore.apps('mobile').APP.setup)); const f = await waitFrame(p);
    await f.locator('[data-act="open-phone"]').tap(); await waitStep(f, 'serving');
    const skins = await p.evaluate(() => WosSkin.list.map(s => s.id));
    ok(['nebula', 'grove', 'tide', 'ember', 'signal'].every(s => skins.includes(s)), 'live skin registry has Nebula, Grove, Tide, Ember, Signal', skins);
    for (const id of skins) {
      await p.evaluate(s => WosSkin.set(s), id);
      await f.waitForFunction(s => document.documentElement.dataset.skin === s, id, { timeout: 5000 }).catch(() => {});
      await sleep(500);
      const r = await p.evaluate(() => {
        const sw = Object.values(__wos.wins).find(w => w.appId === 'setup'), cw = Object.values(__wos.wins).find(w => w.app === 'chats');
        const el = document.querySelector(`.win[data-win="${sw.id}"]`), ch = cw && document.querySelector(`.win[data-win="${cw.id}"]`);
        const fr = el.querySelector('iframe'), d = fr.contentDocument, cs = x => getComputedStyle(x);
        return { themed: el.classList.contains('wz-themed'), winBg: cs(el).backgroundColor, chatsBg: ch ? cs(ch).backgroundColor : '', frameBg: cs(fr).backgroundColor, htmlBg: cs(d.documentElement).backgroundColor, bodyBg: cs(d.body).backgroundColor,
          skin: d.documentElement.dataset.skin, text: cs(d.querySelector('h1')).color, wzText: d.documentElement.style.getPropertyValue('--wz-text').trim(), accent: cs(d.querySelector('[data-step="3"] .btn.primary')).backgroundColor };
      });
      const T0 = 'rgba(0, 0, 0, 0)';
      ok(r.skin === id && r.themed && r.htmlBg === T0 && r.bodyBg === T0 && r.frameBg === T0 && r.winBg === r.chatsBg, `${id}: themed, transparent canvas, same window material as Chats`, r);
      console.log('shot', await shot(p, `phone-skin-${id}`));
    }
    await p.evaluate(() => WosSkin.set('nebula'));
    ok(!T.errors.length && !(await p.evaluate(() => window.__qaErr || [])).length, 'skins: no page errors', T.errors);
    await ctx.close();
  }

  /* ================= desktop window ================= */
  await fakeReset(); await fake({ owner: '' });
  {
    const { ctx, p, T } = await context(b, 'desktop', { coached: false });
    await p.goto(BASE + 'desktop.html?shell=desktop', { waitUntil: 'load' });
    const f = await waitFrame(p);
    ok(!!f && await p.evaluate(() => document.documentElement.dataset.shell === 'desktop' && Object.values(__wux.wins).some(w => w.appId === 'setup')), 'desktop first run: Setup opens in a window by itself');
    await f.waitForFunction(() => document.querySelector('.greet'), null, { timeout: 8000 }).catch(() => {});
    await sleep(1200);
    ok(await txt(f, '.greet') === 'One thing to set up for now.' && count(await fakeLog(), 'POST', '/wizard/v1/setup/seen') === 1, 'desktop: greeting without a name; seen POSTed once');
    ok(!(await f.locator('[data-act="tour"]').count()) && (await fs_(f)).layout === 'desktop', 'desktop: no tour link; desktop layout');
    console.log('shot', await shot(p, 'desktop-01-checklist'));
    await f.locator('[data-act="open-phone"]').click(); await waitStep(f, 'off');
    const geo = await f.evaluate(() => ({ w: innerWidth, col: document.querySelector('.app').getBoundingClientRect().width, cols: getComputedStyle(document.querySelector('[data-step="2"] .split')).gridTemplateColumns }));
    ok(geo.col <= 480 && (geo.w < 520 || geo.cols.split(' ').length === 2), 'desktop: 480 px column; two columns (text | QR) when the window is 520 px or wider', geo);
    const q2 = f.locator('[data-step="2"] .qr');
    ok(await q2.count() === 1 && await decodeQR(p, b, q2) === URLS.install, 'step 2 QR decodes to the install page (rendered pixels)');
    const qg = await f.evaluate(() => { const c = document.querySelector('[data-step="2"] .qr canvas'), box = c.parentElement.getBoundingClientRect(); return { box: Math.round(box.width), css: c.getBoundingClientRect().width, px: c.width, modules: +c.parentElement.dataset.modules, dpr: devicePixelRatio, bg: getComputedStyle(c.parentElement).backgroundColor }; });
    ok(qg.box === 168 && qg.bg === 'rgb(255, 255, 255)' && qg.px % (qg.modules + 8) === 0 && qg.px / (qg.modules + 8) >= 2, 'QR on a 168 px white tile, whole device pixels per module (crisp)', qg);
    console.log('shot', await shot(p, 'desktop-02-off'));
    await fake({ phone: { step: 'serving' } }); await waitStep(f, 'serving', '[data-step="3"] .qr');
    const q3 = f.locator('[data-step="3"] .qr');
    ok(await decodeQR(p, b, q3) === 'wizard://connect?origin=' + encodeURIComponent(new URL(URLS.wiz).origin), 'step 3 QR decodes to the native Connect URI (rendered pixels)');
    ok(await f.evaluate(() => document.querySelector('[data-step="3"] .url .u').textContent) === 'wizard.tail1234.ts.net', 'URL shown as copyable text under the QR');
    await f.locator('[data-step="3"] [data-act="copy"]').click(); await sleep(300);
    ok(await f.evaluate(() => navigator.clipboard.readText()) === URLS.wiz && await txt(f, '#toast') === 'Copied', 'desktop Copy button copies the full address');
    console.log('shot', await shot(p, 'desktop-03-serving'));
    await fake({ phone: { step: 'phone_seen' } }); await waitStep(f, 'phone_seen');
    console.log('shot', await shot(p, 'desktop-04-phone-seen'));
    // Esc / Back: phone screen → checklist; at the checklist the window stays.
    await f.locator('#phone h1').click(); await p.keyboard.press('Escape'); await sleep(400);
    ok((await fs_(f)).screen === 'list' && await p.evaluate(() => Object.values(__wux.wins).some(w => w.appId === 'setup')), 'desktop Esc: phone screen → checklist, window still open');
    await p.evaluate(() => __wux.escStep()); await sleep(300);
    ok(await p.evaluate(() => Object.values(__wux.wins).some(w => w.appId === 'setup')), 'desktop Back at the checklist never closes Setup');
    const t = Date.now(); await sleep(4500);
    ok(count(await fakeLog(), 'GET', '/wizard/v1/setup/phone', t) === 0, 'desktop: no polling on the checklist');
    ok(!T.errors.length && !(await p.evaluate(() => window.__qaErr || [])).length, 'desktop: no page errors', T.errors.concat(await p.evaluate(() => window.__qaErr || [])));
    await ctx.close();
  }

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (process.env.QA_RECEIPT) fs.writeFileSync(process.env.QA_RECEIPT, JSON.stringify({ suite: 'qa-setup-app', base: BASE, pass, fail, results, at: new Date().toISOString() }, null, 2));
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
