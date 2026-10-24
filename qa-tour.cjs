// QA: first-run tour (core/tour.js) — real voice. James, 11 Oct 2026: practise the real thing; never fake what
// the user said. Miguel, 24 Oct 2026: no Command beat, and each beat can be skipped on its own.
// Chromium's fake microphone records real audio; /transcribe is intercepted so the test controls what was "heard".
// Asserts the tour advances only on what the shell actually did:
//  beat 1 Talk (1 of 2): silence → "didn't hear" nudge (no advance); real speech → sent → beat 2 Hide
//  beat 2 Hide (2 of 2): swipe up is steered; swipe down → bars hide → Back brings them back → end card → tap
//         finishes and remembers. No beat mentions or teaches a command.
//  Skip this step: moves one beat on (Talk → Hide → end card) without finishing; Skip tour ends it from any beat.
//  No mic (permission denied) → typed fallback that sends what was typed, then Hide (no command button).
//  Help: "help" opens the sheet (no agent run); Settings → Gestures & help; Practice again; ?view=tour.
//  Desktop 1440x900 (desktop.html): no phone tour, no page errors.
// Usage: node qa-tour.cjs [origin=http://127.0.0.1:9431/wizard-os-home/]   (QA_VIEWPORT=390x844 by default)
const pw = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9431/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || require('./tools/qa-paths.cjs').workPath('tour');
require('fs').mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const [VW, VH] = (process.env.QA_VIEWPORT || '390x844').split('x').map(Number);
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

