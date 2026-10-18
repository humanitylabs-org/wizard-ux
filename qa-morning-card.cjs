// QA: Morning card pinned at the top of Ready (core/chats.js morningCard) + the Morning app it opens.
// Usage: node qa-morning-card.cjs [origin=http://127.0.0.1:18878/wizard-os-home/]
// Needs an origin that serves the shell plus /morning/ (Morning app). /wizard/* writes are fulfilled 403 here.
// Morning step writes are intercepted and answered from a local model, so James's real day is untouched.
const { chromium } = require('playwright');
const URL_ = process.argv[2] || 'http://127.0.0.1:18878/wizard-os-home/';
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/morning-stack/qa';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
  const model = { day: 'qa', done: 0, total: 3, next: 'workout', next_label: 'Workout', steps: { workout: { done: false }, meditate: { done: false }, read: { done: false } } };
  const recount = () => { const S = ['workout', 'meditate', 'read']; model.done = S.filter(s => model.steps[s].done).length; model.next = S.find(s => !model.steps[s].done) || null; model.next_label = { workout: 'Workout', meditate: 'Meditate', read: 'Read' }[model.next] || ''; };
  let agentWrites = 0, stepWrites = 0;
  await ctx.route('**/*', async (route) => {
    const r = route.request(), u = new URL(r.url());
    if (u.pathname.startsWith('/wizard/') && r.method() !== 'GET' && r.method() !== 'HEAD') { agentWrites++; return route.fulfill({ status: 403, body: '{}' }); }
    if (u.pathname === '/morning/api/step') { stepWrites++; const d = JSON.parse(r.postData() || '{}'); model.steps[d.step] = { done: !!d.done, source: 'you' }; recount(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(model) }); }
    if (u.pathname === '/morning/api/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(model) });
    if (u.pathname === '/morning/api/today') { const real = await route.fetch(); const d = await real.json(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...d, ...model, steps: model.steps }) }); }
    return route.continue();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e.message)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 90000 }).catch(() => {});
  // Get to the Chats list.
  await p.evaluate(() => window.__wos.goDesk(1)).catch(() => {});
  await p.waitForSelector('[data-sec="ready"]', { timeout: 30000 }).catch(() => {});
  await p.waitForSelector('[data-chmorning]', { timeout: 30000 }).catch(() => {});
  const card = await p.$('[data-chmorning]');
  ok(!!card, '1 Morning card renders');
  const pos = await p.evaluate(() => { const c = document.querySelector('[data-chmorning]'); const sec = c?.closest('[data-sec]'); const body = c?.parentElement; return { sec: sec?.dataset.sec, first: body?.firstElementChild === c, text: c?.innerText }; });
  ok(pos.sec === 'ready' && pos.first, '2 card is the first thing in Ready');
  ok(/Workout · Meditate · Read/.test(pos.text || ''), '3 card shows the three steps before anything is ticked');
  await p.screenshot({ path: OUT + '/1-ready-card.png' });
  // Stable under the sessions poll: the list must not be rebuilt while nothing changed.
  const muts = await p.evaluate(() => new Promise(res => { const el = document.querySelector('[data-chmorning]')?.closest('.ch-list'); let n = 0; const mo = new MutationObserver(m => { n += m.length; }); if (el) mo.observe(el, { childList: true, subtree: true }); setTimeout(() => { mo.disconnect(); res(n); }, 17000); }));
  ok(muts === 0, `4 list stays still across a sessions poll (${muts} mutations)`);
  // Tap opens Morning as an app window.
  await p.tap('[data-chmorning]');
  await p.waitForTimeout(2500);
  const fr = p.frames().find(f => f.url().includes('/morning/'));
  ok(!!fr, '5 tapping the card opens the Morning app');
  if (fr) {
    await fr.waitForSelector('.step[data-step="workout"].is-current', { timeout: 20000 }).catch(() => {});
    ok(!!(await fr.$('.step[data-step="workout"].is-current')), '6 Morning opens on the Workout step');
    const picks = await fr.$$eval('#picks .pick', els => els.length).catch(() => 0);
    ok(picks === 3, `7 three reading picks from Wisdom (${picks})`);
    const meds = await fr.$$eval('#meds .med', els => els.length).catch(() => 0);
    ok(meds >= 1, `8 meditations listed from Meditate (${meds})`);
    await p.screenshot({ path: OUT + '/2-morning-app.png' });
    await fr.click('.step[data-step="workout"] [data-done]');
    await p.waitForTimeout(800);
    ok(model.steps.workout.done && stepWrites >= 1, '9 Workout Done saves to Morning');
    // Open a meditation inside Morning, then hardware Back closes it and stays in Morning.
    await fr.click('#meds .med');
    await p.waitForTimeout(2500);
    ok(await fr.evaluate(() => window.__morning.sheetOpen()), '10 a meditation opens inside Morning');
    await p.screenshot({ path: OUT + '/3-meditate-sheet.png' });
    await p.evaluate(() => window.__wos.onBack && window.__wos.onBack());
    await p.waitForTimeout(800);
    const still = p.frames().find(f => f.url().includes('/morning/'));
    ok(!!still && !(await still.evaluate(() => window.__morning.sheetOpen())), '11 Back closes the meditation and Morning stays open');
    await still.click('.step[data-step="meditate"] [data-done]');
    await still.click('.step[data-step="read"] [data-done]').catch(() => {});
    await p.waitForTimeout(1200);
    ok(model.done === 3, '12 all three steps done');
  }
  // Back to Chats: the card updated from the app's message without waiting for a poll.
  await p.evaluate(() => window.__wos.onBack && window.__wos.onBack()); await p.waitForTimeout(600);
  await p.evaluate(() => window.__wos.goDesk(1)).catch(() => {}); await p.waitForTimeout(1500);
  const after = await p.evaluate(() => { const c = document.querySelector('[data-chmorning]'); return { done: c?.classList.contains('done'), text: c?.innerText }; });
  ok(after.done && /Done for today/.test(after.text || ''), '13 card shows Done for today once all three are ticked');
  await p.screenshot({ path: OUT + '/4-ready-done.png' });
  ok(agentWrites === 0, `14 no Wizard agent writes (${agentWrites})`);
  ok(!errs.length, '15 no page errors ' + errs.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
