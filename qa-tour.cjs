// QA: first-run tour v2 (core/tour.js) — real voice. James, 11 Oct 2026: practise the real thing; never fake what
// the user said. Chromium's fake microphone records real audio; /transcribe is intercepted so the test controls
// what was "heard". Asserts the tour advances only on what the shell actually did:
//  beat 1 tap-talk: silence → "didn't hear" nudge (no advance); real speech → sent → beat 2
//  beat 2 hold-command: a non-command → "Didn't catch a command" (no advance, nothing opened); "Open Calendar"
//         → the app opens on the desk next to Home → beat 3. No slide-to-aim anywhere.
//  beat 3 swipe down → bars hide (distraction-free) → Back brings them back → end card → tap finishes and remembers.
//  No mic (permission denied) → typed fallback that sends what was typed.
//  Help: "help" opens the sheet (no agent run); Settings → Gestures & help; Practice again; Skip; ?view=tour.
// Usage: node qa-tour.cjs [origin=http://127.0.0.1:9431/wizard-os-home/]
const pw = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9431/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || require('./tools/qa-paths.cjs').workPath('tour');
require('fs').mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

async function session(b, { mic = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  if (mic) await ctx.grantPermissions(['microphone'], { origin: ORIGIN });
  const S = { heard: '', writes: [], runs: 0 };
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url());
    if (q.method() === 'GET' || q.method() === 'HEAD' || u.origin !== ORIGIN) return r.continue();
    S.writes.push(q.method() + ' ' + u.pathname);
    if (/\/transcribe$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: S.heard, ms: 5 }) });
    if (/\/v1\/runs$|\/api\/sessions/.test(u.pathname)) S.runs++;
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  if (!mic) await ctx.addInitScript(() => { try { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); } catch (e) {} });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  return { ctx, p, S, errs };
}
const T = p => p.evaluate(() => ({ active: WosTour.active, step: WosTour.step, typed: WosTour.typed, help: WosTour.helpOpen, copy: document.querySelector('.tr-copy b')?.textContent || '', alt: document.querySelector('.tr-copy .tr-alt')?.innerHTML || '', idx: __wos.idx, names: __wos.desks.map(d => d.home ? 'Home' : d.wins.map(id => __wos.wins[id].appId || __wos.wins[id].app).join('+')), log: (window.__tourLog || []).slice(-6) }));
const orb = async p => { const r = await p.locator('#orbWrap').boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
const tap = async p => { const o = await orb(p); await p.mouse.move(o.x, o.y); await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up(); await p.waitForTimeout(250); };
const hold = async (p, ms = 2200) => { const o = await orb(p); await p.mouse.move(o.x, o.y); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); };
const swipe = async (p, dy) => { const o = await orb(p); await p.mouse.move(o.x, o.y); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(o.x, o.y + dy * i / 6); await p.waitForTimeout(16); } await p.mouse.up(); await p.waitForTimeout(400); };
const settle = (p, ms = 3500) => p.waitForFunction(() => document.querySelector('.device')?.dataset.voice === 'idle', null, { timeout: ms }).catch(() => {});

