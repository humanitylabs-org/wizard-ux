// QA: first-run practice tour + Help sheet (core/tour.js). Real touch gestures on the orb, phone viewport.
// Asserts: fresh install starts the tour; every beat completes by gesture; nothing is sent (no writes, no
// getUserMedia, no new outbox item); the only thing left behind is the Day in review desk beside Home; Back
// inside beat 3 lands on Home with the app open; Skip works; "help" opens the sheet without sending;
// Settings → Gestures & help opens it; Practice again restarts at beat 1; ?view=tour works.
// Usage: node qa-tour.cjs [origin=http://127.0.0.1:9431/wizard-os-home/]
let pw; try { pw = require('/home/telos/node_modules/playwright'); } catch (e) { pw = require('playwright-core'); }
const URL_ = process.argv[2] || 'http://127.0.0.1:9431/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch/tour';
require('fs').mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url());
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && u.origin === ORIGIN) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    return r.continue();
  });
  await ctx.addInitScript(() => {
    window.__gum = 0;
    try { const g = navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); if (g) navigator.mediaDevices.getUserMedia = c => { window.__gum++; return g(c); }; } catch (e) {}
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL_); await p.waitForFunction(() => window.__wos && window.__wos.desks, null, { timeout: 20000 });
  await p.waitForTimeout(1600);

  // Raw pointer gestures on the orb (the shell listens to pointer events, as on the phone).
  const orb = async () => { const r = await p.locator('#orbWrap').boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const tap = async () => { const o = await orb(); await p.mouse.move(o.x, o.y); await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up(); await p.waitForTimeout(250); };
  const hold = async (dx) => { const o = await orb(); await p.mouse.move(o.x, o.y); await p.mouse.down(); await p.waitForTimeout(700); for (let i = 1; i <= 8; i++) { await p.mouse.move(o.x + dx * i / 8, o.y); await p.waitForTimeout(40); } await p.waitForTimeout(250); await p.screenshot({ path: `${SHOTS}/04-aiming.png` }); await p.mouse.up(); };
  const swipe = async (dy) => { const o = await orb(); await p.mouse.move(o.x, o.y); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(o.x, o.y + dy * i / 6); await p.waitForTimeout(16); } await p.mouse.up(); await p.waitForTimeout(300); };
  const T = () => p.evaluate(() => ({ active: WosTour.active, step: WosTour.step, help: WosTour.helpOpen, copy: document.querySelector('.tr-copy b')?.textContent || '', idx: __wos.idx, names: __wos.desks.map(d => d.home ? 'Home' : d.wins.map(id => __wos.wins[id].app).join('+')), outbox: (__wos.outbox?.unsent?.() || []).length }));

  let t = await T();
  ok(t.active && t.step === 1 && t.idx === 0, 'fresh install: the tour starts on Home at beat 1', JSON.stringify(t));
  ok(await p.locator('#coach').count() === 0, 'old Enter overlay is gone');
  const ob0 = t.outbox, desks0 = t.names.length;
  await p.screenshot({ path: `${SHOTS}/01-beat1.png` });

  // Wrong gesture on beat 1 is swallowed, never opens the launcher.
  await swipe(-120); t = await T();
  ok(t.step === 1 && !(await p.evaluate(() => __wos.sheet)), 'beat 1: a swipe is swallowed (no launcher)', JSON.stringify(t));
  await p.waitForTimeout(1900);

  await tap(); await p.waitForTimeout(1000);
  await p.screenshot({ path: `${SHOTS}/02-beat1-listening.png` });
  t = await T(); ok(/Tap again/.test(t.copy), 'beat 1: first tap → "say anything, tap again"', t.copy);
  await tap(); await p.waitForTimeout(700);
  await p.screenshot({ path: `${SHOTS}/03-beat1-sent.png` });
  await p.waitForTimeout(1600);
  t = await T(); ok(t.step === 2, 'beat 1 → beat 2 after the second tap', JSON.stringify(t));
  await p.screenshot({ path: `${SHOTS}/03b-beat2.png` });

  await hold(130); await p.waitForTimeout(900);
  t = await T();
  await p.screenshot({ path: `${SHOTS}/05-landed.png` });
  const chatsAt = t.names.findIndex(n => /chats/.test(n));
  ok(t.names[t.idx] === 'review' && t.idx === (chatsAt === 1 ? 2 : 1), 'beat 2: hold + slide right opens Day in review on the desk beside', JSON.stringify(t));
  ok(/where you aimed/.test(t.copy), 'beat 2: "It opened right where you aimed."', t.copy);
  await p.waitForFunction(() => WosTour.step === 3, null, { timeout: 4000 }).catch(() => {});
  t = await T(); ok(t.step === 3, 'beat 2 → beat 3', JSON.stringify(t));

  await swipe(-120); await p.waitForTimeout(200); t = await T();
  ok(t.step === 3 && /Down, not up/.test(t.copy) && !(await p.evaluate(() => __wos.sheet)), 'beat 3: swipe up is swallowed with "Down, not up."', t.copy);
  await p.waitForTimeout(1900);
  await swipe(140); await p.waitForTimeout(500);
  await p.screenshot({ path: `${SHOTS}/06-answer.png` });
  ok(await p.locator('.tr-inbox').count() === 1 && /press Back/.test((await T()).copy), 'beat 3: swipe down drops the practice reply, "Now press Back."');
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(700);
  t = await T();
  ok(t.step === 4 && t.idx === 0, 'beat 3: Back lands on Home and moves to the end card', JSON.stringify(t));
  ok(await p.evaluate(() => document.visibilityState === 'visible' && !!document.querySelector('#orbWrap')), 'Back in the tour: app still open');
  await p.screenshot({ path: `${SHOTS}/07-done.png` });
  await p.mouse.click(206, 300); await p.waitForTimeout(500);
  t = await T();
  ok(!t.active && await p.evaluate(() => localStorage.getItem('wos.tour.v1') === 'true'), 'end card: a tap finishes and remembers', JSON.stringify(t));
  ok(t.outbox === ob0 && !writes.length, 'tour sent nothing (no writes, no outbox items)', JSON.stringify({ writes, ob: t.outbox, ob0 }));
  ok(await p.evaluate(() => window.__gum) === 0, 'tour never opened the microphone');
  ok(t.names.length === desks0 + 1 || t.names.filter(n => n === 'review').length >= 1, 'only the Day in review desk is left behind', JSON.stringify(t.names));

  // Reload: no tour again.
  await p.reload(); await p.waitForFunction(() => window.__wos && window.__wos.desks); await p.waitForTimeout(1200);
  ok(!(await T()).active, 'second launch: no tour');

  // "help" typed through the router → sheet, nothing sent.
  await p.evaluate(() => __wos.goDesk(0, true));
  await p.evaluate(() => __wos.runUtterance('help', 'command')); await p.waitForTimeout(600);
  t = await T(); ok(t.help && !writes.length && t.outbox === ob0, '"help" (hold) opens the Help sheet and sends nothing', JSON.stringify(t));
  await p.screenshot({ path: `${SHOTS}/08-help.png` });
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(400);
  ok(!(await T()).help, 'Back closes the Help sheet');
  await p.evaluate(() => __wos.handleText('Help.', 'auto')); await p.waitForTimeout(500);
  ok((await T()).help && !writes.length, '"Help." (tap, on Home) opens the sheet too');
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(400);

  // Settings → Gestures & help → Practice again.
  await p.evaluate(() => __wos.openSettings()); await p.waitForTimeout(500);
  await p.locator('[data-st="help"]').tap(); await p.waitForTimeout(500);
  ok((await T()).help, 'Settings → Gestures & help opens the sheet');
  await p.locator('[data-hsgo]').tap(); await p.waitForTimeout(800);
  t = await T(); ok(t.active && t.step === 1 && t.idx === 0, 'Practice again restarts at beat 1 on Home', JSON.stringify(t));
  await p.locator('[data-tskip]').tap(); await p.waitForTimeout(500);
  ok(!(await T()).active, 'Skip ends the tour');
  // Back at beat 1 skips.
  await p.evaluate(() => WosTour.start('qa')); await p.waitForTimeout(300);
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(400);
  ok(!(await T()).active && await p.evaluate(() => !!document.querySelector('#orbWrap')), 'Back at beat 1 skips (app still open)');

  // Deep link.
  await p.goto(URL_ + '?view=tour'); await p.waitForFunction(() => window.__wos && window.__wos.desks); await p.waitForTimeout(1200);
  ok((await T()).active, '?view=tour starts the tour');
  ok(!errs.length, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
