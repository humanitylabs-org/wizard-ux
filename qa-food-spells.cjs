// QA (Food spells, James 12 Oct): the Grab food app is called Food (was Usuals), and easy spells run it from any orb:
// "order grab" / "order food" / "order lunch" / "I want to order food" open Grab for a new order (native usualsRun('+new')),
// "order my usual kra pao" still runs a saved one, "food" opens the Food app (spells listed inside), ordinary talk
// about food goes to Wizard as before. Native bridge is faked; its usualsMatch() knows only saved orders, like an
// app build that predates the new phrases, so the web spell has to carry them. Every Hermes/Wizard write is refused.
// Usage: node qa-food-spells.cjs   (QA_WEB_DIR=<tree> to point at another tree, QA_SHOTS=<dir> for screenshots)
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname, SHOTS = process.env.QA_SHOTS || '';
// The assertions stay identical after extraction; only registry/static transport
// and traversal of the real app window cross the new package boundary.
const FOOD = process.env.QA_FOOD_APP_DIR || '';
const FOOD_REGISTRY = {id:'usuals',name:'Food',url:'/usuals/',provides:['voice-commands'],voice_names:['Food','Usuals','usual','food app','wizard eats','saved orders','eats','bites']};
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const THREADS = Array.from({ length: 4 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview', last_active: NOW / 1000 - i * 600, started_at: NOW / 1000 - i * 600 - 60 }));
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.hostname !== new URL(require('./tools/qa-paths.cjs').origin()).hostname) return r.abort();
    if (FOOD && u.pathname.startsWith('/usuals/')) {
      const base = path.resolve(FOOD, 'app/static'), file = path.resolve(base, u.pathname.slice('/usuals/'.length) || 'index.html');
      if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) return r.fulfill({status:404,body:'not found'});
      return r.fulfill({status:200,contentType:CT[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
    }
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW, threads: {} } });
      if (u.pathname === '/wizard/v1/route') return json(r, { ms: 5, cmd: { route: 'agent' } });
      return json(r, { error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: THREADS, has_more: false });
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) return json(r, { object: 'list', data: [{ id: 1, role: 'user', content: 'hello', timestamp: NOW / 1000 - 100 }, { id: 2, role: 'assistant', content: 'hi', timestamp: NOW / 1000 - 90 }] });
    const sm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) { const t = THREADS.find(x => x.id === decodeURIComponent(sm[1])); return t ? json(r, { session: t }) : json(r, { error: 'not_found' }, 404); }
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json(r, { state: {} });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: FOOD ? [FOOD_REGISTRY] : [] });
    return json(r, {});
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {}
    const list = [{ id: 'u1', name: 'Kra pao moo saap + Thai iced tea', basket: '2× Kra pao moo saap · 1× Thai iced tea', lastTotal: '฿200', steps: 7, pkg: 'com.grabtaxi.passenger' }];
    window.__runs = [];
    window.WizardOSNative = {
      sideButton() { return '{}'; },
      usuals() { return JSON.stringify({ list, blocker: '', state: { mode: 'idle', status: '' } }); },
      // Like a 0.9.5 build: knows saved orders by name, not the new spells ("order lunch", "I want to order food").
      usualsMatch(s) { s = String(s).toLowerCase(); return /\b(order|get)\b.*\bkra pao\b/.test(s) ? 'u1' : ''; },
      usualsRun(id) { window.__runs.push(id); return ''; },
      usualsTeach() { return ''; }, usualsSave() { return true; }, usualsKeepName() {}, usualsDelete() {}, usualsCancel() {},
    };
  });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.goto(ORIGIN + '/qa-start').catch(() => {});
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForFunction(() => window.WizCore.apps && document.querySelector('#search'), null, { timeout: 10000 });
  await sleep(1200);
  return { ctx, p, writes };
}
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const runs = p => p.evaluate(() => window.__runs.slice());
const foodWin = p => p.evaluate(() => { const frame = [...document.querySelectorAll('iframe:not([data-voice-service])')].find(f => new URL(f.src, location.href).pathname === '/usuals/' && f.closest('.win')); const el = document.querySelector('[data-usuals]') || frame?.contentDocument?.querySelector('[data-usuals]'); const w = frame?.closest('.win') || el?.closest('.win'); return { open: !!el, title: w ? (w.querySelector('.wt, .win-title, .wtitle, header')?.innerText || w.innerText.split('\n')[0]) : '', text: el ? el.innerText : '' }; });