(async () => {
  const b = await pw.chromium.launch({ args: ARGS });
  let { p, S, errs } = await session(b);
  await p.goto(URL_); await p.waitForFunction(() => window.__wos && window.__wos.desks, null, { timeout: 20000 });
  await p.waitForTimeout(1600);
  let t = await T(p);
  ok(t.active && t.step === 1 && t.idx === 0, 'fresh install: tour starts on Home at beat 1', JSON.stringify(t));
  ok(/Tap the orb and say hello/.test(t.copy), 'beat 1 copy: "Tap the orb and say hello. Tap again to send."', t.copy);
  ok(await p.locator('#coach').count() === 0, 'old Enter overlay is gone');
  await p.screenshot({ path: `${SHOTS}/01-beat1.png` });

  // Beat 1, silence: real recording, empty transcript → nudge, no advance.
  S.heard = '';
  await tap(p); await p.waitForTimeout(1600); await p.screenshot({ path: `${SHOTS}/02-beat1-listening.png` }); await tap(p); await settle(p);
  await p.waitForTimeout(400); t = await T(p);
  ok(t.step === 1 && /Didn.t hear anything/.test(t.copy), 'beat 1: silence → "Didn\'t hear anything" and stays on beat 1', JSON.stringify(t));
  ok(S.writes.some(w => /transcribe/.test(w)), 'beat 1: the real microphone recorded and was transcribed', JSON.stringify(S.writes));
  await p.waitForTimeout(3400);

  // Beat 1, real speech → sent → beat 2.
  S.heard = 'Hello Wizard'; const w0 = S.writes.length;
  await tap(p); await p.waitForTimeout(1600); await tap(p);
  await p.waitForFunction(() => /Sent|command/.test(document.querySelector('.tr-copy b')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
  t = await T(p); ok(/Sent\. Your Wizard is working on it/.test(t.copy), 'beat 1: what you said is really sent ("Sent. Your Wizard is working on it.")', JSON.stringify({ t, writes: S.writes.slice(w0) }));
  await p.screenshot({ path: `${SHOTS}/03-beat1-sent.png` });
  await p.waitForFunction(() => WosTour.step === 2, null, { timeout: 4000 }).catch(() => {});
  t = await T(p); ok(t.step === 2 && /Hold the orb and say “Open/.test(t.copy), 'beat 2: "Hold the orb and say “Open …”"', JSON.stringify(t));
  ok(!/slide|aim/i.test(t.copy + t.alt), 'beat 2: no slide-to-aim instruction');
  await p.screenshot({ path: `${SHOTS}/04-beat2.png` });
  const want = /Calendar/.test(t.copy) ? 'Open Calendar' : 'Open Day in review';

  // Beat 2, wrong words: no command → nudge; nothing opens.
  const desks0 = t.names.length;
  S.heard = 'banana pancakes tomorrow';
  await hold(p); await settle(p, 5000); await p.waitForTimeout(500);
  t = await T(p); ok(t.step === 2 && /Didn.t catch a command/.test(t.copy) && t.names.length === desks0 && t.idx === 0, 'beat 2: non-command → "Didn\'t catch a command", nothing opens, stays on beat 2', JSON.stringify(t));
  await p.waitForTimeout(3400);

  // Beat 2, the real command → opens next to Home.
  S.heard = want + '.';
  await hold(p); await p.waitForTimeout(1400);
  t = await T(p);
  ok(t.idx === 1 && /calendar|review|day/i.test(t.names[1]), `beat 2: "${want}" opens on the desk right next to Home`, JSON.stringify(t));
  ok(/desk next door/.test(t.copy), 'beat 2: "That’s a command. It opened on the desk next door."', t.copy);
  await p.screenshot({ path: `${SHOTS}/05-beat2-opened.png` });
  await p.waitForFunction(() => WosTour.step === 3, null, { timeout: 5000 }).catch(() => {});
  t = await T(p); ok(t.step === 3 && t.idx === 0, 'beat 2 → beat 3 back on Home', JSON.stringify(t));

  // Beat 3: swipe up is steered; swipe down hides the bars (distraction-free); Back brings them back.
  await swipe(p, -120); t = await T(p);
  ok(t.step === 3 && /Down, not up/.test(t.copy) && !(await p.evaluate(() => __wos.sheet)), 'beat 3: swipe up → "Down, not up."', t.copy);
  await p.waitForTimeout(2400);
  await swipe(p, 140); await p.waitForTimeout(400);
  t = await T(p); ok(!(await p.evaluate(() => __wos.sheet)) && (await p.evaluate(() => document.querySelector('#device').classList.contains('zen'))) && /Swipe up from the bottom/.test(t.copy), 'beat 3: swipe down hides the bars, "Swipe up from the bottom edge…"', JSON.stringify(t));
  await p.screenshot({ path: `${SHOTS}/06-beat3-hidden.png` });
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(700);
  t = await T(p); ok(t.step === 4 && t.idx === 0 && !(await p.evaluate(() => document.querySelector('#device').classList.contains('zen'))), 'beat 3: Back brings the bars back → end card on Home', JSON.stringify(t));
  ok(await p.evaluate(() => document.visibilityState === 'visible' && !!document.querySelector('#orbWrap')), 'Back in the tour: app still open');
  ok(/say “help”/.test(t.copy), 'end card: "Need this again? Hold the orb and say “help”."', t.copy);
  await p.screenshot({ path: `${SHOTS}/07-done.png` });
  await p.mouse.click(206, 300); await p.waitForTimeout(500);
  t = await T(p); ok(!t.active && await p.evaluate(() => localStorage.getItem('wos.tour.v1') === 'true'), 'end card: a tap finishes and remembers', JSON.stringify(t));

  await p.reload(); await p.waitForFunction(() => window.__wos && window.__wos.desks); await p.waitForTimeout(1200);
  ok(!(await T(p)).active, 'second launch: no tour');

  // Help: hold + "help" → sheet; no agent run.
  await p.evaluate(() => __wos.goDesk(0, true)); const r0 = S.runs;
  await p.evaluate(() => __wos.runUtterance('help', 'command')); await p.waitForTimeout(600);
  t = await T(p); ok(t.help && S.runs === r0, '"help" (hold) opens the Help sheet, no agent run', JSON.stringify(t));
  const helpTxt = await p.evaluate(() => document.querySelector('.help-sheet')?.textContent || '');
  ok(!/slide|aim/i.test(helpTxt) && /filter/i.test(helpTxt), 'Help sheet: no slide-to-aim; mentions Chats filters', helpTxt.slice(0, 200));
  await p.screenshot({ path: `${SHOTS}/08-help.png` });
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(400);
  ok(!(await T(p)).help, 'Back closes the Help sheet');

  await p.evaluate(() => __wos.openSettings()); await p.waitForTimeout(500);
  await p.locator('[data-st="help"]').tap(); await p.waitForTimeout(500);
  ok((await T(p)).help, 'Settings → Gestures & help opens the sheet');
  await p.locator('[data-hsgo]').tap(); await p.waitForTimeout(800);
  t = await T(p); ok(t.active && t.step === 1 && t.idx === 0, 'Practice again restarts at beat 1 on Home', JSON.stringify(t));
  await p.locator('[data-tskip]').tap(); await p.waitForTimeout(500);
  ok(!(await T(p)).active, 'Skip ends the tour');
  await p.evaluate(() => WosTour.start('qa')); await p.waitForTimeout(300);
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(400);
  ok(!(await T(p)).active && await p.evaluate(() => !!document.querySelector('#orbWrap')), 'Back at beat 1 skips (app still open)');
  await p.goto(URL_ + '?view=tour'); await p.waitForFunction(() => window.__wos && window.__wos.desks); await p.waitForTimeout(1200);
  ok((await T(p)).active, '?view=tour starts the tour');
  ok(!errs.length, 'no page errors', errs.join(' | '));

  // No microphone: the tour switches to typing and still really sends what was typed.
  ({ p, S, errs } = await session(b, { mic: false }));
  await p.goto(URL_); await p.waitForFunction(() => window.__wos && window.__wos.desks, null, { timeout: 20000 }); await p.waitForTimeout(1600);
  await tap(p); await p.waitForTimeout(1500);
  t = await T(p); ok(t.typed && /Type “hello”/.test(t.copy) && /tr-type/.test(t.alt), 'no mic: beat 1 switches to a type box', JSON.stringify(t));
  await p.screenshot({ path: `${SHOTS}/09-nomic.png` });
  await p.locator('.tr-type input').fill('hello'); await p.locator('.tr-type button').tap();
  await p.waitForFunction(() => WosTour.step === 2, null, { timeout: 5000 }).catch(() => {});
  t = await T(p); ok(t.step === 2 && /Tap the orb’s command/.test(t.copy), 'no mic: typed hello sends → beat 2 offers the command as a button', JSON.stringify(t));
  await p.locator('.tr-cmd').tap(); await p.waitForTimeout(1200);
  t = await T(p); ok(t.idx === 1, 'no mic: the command button opens the app next to Home', JSON.stringify(t));
  ok(!errs.length, 'no page errors (no mic)', errs.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
