// Chat pins (James, 31 Oct 2026): no pin button on rows by default, Pin in the row menu (right-click / hold), no Open
// in that menu, "Show pin buttons" tweak brings row pins back, Novairecito keeps them on. Synthetic data, writes intercepted.
// Usage: QA_TREE=<repo> QA_PLAYWRIGHT=<playwright> QA_OUT=<dir> node qa-chat-pin-menu.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname;
const OUT = process.env.QA_OUT || path.join(require('os').tmpdir(), 'wizard-pin-menu');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d === '' ? '' : ' ' + JSON.stringify(d)}`); };
const now = Date.now() / 1000;
const mk = (id, title, ago) => ({ id, title, source: 'wizard-mobile', status: 'completed', archived: false, hidden: false, message_count: 2, started_at: now - 900, last_active: now - ago, wizard_last_user_at: now - ago - 60, wizard_last_assistant_at: now - ago, latest_message: { role: 'assistant', content: 'Fixture reply for ' + title, timestamp: now - ago }, last_user_message: { role: 'user', content: 'Fixture question', timestamp: now - ago - 60 } });
const sessions = [mk('qa_pin_a', 'QA · Pin fixture A', 20), mk('qa_pin_b', 'QA · Pin fixture B', 120), mk('qa_pin_c', 'QA · Pin fixture C', 300)];
// A routed host-profile agent's own synthetic threads (listed only with ?agent=qa-host): same shared row menu.
const ROUTED = 'qa-host', routed = [{ ...mk('qa_pin_r1', 'QA · Routed pin fixture', 40), agent: { id: ROUTED, label: 'Synthetic routed', privacy: 'standard' } }];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const writes = [], errors = []; let prefs = { pinnedChats: [] };
  const routeRequest = async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    if (u.hostname !== 'wizard.test') return route.abort();
    if (u.pathname === '/wizard/v1/ui-preferences') {
      if (method === 'PUT') { writes.push({ method, path: u.pathname }); prefs = { ...prefs, ...req.postDataJSON() }; }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prefs) });
    }
    if (!['GET', 'HEAD'].includes(method)) { writes.push({ method, path: u.pathname }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, record: {} }) }); }
    if (u.pathname === '/wizard/v1/agents') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'hermes', is_default: true, label: 'Hermes', harness: 'hermes', privacy: 'standard', status: 'running' }, { id: ROUTED, label: 'Synthetic routed', harness: 'hermes', privacy: 'standard', status: 'running' }] }) });
    if (u.pathname === '/wizard/hermes/api/sessions') { const ag = u.searchParams.get('agent') || '', first = (u.searchParams.get('offset') || '0') === '0'; const data = !first ? [] : ag === ROUTED ? routed : ag ? [] : sessions; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data, has_more: false, limit: 100, offset: 0, snapshot: 'qa' }) }); }
    if (u.pathname === '/wizard/thread-seen') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: 1, threads: {} } }) });
    if (u.pathname === '/wizard/v1/boomerangs') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"reminders":[]}' });
    if (u.pathname.startsWith('/wizard/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m) {
      const rel = (m[1] || 'index.html').split('?')[0], file = path.join(TREE, 'web', rel);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
      const ct = rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : rel.endsWith('.json') ? 'application/json' : rel.endsWith('.png') ? 'image/png' : rel.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript';
      return route.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(file) });
    }
    return route.fulfill({ status: 404, body: '' });
  };
  const settle = page => page.waitForFunction(() => window.WosExperience && !WosExperience.state.busy, null, { timeout: 15000 }).then(() => sleep(250)).then(() => page.evaluate(() => document.getElementById('wosWelcome')?.remove()));
  const setSkin = async (page, id) => {
    await page.evaluate(id => WosSkin.set(id), id); await sleep(150);
    if (await page.$('.nv-boot')) { await page.locator('.nv-boot').click({ position: { x: 10, y: 10 } }).catch(() => {}); await page.waitForSelector('.nv-boot', { state: 'detached', timeout: 3000 }).catch(() => {}); }
    await settle(page);
  };
  const pinShown = (page, root) => page.evaluate(root => [...document.querySelectorAll(`${root} .ch-pin-toggle`)].filter(b => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0).length, root);
  const rowCount = (page, root) => page.evaluate(root => document.querySelectorAll(`${root} .ch-row[data-chopen]`).length, root);
  const menu = (page, root, sid) => page.evaluate(({ root, sid }) => {
    const row = document.querySelector(`${root} .ch-row[data-chopen="${sid}"]`), b = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 40, clientY: b.y + 10, button: 2 }));
    const sheet = document.querySelector('.ch-sheet'); if (!sheet) return null;
    const labels = [...sheet.querySelectorAll('button')].filter(x => getComputedStyle(x).display !== 'none').map(x => x.innerText.trim());
    return { labels, pinVisible: !!sheet.querySelector('[data-rspin]') && getComputedStyle(sheet.querySelector('[data-rspin]')).display !== 'none' };
  }, { root, sid });
  const closeMenu = page => page.evaluate(() => { document.querySelector('.ch-sheet')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }).then(() => sleep(250));

  // Phone
  const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', routeRequest);
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.skin', 'nebula'); } catch (_) {} });
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wos && window.WizCore?.apps, null, { timeout: 20000 });
  await page.evaluate(() => __wos.openApp(WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')));
  const wid = await page.waitForFunction(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.id || '', null, { timeout: 10000 }).then(h => h.jsonValue());
  const root = `[data-chats="${wid}"]`;
  await page.waitForSelector(`${root} .ch-row[data-chopen="qa_pin_a"]`, { timeout: 20000 }); await settle(page);

  for (const skin of ['nebula', 'obsidian']) {
    await setSkin(page, skin);
    ok(await pinShown(page, root) === 0, `${skin}: no pin button on chat rows by default`);
    const m = await menu(page, root, 'qa_pin_a');
    ok(m && m.pinVisible && m.labels.includes('Pin'), `${skin}: row menu has Pin`, m);
    ok(m && !m.labels.includes('Open'), `${skin}: row menu has no Open`, m);
    await page.screenshot({ path: path.join(OUT, `phone-${skin}-menu.png`) });
    await closeMenu(page);
    const t = await page.evaluate(() => WosExperience.state.tweaks.find(t => t.id === 'wizard/pin-buttons'));
    ok(t && t.name === 'Show pin buttons' && t.on === false, `${skin}: Show pin buttons tweak is listed and off`, t);
  }
  await setSkin(page, 'nebula');
  await sleep(800); // settle the desk transition before driving real phone input
  const touch = await ctx.newCDPSession(page);
  const touchMenu = async kind => {
    const box = await page.locator(`${root} .ch-row[data-chopen="qa_pin_a"]`).boundingBox();
    const x = box.x + box.width * .72, y = box.y + box.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    if (kind === 'hold') await sleep(650);
    else for (let i = 1; i <= 8; i++) { await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 12, y, id: 1 }] }); await sleep(20); }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(150);
    const labels = await page.locator('.ch-sheet button').allTextContents();
    ok(labels.some(l => /^(Pin|Unpin)$/.test(l.trim())) && !labels.some(l => l.trim() === 'Open'), `phone ${kind}: shared menu has Pin and no Open`, labels);
    await closeMenu(page);
    await sleep(750); // the preceding lift is deliberately suppressed by the row gesture owner
  };
  await touchMenu('hold'); await touchMenu('swipe'); await touch.detach();
  const before = writes.length;
  await menu(page, root, 'qa_pin_b');
  ok(await page.evaluate(() => { document.querySelector('.ch-sheet [data-rspin]').click(); return WosChatPins.has('qa_pin_b') && !document.querySelector('.ch-sheet'); }), 'menu Pin pins the chat and closes the menu');
  await sleep(400);
  ok(writes.slice(before).some(w => w.method === 'PUT' && w.path === '/wizard/v1/ui-preferences') && prefs.pinnedChats.includes('qa_pin_b'), 'pin write intercepted and read back (never reached a real Wizard)');
  await page.evaluate(() => WosExperience.toggle('wizard/pin-buttons')); await settle(page);
  ok(await pinShown(page, root) === await rowCount(page, root) && await rowCount(page, root) >= sessions.length, 'Show pin buttons on: every row gets its pin button', [await pinShown(page, root), await rowCount(page, root)]);
  await page.screenshot({ path: path.join(OUT, 'phone-nebula-tweak-on.png') });
  await page.evaluate(() => WosExperience.toggle('wizard/pin-buttons')); await settle(page);
  ok(await pinShown(page, root) === 0, 'Show pin buttons off again: buttons gone');
  for (const skin of ['novairecito', 'sepia']) {
    await setSkin(page, skin);
    ok(await pinShown(page, root) === await rowCount(page, root) && await rowCount(page, root) >= sessions.length, `${skin} keeps pin buttons as its look`, [await pinShown(page, root), await rowCount(page, root)]);
    const nm = await menu(page, root, 'qa_pin_a');
    ok(nm && nm.labels.some(l => /^(Pin|Unpin)$/.test(l)) && !nm.labels.includes('Open'), `${skin} menu: Pin, no Open`, nm);
    await closeMenu(page);
    await page.screenshot({ path: path.join(OUT, `phone-${skin}-list.png`) });
  }
  await setSkin(page, 'nebula');
  ok(await pinShown(page, root) === 0, 'leaving Novairecito family restores the unchanged device tweak choice');
  // Routed agent: openAgentChats focuses the same Chats window on that agent; same row menu and pin store.
  ok(await page.evaluate(ag => window.WizOpenAgentChats(ag), ROUTED), 'routed agent: its chats open');
  const rroot = root;
  await page.waitForSelector(`${rroot} .ch-row[data-chopen="qa_pin_r1"]`, { timeout: 15000 }); await sleep(300);
  ok(await pinShown(page, rroot) === 0, 'routed agent: no pin button on its rows by default');
  const rm = await menu(page, rroot, 'qa_pin_r1');
  ok(rm && rm.pinVisible && rm.labels.includes('Pin') && !rm.labels.includes('Open'), 'routed agent: row menu has Pin and no Open', rm);
  ok(await page.evaluate(() => { document.querySelector('.ch-sheet [data-rspin]').click(); return WosChatPins.has('qa_pin_r1') && !document.querySelector('.ch-sheet'); }), 'routed agent: menu Pin pins its thread');
  await sleep(400);
  ok(prefs.pinnedChats.includes('qa_pin_r1'), 'routed agent: pin write intercepted and read back', prefs.pinnedChats);
  await page.screenshot({ path: path.join(OUT, 'phone-routed-pinned.png') });
  await ctx.close();

  // Desktop
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await desktop.route('**/*', routeRequest);
  await desktop.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.skin', 'grove'); } catch (_) {} });
  const dp = await desktop.newPage(); dp.on('pageerror', e => errors.push('desktop: ' + String(e)));
  await dp.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
  await dp.waitForFunction(() => document.documentElement.dataset.shell === 'desktop' && window.__wux, null, { timeout: 20000 });
  await dp.waitForSelector('.ch-row[data-chopen="qa_pin_a"]', { timeout: 20000 }); await settle(dp);
  const droot = await dp.evaluate(() => { const el = document.querySelector('.ch-row[data-chopen="qa_pin_a"]').closest('[data-chats]'); return `[data-chats="${el.dataset.chats}"]`; });
  for (const skin of ['grove', 'landscapes']) {
    await setSkin(dp, skin);
    ok(await pinShown(dp, droot) === 0, `desktop ${skin}: no pin button on rows`);
    await dp.locator(`${droot} .ch-row[data-chopen="qa_pin_a"]`).click({ button: 'right' }); await sleep(300);
    const labels = await dp.evaluate(() => [...document.querySelectorAll('.ch-sheet button')].filter(x => getComputedStyle(x).display !== 'none').map(x => x.innerText.trim()));
    ok(labels.some(l => /^(Pin|Unpin)$/.test(l)) && !labels.includes('Open'), `desktop ${skin}: right-click menu has Pin and no Open`, labels);
    await dp.screenshot({ path: path.join(OUT, `desktop-${skin}-menu.png`) });
    await closeMenu(dp);
  }
  // Miguel's own tweak keeps his chats pin-free: no Pin in the menu, no row pins, even with Show pin buttons on.
  await dp.evaluate(() => WosExperience.toggle('miguel/hidden-pin')); await settle(dp);
  await dp.evaluate(() => WosExperience.toggle('wizard/pin-buttons')); await settle(dp);
  ok(await pinShown(dp, droot) === 0, 'desktop landscapes + No chat pins: no row pins even with Show pin buttons on');
  await dp.locator(`${droot} .ch-row[data-chopen="qa_pin_a"]`).click({ button: 'right' }); await sleep(300);
  const mlabels = await dp.evaluate(() => [...document.querySelectorAll('.ch-sheet button')].filter(x => getComputedStyle(x).display !== 'none').map(x => x.innerText.trim()));
  ok(!mlabels.some(l => /^(Pin|Unpin)$/.test(l)) && !mlabels.includes('Open') && mlabels.includes('Rename'), 'desktop landscapes + No chat pins: menu has no Pin', mlabels);
  await dp.screenshot({ path: path.join(OUT, 'desktop-landscapes-miguel-menu.png') });
  await closeMenu(dp);
  await desktop.close();
  ok(errors.length === 0, 'no page errors', errors);
  console.log(`${pass}/${pass + fail} passed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
