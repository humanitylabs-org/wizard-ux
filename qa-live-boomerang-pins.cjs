// Live acceptance on the owner's real Wizard: a 2-minute Boomerang on one thread comes back (banner, Ready, desktop
// notification, phone watch endpoint), and a pin made at phone width shows on the desktop. Cleans up after itself.
// Usage (from a tailnet host): WIZARD_ORIGIN=https://<host> QA_THREAD=<session id> QA_PLAYWRIGHT=<pw> node qa-live-boomerang-pins.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const ORIGIN = process.env.WIZARD_ORIGIN, ID = process.env.QA_THREAD, OUT = process.env.QA_OUT || '.';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x === '' ? '' : JSON.stringify(x).slice(0, 500)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const open = async (desktop) => {
    const ctx = await b.newContext(desktop ? { viewport: { width: 1440, height: 900 } } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    if (desktop) await ctx.grantPermissions(['notifications'], { origin: ORIGIN });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.done', '1'); } catch (e) {} // the first-run tour holds every tap
      window.__notes = [];
      const N = function (t, o) { window.__notes.push({ t, body: o?.body }); this.close = () => {}; };
      N.permission = 'granted'; N.requestPermission = async () => 'granted'; window.Notification = N;
    });
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(ORIGIN + '/wizard-os-home/' + (desktop ? 'desktop.html' : ''), { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(id => window.WizLive?.ok && window.WizLive.session(id) && window.WosBoomerang && window.WosChatPins, ID, { timeout: 90000 });
    return { ctx, p, errs };
  };
  const phone = await open(false), desk = await open(true);
  const P = phone.p, D = desk.p;
  let jobId = null;
  try {
    // ---- Pin on the phone, see it on the desktop.
    const before = await P.evaluate(() => window.WosChatPins.ids());
    ok(!before.includes(ID), 'thread starts unpinned', before);
    await P.evaluate(id => window.WosChatPins.toggle(id), ID); await sleep(1500);
    await D.evaluate(() => window.WizLive.pullPrefs?.() ?? null); await sleep(1500);
    let seen = await D.evaluate(id => window.WosChatPins.has(id), ID);
    if (!seen) { await D.reload({ waitUntil: 'domcontentloaded' }); await D.waitForFunction(() => window.WosChatPins && window.WizLive?.ok, null, { timeout: 90000 }); await sleep(2000); seen = await D.evaluate(id => window.WosChatPins.has(id), ID); }
    ok(seen, 'pin made on the phone is on the desktop');
    await P.evaluate(id => window.WosChatPins.toggle(id), ID); await sleep(1500);

    // ---- Boomerang this thread for two minutes from now, through the picker.
    await P.evaluate(id => window.__wos.openWizardThread(id), ID); await sleep(2500);
    await P.evaluate(id => window.__wos.threadAct(Object.values(window.__wos.wins).find(w => w.thread === id).id, id, 'boomerang'), ID).catch(() => {});
    if (!(await P.locator('.boom-card').count())) await P.locator('.ch-tacts [data-chact="boomerang"]:visible').first().click();
    await P.locator('.boom-card').waitFor();
    const due = new Date(Date.now() + 120000 + (60000 - Date.now() % 60000));
    const wall = await P.evaluate(t => { const f = new Intl.DateTimeFormat('en-CA', { timeZone: document.querySelector('.boom-card select[name=timezone]').value, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)); const g = k => f.find(x => x.type === k).value; return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` }; }, due.getTime());
    await P.locator('.boom-card input[name=date]').fill(wall.date);
    await P.locator('.boom-card input[name=time]').fill(wall.time);
    await P.screenshot({ path: `${OUT}/live-phone-picker.png` });
    await P.locator('.boom-card [type=submit]').click(); await sleep(2000);
    const job = await P.evaluate(async id => (await (await fetch('/wizard/v1/schedules', { cache: 'no-store' })).json()).schedules.filter(j => j.kind === 'return' && j.thread === id).at(-1), ID);
    jobId = job?.id;
    ok(job && Date.parse(job.when.once) === due.getTime() && job.enabled, 'saved on the scheduler as a return job at the chosen minute', job);
    const r0 = await P.evaluate(async id => (await fetch(`/wizard/hermes/v1/runs/wzb_${id}`)).json(), jobId);
    ok(r0.status === 'queued', 'phone watch endpoint: queued before it is due', r0);
    // Desktop sees it in Settings → Schedules data too.
    console.log('waiting for', due.toISOString());
    while (Date.now() < due.getTime() + 45000) await sleep(5000);
    let r1; for (let i = 0; i < 12; i++) { r1 = await P.evaluate(async id => (await fetch(`/wizard/hermes/v1/runs/wzb_${id}`)).json(), jobId); if (r1.status === 'completed') break; await sleep(10000); }
    ok(r1.status === 'completed', 'phone watch endpoint: completed once it came back (the phone notifies on this)', r1);
    await P.evaluate(() => window.WosBoomerang.refresh()); await D.evaluate(() => window.WosBoomerang.refresh()); await sleep(2500);
    const ban = await P.locator('.boom-banner').first().innerText().catch(() => '');
    ok(/Boomerang is back/.test(ban), 'phone: banner in the thread', ban);
    await P.screenshot({ path: `${OUT}/live-phone-banner.png` });
    const notes = await D.evaluate(() => window.__notes);
    ok(notes.some(n => n.t.startsWith('🪃')), 'desktop: system notification', notes);
    const s = await P.evaluate(id => { const s = window.WizLive.session(id); return { deferred: !!s.deferred, archived: !!s.archived }; }, ID);
    ok(!s.deferred && !s.archived, 'thread is in Ready (not deferred or archived)', s);
    await P.locator('.boom-banner [data-boom-done]').first().click(); await sleep(2000);
    const left = await P.evaluate(async id => (await (await fetch('/wizard/v1/schedules', { cache: 'no-store' })).json()).schedules.some(j => j.id === id), jobId);
    ok(!left, 'Done removes the returned Boomerang');
    if (!left) jobId = null;
    ok(phone.errs.length === 0 && desk.errs.length === 0, 'no page errors', [...phone.errs, ...desk.errs]);
  } finally {
    if (jobId) await P.evaluate(async id => fetch(`/wizard/v1/schedules/${id}`, { method: 'DELETE' }), jobId).catch(() => {});
    await P.evaluate(id => { if (window.WosChatPins.has(id)) window.WosChatPins.toggle(id); }, ID).catch(() => {});
    await sleep(1000); await b.close();
  }
  console.log(`${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