(async () => {
  const b = await chromium.launch({executablePath:process.env.QA_CHROME || undefined});
  const { p, writes } = await boot(b);

  // 1. The app is called Food: the list entry and the voice lookups.
  const app = await p.evaluate(() => { const R = window.WizCore.apps('mobile'); const a = R.APP.usuals; return { name: a && a.name, food: R.findApp('food')?.id, eats: R.findApp('wizard eats')?.id, usuals: R.findApp('usuals')?.id }; });
  ok(app.name === 'Food', 'the app is named Food', JSON.stringify(app));
  ok(app.food === 'usuals' && app.eats === 'usuals' && app.usuals === 'usuals', '"food", "wizard eats" and the old name "usuals" all find it', JSON.stringify(app));

  // 2. Spells that open Grab for a new order, from the home screen. Nothing goes to Wizard.
  const NEW = ['Order grab', 'Order food.', 'Hey Wizard, order food please', 'I want to order lunch', 'order dinner from Grab', 'get me some food', 'order takeout'];
  for (const said of NEW) {
    const r0 = (await runs(p)).length, w0 = writes.length;
    await p.evaluate(s => window.__wos.handleText(s, 'command'), said); await sleep(500);
    const r = await runs(p);
    ok(r.length === r0 + 1 && r[r.length - 1] === '+new' && writes.length === w0, `"${said}" opens Grab for a new order, nothing to Wizard`, JSON.stringify({ runs: r.slice(r0), writes: writes.slice(w0) }));
  }
  // Held orb (command) too
  { const r0 = (await runs(p)).length; await p.evaluate(() => window.__wos.handleText('order grab', 'command')); await sleep(500); const r = await runs(p); ok(r[r0] === '+new', '"order grab" on a held orb opens Grab too', JSON.stringify(r.slice(r0))); }

  // 3. A saved order still runs by name.
  { const r0 = (await runs(p)).length; await p.evaluate(() => window.__wos.handleText('order my usual kra pao', 'command')); await sleep(500); const r = await runs(p); ok(r[r0] === 'u1', '"order my usual kra pao" runs the saved order', JSON.stringify(r.slice(r0))); }

  // 4. Ordinary talk about food is not a spell.
  for (const said of ['what food should I order tonight', 'the grab driver is late', 'order a taxi']) {
    const r0 = (await runs(p)).length;
    await p.evaluate(s => window.__wos.handleText(s, 'command'), said); await sleep(500);
    const fw = await foodWin(p);
    ok((await runs(p)).length === r0 && !fw.open, `"${said}" starts nothing and opens nothing`, JSON.stringify(fw));
  }

  // 5. "Food" on its own opens the Food app, which lists the spells.
  await p.evaluate(() => window.__wos.handleText('Food', 'command')); await sleep(1200);
  const fw = await foodWin(p);
  await shot(p, 'food-app');
  ok(fw.open, '"Food" opens the Food app', JSON.stringify(fw));
  ok(/Food/.test(fw.title) && !/Usuals/.test(fw.title), 'its window is titled Food', fw.title);
  ok(/order food/i.test(fw.text) && /order grab/i.test(fw.text) && /order kra pao/i.test(fw.text), 'the app lists the spells (order food / order grab / order <saved dish>)', fw.text.slice(0, 300));
  ok(!/usual/i.test(fw.text), 'no "usual" wording left in the app', fw.text.slice(0, 400));

  // 6. Back from Food stays in Wizard OS.
  const before = p.url();
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__wos.onBack()); await sleep(600); }
  const bl = await p.evaluate(() => ({ log: (window.__backLog || []).slice(-3), home: window.__wos.idx }));
  ok(p.url() === before && bl.log[0] && bl.log[0] !== 'exit-warn', 'Back steps out of Food inside Wizard OS (no exit)', JSON.stringify(bl));

  ok(p.errs.length === 0, 'no page errors', p.errs.join(' | '));
  console.log(`${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
