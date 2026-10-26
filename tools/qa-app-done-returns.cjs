// QA: a finishing action inside an app (Morning "Skip today") returns James to the screen he came from in ONE tap
// (James, 25 Oct 2026: "don't make me click two buttons"). Also: × on the Morning card in Chats hides it in place.
// Usage: QA_READ_APP_PREFIX=/morning/ QA_READ_APP_PORT=9436 node tools/qa-origin.cjs 19471 web   (background)
//        node tools/qa-app-done-returns.cjs http://127.0.0.1:19471/wizard-os-home/
// Morning writes are answered from a local model; /wizard/* writes are refused, so James's real day is untouched.
const { chromium } = require('./qa-playwright.cjs');
const URL_ = process.argv[2] || 'http://127.0.0.1:19471/wizard-os-home/';
const OUT = process.env.QA_OUT || require('./qa-paths.cjs').workPath('app-done-returns/qa');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
  const S = ['workout', 'meditate', 'mindfeed', 'read'];
  const model = { day: 'qa', done: 0, total: 4, next: 'workout', next_label: 'Workout', hidden: false, steps: Object.fromEntries(S.map(s => [s, { done: false }])) };
  let hides = 0, stepWrites = 0, agentWrites = 0;
  await ctx.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url());
    if (u.pathname.startsWith('/wizard/') && !['GET', 'HEAD'].includes(r.method())) { agentWrites++; return route.fulfill({ status: 403, body: '{}' }); }
    if (u.pathname === '/morning/api/step') { stepWrites++; return route.fulfill({ status: 500, body: '{}' }); }
    if (u.pathname === '/morning/api/hide') { hides++; model.hidden = !!JSON.parse(r.postData() || '{}').hidden; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(model) }); }
    if (u.pathname === '/morning/api/status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(model) });
    if (u.pathname === '/morning/api/today') { const real = await route.fetch(); const d = await real.json(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...d, ...model }) }); }
    return route.continue();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e.message)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 90000 }).catch(() => {});
  await p.getByText('Skip').click({ timeout: 3000 }).catch(() => {});
  await p.evaluate(() => window.__wos.goDesk(1)).catch(() => {});
  await p.waitForSelector('[data-chmorning]', { timeout: 40000 }).catch(() => {});
  ok(!!(await p.$('[data-chmorning]')), '1 Morning card shows in Ready');
  const chatsDesk = await p.evaluate(() => window.__wos.state?.().idx ?? null).catch(() => null);
  await p.tap('[data-chmorning] .tx');
  let fr = null; for (let i = 0; i < 40 && !fr; i++) { await p.waitForTimeout(250); fr = p.frames().find(f => f.url().includes('/morning/')); }
  ok(!!fr, '2 tapping the card opens Morning');
  if (fr) {
    await fr.waitForSelector('#hideBtn:not([hidden])', { timeout: 20000 }).catch(() => {});
    await fr.waitForFunction(() => window.WizardApp?.nav?.back, null, { timeout: 15000 }).catch(() => {});
    await p.screenshot({ path: OUT + '/1-morning-open.png' });
    await fr.tap('#hideBtn');
    await p.waitForTimeout(1500);
    ok(hides === 1 && model.hidden && stepWrites === 0, '3 Skip today hides without ticking a step');
    const after = await p.evaluate(() => ({ morningOpen: [...document.querySelectorAll('iframe')].some(f => /\/morning\//.test(f.src) && f.getClientRects().length && f.closest('.win')?.getBoundingClientRect().width > 0 && f.closest('.desk')?.getBoundingClientRect().left === 0),
      chatsList: !!document.querySelector('.ch-list') && [...document.querySelectorAll('.ch-list')].some(l => { const r = l.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.left < innerWidth; }),
      card: !!document.querySelector('[data-chmorning]'), backLog: (window.__backLog || []).slice(-3) }));
    await p.screenshot({ path: OUT + '/2-after-skip.png' });
    ok(after.chatsList && !after.morningOpen, `4 one tap lands back on Chats (${JSON.stringify(after.backLog)})`);
    ok(!after.card, '5 the Morning card is gone from Ready');
  }
  // × on the card in Chats: hides in place, never opens Morning.
  Object.assign(model, { hidden: false, day: 'qa2' });
  await p.evaluate(() => window.postMessage({ type: 'wizard:morning', status: { day: 'qa2', done: 0, total: 4, next_label: 'Workout', hidden: false } }, location.origin));
  await p.waitForSelector('[data-chmorninghide]', { timeout: 10000 }).catch(() => {});
  const framesBefore = p.frames().filter(f => f.url().includes('/morning/')).length;
  await p.tap('[data-chmorninghide]').catch(() => {});
  await p.waitForTimeout(1200);
  ok(hides === 2 && !(await p.$('[data-chmorning]')), '6 × on the card hides it in place');
  ok(p.frames().filter(f => f.url().includes('/morning/')).length <= framesBefore, '7 × does not open Morning');
  ok(agentWrites === 0, `8 no agent writes (${agentWrites})`);
  ok(!errs.length, `9 no page errors ${errs.slice(0, 3).join(' | ')}`);
  console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
