// Chat pins (James, 31 Oct 2026): no pin button on rows by default, Pin in the row menu (right-click / hold), no Open
// in that menu, "Show pin buttons" tweak brings row pins back, Novairecito keeps them on. Synthetic data, writes intercepted.
// Usage: QA_TREE=<repo> QA_PLAYWRIGHT=<playwright> QA_OUT=<dir> node qa-chat-pin-menu.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.QA_PLAYWRIGHT || 'playwright');
const TREE = process.env.QA_TREE || __dirname;
const OUT = process.env.QA_OUT || path.join(require('os').tmpdir(), 'wizard-pin-menu');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d === '' ? '' : ' ' + JSON.stringify(d)}`); };
const now = Date.now() / 1000;
const mk = (id, title, ago) => ({ id, title, source: 'wizard-mobile', status: 'completed', archived: false, hidden: false, message_count: 2, started_at: now - 900, last_active: now - ago, wizard_last_user_at: now - ago - 60, wizard_last_assistant_at: now - ago, latest_message: { role: 'assistant', content: 'Fixture reply for ' + title, timestamp: now - ago }, last_user_message: { role: 'user', content: 'Fixture question', timestamp: now - ago - 60 } });
const sessions = [mk('qa_pin_a', 'QA · Pin fixture A', 20), mk('qa_pin_b', 'QA · Pin fixture B', 120), mk('qa_pin_c', 'QA · Pin fixture C', 300)];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const writes = [], errors = [];
  const routeRequest = async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    if (u.hostname !== 'wizard.test') return route.abort();
    if (!['GET', 'HEAD'].includes(method)) { writes.push({ method, path: u.pathname }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, record: {} }) }); }
    if (u.pathname === '/wizard/hermes/api/sessions') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', data: sessions, has_more: false, limit: 100, offset: 0, snapshot: 'qa' }) });
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
  const before = writes.length;
  await menu(page, root, 'qa_pin_b');
  ok(await page.evaluate(() => { document.querySelector('.ch-sheet [data-rspin]').click(); return WosChatPins.has('qa_pin_b') && !document.querySelector('.ch-sheet'); }), 'menu Pin pins the chat and closes the menu');
  await sleep(400);
  ok(writes.length >= before, 'pin write intercepted (never reached a real Wizard)');
  await page.evaluate(() => WosExperience.toggle('wizard/pin-buttons')); await settle(page);
  ok(await pinShown(page, root) === sessions.length, 'Show pin buttons on: every row gets its pin button', await pinShown(page, root));
  await page.screenshot({ path: path.join(OUT, 'phone-nebula-tweak-on.png') });
  await page.evaluate(() => WosExperience.toggle('wizard/pin-buttons')); await settle(page);
  ok(await pinShown(page, root) === 0, 'Show pin buttons off again: buttons gone');
  await setSkin(page, 'novairecito');
  ok(await pinShown(page, root) === sessions.length, 'Novairecito keeps pin buttons on by default', await pinShown(page, root));
  const nm = await menu(page, root, 'qa_pin_a');
  ok(nm && nm.labels.some(l => /^(Pin|Unpin)$/.test(l)) && !nm.labels.includes('Open'), 'Novairecito menu: Pin, no Open', nm);
  await closeMenu(page);
  await page.screenshot({ path: path.join(OUT, 'phone-novairecito-list.png') });
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
  await desktop.close();
  ok(errors.length === 0, 'no page errors', errors);
  console.log(`${pass}/${pass + fail} passed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
