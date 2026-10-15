// Mizel.ai recordings QA: a "🎙 …" thread shows as Mizel.ai in the shade, appears on the Mizel desk strip,
// and a tap opens it in the Chats window. Every Hermes/Wizard write is intercepted; the run fails on any real /v1/runs.
const { chromium } = require('/home/telos/node_modules/playwright');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const OUT = process.env.QA_OUT || '/home/telos/apps/wizard-os-home/qa-live';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP wizard.tailc0f369.ts.net 127.0.0.1:18443'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen)|\/v1\/runs/.test(u)) { writes.push(q.method() + ' ' + u.replace(/^https:\/\/[^/]+/, '')); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (/qa-rec-/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) });
    return r.continue();
  });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => { if (/wizard-os-home\//.test(String(e.stack))) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && __wos.live && __wos.live.ok, null, { timeout: 30000 });

  // Two synthetic recording threads (never sent anywhere): one with follow-ups running, one finished.
  const now = new Date().toISOString();
  await p.evaluate(now => {
    const L = __wos.live;
    L.sessions = [
      { id: 'qa-rec-run', title: '🎙 QA standup recording', status: 'running', preview: 'Working through 3 follow-ups', activityAt: now, updatedAt: now, lastUserAt: now },
      { id: 'qa-rec-done', title: '🎙 QA design review', status: 'completed', preview: '✅ All 4 follow-ups ready for your review', activityAt: now, updatedAt: now, lastAssistantAt: now },
      ...L.sessions.filter(s => !/^qa-rec-/.test(s.id)),
    ];
    L.emit();
  }, now);

  // 1. Shade shows the source as Mizel.ai
  await p.evaluate(() => __wos.openSheet('inbox')); await p.waitForTimeout(700);
  const shade = await p.evaluate(() => [...document.querySelectorAll('#inboxBody .note')].filter(n => /qa-rec-/.test(n.dataset.note)).map(n => ({ id: n.dataset.note, g: n.dataset.g, src: n.querySelector('.src').textContent, ic: n.querySelector('.ic').textContent })));
  ok(shade.some(n => n.id === 'qa-rec-run' && n.src === 'Mizel.ai' && n.ic === '◉' && n.g === 'working'), 'running 🎙 thread is in the shade as Mizel.ai, under Working', JSON.stringify(shade));
  await p.evaluate(() => document.querySelector('#inboxBody .note[data-note="qa-rec-run"]').scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/rec-shade.png' });
  await p.evaluate(() => __wos.closeSheets()); await p.waitForTimeout(400);

  // 2. Mizel desk strip lists both with state
  await p.evaluate(() => __wos.goDesk(__wos.HOME + 2)); await p.waitForTimeout(1200);
  const strip = await p.evaluate(() => [...document.querySelectorAll('.rec-strip [data-rec]')].map(r => ({ id: r.dataset.rec, t: r.querySelector('.rn').textContent, s: r.querySelector('.rs').textContent, vis: r.getBoundingClientRect().width > 0 && r.getBoundingClientRect().left >= 0 })));
  const run = strip.find(r => r.id === 'qa-rec-run'), done = strip.find(r => r.id === 'qa-rec-done');
  ok(run && run.s === '⏳' && run.t === 'QA standup recording' && run.vis, 'Mizel desk strip lists the running recording with ⏳', JSON.stringify(strip.slice(0, 3)));
  ok(done && done.s === '✅', 'finished recording shows ✅', JSON.stringify(done));
  const geo = await p.evaluate(() => { const s = document.querySelector('.desk:nth-child(' + (__wos.HOME + 3) + ') .rec-strip') || document.querySelector('.rec-strip'); const f = s.parentElement.querySelector('.frame-wrap'); return { stripBottom: s.getBoundingClientRect().bottom, frameTop: f.getBoundingClientRect().top }; });
  ok(geo.frameTop >= geo.stripBottom - 1, 'strip sits above the /meetings frame', JSON.stringify(geo));
  await p.screenshot({ path: OUT + '/rec-strip.png' });

  // 3. Tap opens it in the Chats window
  await p.locator('.rec-strip [data-rec="qa-rec-done"]').first().tap(); await p.waitForTimeout(1200);
  const opened = await p.evaluate(() => Object.values(__wos.wins).filter(w => w.app === 'chats').map(w => w.thread));
  ok(opened.includes('qa-rec-done'), 'tapping the strip row opens the thread in Chats', JSON.stringify(opened));

  ok(!writes.some(w => /\/v1\/runs/.test(w)), 'QA produced zero /v1/runs', JSON.stringify(writes));
  ok(errs.length === 0, 'no shell errors', errs.join(' | '));
  console.log(`${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('Error', e); process.exit(2); });