async function session(b, { mic = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
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
const T = p => p.evaluate(() => ({ active: WosTour.active, step: WosTour.step, typed: WosTour.typed, help: WosTour.helpOpen, copy: document.querySelector('.tr-copy b')?.textContent || '', sub: document.querySelector('.tr-copy small')?.textContent || '', dots: document.querySelectorAll('#tour .tr-steps i').length, next: document.querySelector('#tour [data-tnext]')?.textContent || '', skip: document.querySelector('#tour [data-tskip]')?.textContent || '', glyphs: [...document.querySelectorAll('#tour .tr-g b')].map(x => x.textContent), alt: document.querySelector('.tr-copy .tr-alt')?.innerHTML || '', idx: __wos.idx, names: __wos.desks.map(d => d.home ? 'Home' : d.wins.map(id => __wos.wins[id].appId || __wos.wins[id].app).join('+')), log: (window.__tourLog || []).slice(-6) }));
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
  ok(/Tap the orb and say hello/.test(t.copy) && t.sub === '1 of 2 · Talk', 'beat 1 copy: "1 of 2 · Talk" + "Tap the orb and say hello. Tap again to send."', JSON.stringify(t));
  ok(t.dots === 2 && t.next === 'Skip this step' && t.skip === 'Skip tour', 'beat 1: two progress dots, "Skip this step" and "Skip tour"', JSON.stringify(t));
  ok(await p.locator('#coach').count() === 0, 'old Enter overlay is gone');
  await p.screenshot({ path: `${SHOTS}/01-beat1.png` });

  // Beat 1, silence: the shell reports no speech → nudge, no advance. (Voice takes now go straight to the durable
  // outbox as a voice note, so the shell's own empty-take check is driven through its event here.)
  await p.evaluate(() => WosTour.event('nospeech')); await p.waitForTimeout(300); t = await T(p);
  ok(t.step === 1 && /Didn.t hear anything/.test(t.copy), 'beat 1: no speech → "Didn\'t hear anything" and stays on beat 1', JSON.stringify(t));
  await p.waitForTimeout(3400);

  // Beat 1, a real take with the real (fake-device) microphone → sent → beat 2.
  S.heard = 'Hello Wizard'; const w0 = S.writes.length;
  await tap(p); await p.waitForTimeout(1600); await p.screenshot({ path: `${SHOTS}/02-beat1-listening.png` }); await tap(p);
  await p.waitForFunction(() => /Sent/.test(document.querySelector('.tr-copy b')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
  t = await T(p); ok(/Sent\. Your Wizard is working on it/.test(t.copy) && t.step === 1, 'beat 1: the real recording is really sent ("Sent. Your Wizard is working on it.")', JSON.stringify({ t, writes: S.writes.slice(w0) }));
  ok(S.writes.slice(w0).some(w => /upload|transcribe|runs|sessions/.test(w)), 'beat 1: the take left the shell as a real write', JSON.stringify(S.writes.slice(w0)));
  await p.screenshot({ path: `${SHOTS}/03-beat1-sent.png` });
  await p.waitForFunction(() => WosTour.step === 2, null, { timeout: 4000 }).catch(() => {});
  t = await T(p); ok(t.step === 2 && /^2 of 2 · Hide$/.test(t.sub) && /Swipe the orb down/.test(t.copy), 'sent → beat 2 is Hide ("2 of 2 · Hide"); no Command beat', JSON.stringify(t));
  ok(!/command|Open Calendar|Open Files/i.test(t.copy + t.alt), 'beat 2 does not teach a command', t.copy + t.alt);
  ok(t.dots === 2 && t.next === 'Skip this step' && t.skip === 'Skip tour', 'two progress dots, "Skip this step" and "Skip tour" shown', JSON.stringify(t));
  await p.screenshot({ path: `${SHOTS}/04-beat2-hide.png` });

  // Beat 2 Hide: swipe up is steered; swipe down hides the bars (distraction-free); Back brings them back.
  await swipe(p, -120); t = await T(p);
  ok(t.step === 2 && /Down, not up/.test(t.copy) && !(await p.evaluate(() => __wos.sheet)), 'beat 2: swipe up → "Down, not up."', t.copy);
  await p.waitForTimeout(2400);
  await swipe(p, 140); await p.waitForTimeout(400);
  t = await T(p); ok(!(await p.evaluate(() => __wos.sheet)) && (await p.evaluate(() => document.querySelector('#device').classList.contains('zen'))) && /Swipe up from the bottom/.test(t.copy), 'beat 2: swipe down hides the bars, "Swipe up from the bottom edge…"', JSON.stringify(t));
  await p.screenshot({ path: `${SHOTS}/06-beat3-hidden.png` });
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(700);
  t = await T(p); ok(t.step === 3 && t.idx === 0 && !(await p.evaluate(() => document.querySelector('#device').classList.contains('zen'))), 'beat 2: Back brings the bars back → end card on Home', JSON.stringify(t));
  ok(await p.evaluate(() => document.visibilityState === 'visible' && !!document.querySelector('#orbWrap')), 'Back in the tour: app still open');
  ok(/Everything you see is customizable/.test(t.copy) && /say “help”/.test(t.alt) && !t.next && t.glyphs.join() === 'Tap,Swipe ↓', 'end card: "Everything you see is customizable…" + "Need this again? Hold the orb and say “help”."', t.copy + ' | ' + t.alt);
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
  if (!(await p.locator('[data-st="help"]').count())) { await p.locator('[data-st-page="about"]').tap(); await p.waitForTimeout(500); }
  await p.locator('[data-st="help"]').tap(); await p.waitForTimeout(500);
  ok((await T(p)).help, 'Settings → Gestures & help opens the sheet');
  await p.locator('[data-hsgo]').tap(); await p.waitForTimeout(800);
  t = await T(p); ok(t.active && t.step === 1 && t.idx === 0, 'Practice again restarts at beat 1 on Home', JSON.stringify(t));
  // Skip one step at a time: Talk → Hide → end card, without finishing; nothing is sent.
  const r1 = S.runs;
  await p.locator('[data-tnext]').tap(); await p.waitForTimeout(600);
  t = await T(p); ok(t.active && t.step === 2 && t.sub === '2 of 2 · Hide', 'Skip this step on Talk → Hide, tour still running', JSON.stringify(t));
  await p.screenshot({ path: `${SHOTS}/10-skipped-to-hide.png` });
  await swipe(p, 140); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.querySelector('#device').classList.contains('zen')), 'Hide: bars hidden before skipping');
  await p.locator('[data-tnext]').tap(); await p.waitForTimeout(700);
  t = await T(p); ok(t.active && t.step === 3 && !(await p.evaluate(() => document.querySelector('#device').classList.contains('zen'))) && !t.next, 'Skip this step on Hide (bars hidden) → bars back, end card, no per-step skip there', JSON.stringify(t));
  ok(S.runs === r1, 'skipping steps sends nothing', String(S.runs - r1));
  await p.screenshot({ path: `${SHOTS}/11-skipped-to-done.png` });
  await p.mouse.click(VW / 2, VH / 3); await p.waitForTimeout(500);
  ok(!(await T(p)).active, 'end card after skipping: a tap finishes');
  // Skip tour: whole-tour exit from beat 1 and from beat 2.
  await p.evaluate(() => { localStorage.removeItem('wos.tour.v1'); WosTour.start('qa'); }); await p.waitForTimeout(400);
  await p.locator('[data-tskip]').tap(); await p.waitForTimeout(500);
  ok(!(await T(p)).active && await p.evaluate(() => localStorage.getItem('wos.tour.v1')) === 'true', 'Skip tour on beat 1 ends the whole tour and remembers');
  await p.evaluate(() => WosTour.start('qa')); await p.waitForTimeout(400);
  await p.locator('[data-tnext]').tap(); await p.waitForTimeout(500);
  await p.locator('[data-tskip]').tap(); await p.waitForTimeout(500);
  ok(!(await T(p)).active, 'Skip tour on beat 2 ends the whole tour');
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
  t = await T(p); ok(t.step === 2 && /Swipe the orb down/.test(t.copy) && !/tr-cmd|data-tsay/.test(t.alt), 'no mic: typed hello sends → beat 2 Hide, no command button', JSON.stringify(t));
  ok(!errs.length, 'no page errors (no mic)', errs.join(' | '));

  // Desktop shell: the gesture tour is phone-only; desktop loads clean.
  { const dctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    await dctx.route('**/*', r => { const q = r.request(); return (q.method() === 'GET' || q.method() === 'HEAD') ? r.continue() : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    const dp = await dctx.newPage(); const derrs = []; dp.on('pageerror', e => derrs.push(String(e)));
    await dp.goto(URL_.replace(/\/?$/, '/') + 'desktop.html'); await dp.waitForTimeout(2500);
    const d = await dp.evaluate(() => ({ tour: !!document.querySelector('#tour.on'), title: document.title }));
    ok(!d.tour && !derrs.length, 'desktop 1440x900: no phone tour overlay, no page errors', JSON.stringify({ d, derrs }));
    await dp.screenshot({ path: `${SHOTS}/12-desktop.png` }); await dctx.close(); }

  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
