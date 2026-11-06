// Phone row-swipe acceptance: all data is synthetic and every write is intercepted.
// Usage: QA_TREE=<repo-or-baseline> QA_EXPECT_SWIPE=1|0 node qa-chat-row-swipe.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');
const TREE = process.env.QA_TREE || __dirname;
const EXPECT = process.env.QA_EXPECT_SWIPE !== '0';
const OUT = process.env.QA_OUT || path.join(require('os').tmpdir(), 'wizard-row-swipe');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d === '' ? '' : ' ' + JSON.stringify(d)}`); };
const now = Date.now() / 1000;
const session = { id: 'qa_swipe_thread', title: 'QA swipe fixture', source: 'wizard-mobile', status: 'completed', archived: false, hidden: false, message_count: 2, started_at: now - 400, last_active: now - 20, wizard_last_user_at: now - 80, wizard_last_assistant_at: now - 20, latest_message: { role: 'assistant', content: 'Fixture reply', timestamp: now - 20 }, last_user_message: { role: 'user', content: 'Fixture question', timestamp: now - 80 } };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const writes = [], errors = [];
  const routeRequest = async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    if (u.hostname !== 'wizard.test') return route.abort();
    if (!['GET', 'HEAD'].includes(method)) {
      writes.push({ method, path: u.pathname, body: req.postData() || '' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, record: {} }) });
    }
    if (u.pathname === '/wizard/hermes/api/sessions') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [session], has_more: false, limit: 100, offset: 0, snapshot: 'qa' }) });
    if (u.pathname === '/wizard/hermes/api/sessions/qa_swipe_thread/messages') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: [{ id: 1, session_id: session.id, role: 'user', content: 'Fixture question', timestamp: now - 80 }, { id: 2, session_id: session.id, role: 'assistant', content: 'Fixture reply', timestamp: now - 20 }], pagination: { limit: 500, offset: 0, returned: 2 } }) });
    if (u.pathname === '/wizard/thread-seen') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: 1, threads: {} } }) });
    if (u.pathname === '/wizard/v1/boomerangs') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"reminders":[]}' });
    if (u.pathname.startsWith('/wizard/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m) {
      const rel = m[1] || 'index.html', file = path.join(TREE, 'web', rel);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 200, contentType: rel.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
      const ct = rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : rel.endsWith('.json') ? 'application/json' : rel.endsWith('.png') ? 'image/png' : rel.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript';
      return route.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(file) });
    }
    return route.fulfill({ status: 404, body: '' });
  };
  await ctx.route('**/*', routeRequest);
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.skin', 'sepia'); });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wos && window.WizCore?.apps, null, { timeout: 20000 });
  await page.evaluate(() => { WosSkin.set('sepia'); __wos.openApp(WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')); });
  const wid = await page.waitForFunction(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.id || '', null, { timeout: 10000 }).then(h => h.jsonValue());
  const root = `[data-chats="${wid}"]`, rowSel = `${root} .ch-row[data-chopen="qa_swipe_thread"]`;
  await page.waitForSelector(rowSel, { timeout: 20000 }); await sleep(350);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })) });
  const center = async () => { const b = await page.locator(rowSel).boundingBox(); return [b.x + b.width * .72, b.y + b.height / 2]; };
  async function drag(dx, dy = 0, end = 'touchEnd', steps = 10) { const [x, y] = await center(); await touch('touchStart', [[x, y]]); for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x + dx * i / steps, y + dy * i / steps]]); await sleep(16); } await touch(end, []); await sleep(220); }
  const state = () => page.evaluate(sel => { const wrap = document.querySelector(sel)?.closest('.ch-row-wrap'), tray = wrap?.querySelector('.ch-swipe-acts'); return { skin: document.documentElement.dataset.skin, shell: document.documentElement.dataset.shell, open: !!wrap?.classList.contains('swiped'), transform: document.querySelector(sel)?.style.transform || '', tray: !!tray, hidden: tray?.getAttribute('aria-hidden'), tabs: tray ? [...tray.querySelectorAll('button')].map(b => b.tabIndex) : [], labels: tray ? [...tray.querySelectorAll('button')].map(b => b.innerText.trim()) : [] }; }, rowSel);

  await drag(-280);
  let s = await state();
  if (!EXPECT) {
    ok(!s.tray, 'baseline has no reveal tray', s);
    ok(writes.length === 0, 'baseline gesture caused no fixture write', writes);
    ok(errors.length === 0, 'baseline has no page errors', errors);
    console.log(`${pass}/${pass + fail} passed`); await browser.close(); process.exit(fail ? 1 : 0);
  }
  ok(s.open && s.hidden === 'false' && s.tabs.every(x => x === 0), 'left swipe reveals keyboard-visible actions', s);
  ok(s.labels.join('|').includes('Recall') && s.labels.join('|').includes('Done'), 'tray names Recall and Done', s.labels);
  ok(writes.length === 0, 'even a long swipe performs no action', writes);
  await page.screenshot({ path: path.join(OUT, 'candidate-sepia-swipe.png') });

  const sameBefore = await page.evaluate(sel => { const w = document.querySelector(sel).closest('.ch-row-wrap'); w.dataset.qaNode = 'held'; WizLive.emit(); return w; }, rowSel);
  await sleep(350); s = await state();
  ok(s.open && await page.evaluate(sel => document.querySelector(sel).closest('.ch-row-wrap').dataset.qaNode === 'held', rowSel), 'live repaint keeps the revealed row connected');

  await page.evaluate(sel => document.querySelector(sel).closest('.ch-scroll').dispatchEvent(new Event('scroll', { bubbles: false })), rowSel); await sleep(250);
  ok(!(await state()).tray, 'scroll closes the reveal');

  await drag(-110, 0, 'touchCancel');
  ok(!(await state()).tray && writes.length === 0, 'pointercancel closes without action', { state: await state(), writes });

  await drag(-110); await page.evaluate(sel => document.querySelector(sel).closest('.ch-scroll').dispatchEvent(new MouseEvent('click', { bubbles: true })), rowSel); await sleep(220);
  ok(!(await state()).tray, 'outside tap closes and suppresses row open');

  await page.evaluate(() => WosSkin.set('novairecito')); await sleep(120);
  if (await page.$('.nv-boot')) { await page.locator('.nv-boot').click({ position: { x: 10, y: 10 } }); await page.waitForSelector('.nv-boot', { state: 'detached', timeout: 2500 }); }
  await drag(-110);
  ok((await state()).open && (await state()).labels.join('|').includes('Recall'), 'Noir palette reveals the same actions');
  await page.evaluate(sel => document.querySelector(sel).closest('.ch-scroll').dispatchEvent(new Event('scroll')), rowSel); await sleep(180);

  await page.evaluate(() => WosSkin.set('nebula')); await sleep(120); await drag(-110);
  ok(!(await state()).tray, 'non-owner phone skin keeps stock gesture behavior');
  await page.keyboard.press('Escape'); await page.evaluate(() => WosSkin.set('sepia')); await sleep(150);

  await drag(-110); await page.locator(`${root} [data-chswipe="recall"]`).click(); await sleep(150);
  ok(!!(await page.$('.boom-sheet [role="dialog"]')) && writes.length === 0, 'Recall opens scheduler without creating a reminder');
  await page.locator('[data-boom-close]').first().click();

  await drag(-110); await page.locator(`${root} [data-chswipe="done"]`).click(); await sleep(450);
  const archiveWrites = writes.filter(w => w.method === 'PATCH' && /qa_swipe_thread$/.test(w.path) && /"archived":true/.test(w.body));
  ok(archiveWrites.length === 1, 'Done archives only after its explicit tap', archiveWrites);

  await page.screenshot({ path: path.join(OUT, 'candidate-after-done.png') });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await desktop.route('**/*', routeRequest);
  await desktop.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.skin', 'sepia'); });
  const dp = await desktop.newPage(); dp.on('pageerror', e => errors.push('desktop: ' + String(e)));
  await dp.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
  await dp.waitForFunction(() => document.documentElement.dataset.shell === 'desktop' && window.__wux, null, { timeout: 20000 });
  await dp.waitForSelector('.ch-row[data-chopen="qa_swipe_thread"]', { timeout: 20000 });
  const db = await dp.locator('.ch-row[data-chopen="qa_swipe_thread"]').boundingBox(), dcdp = await desktop.newCDPSession(dp);
  const dtouch = (type, pts) => dcdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 2 })) });
  await dtouch('touchStart', [[db.x + db.width * .7, db.y + db.height / 2]]); await dtouch('touchMove', [[db.x + db.width * .7 - 120, db.y + db.height / 2]]); await dtouch('touchEnd', []); await sleep(180);
  ok(!(await dp.$('.ch-swipe-acts')), 'desktop Sepia keeps stock gesture behavior and no reveal tray');
  await desktop.close();
  ok(errors.length === 0, 'candidate has no page errors', errors);
  console.log(`${pass}/${pass + fail} passed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
