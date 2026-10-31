// Search keeps Archive last and collapsible on the main agent and a routed host-profile agent, phone and desktop (James, 31 Oct 2026).
// Synthetic data, writes intercepted.
const fs = require('fs'), path = require('path');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname;
const OUT = process.env.QA_OUT || path.join(require('os').tmpdir(), 'wizard-search-archive-last');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d === '' ? '' : ' ' + JSON.stringify(d)}`); };
const now = Date.now() / 1000;
const mk = (id, title, ago) => ({ id, title, source: 'wizard-mobile', status: 'completed', archived: false, hidden: false, message_count: 2, started_at: now - 900, last_active: now - ago, wizard_last_user_at: now - ago - 60, wizard_last_assistant_at: now - ago, latest_message: { role: 'assistant', content: 'Fixture reply for ' + title, timestamp: now - ago }, last_user_message: { role: 'user', content: 'Fixture question', timestamp: now - ago - 60 } });
const arch = (s) => ({ ...s, archived: true });
const sessions = [mk('qa_s_live', 'QA · Zephyr live thread', 20), arch(mk('qa_s_old', 'QA · Zephyr archived thread', 90000))];
// A routed host-profile agent's own synthetic threads (listed only with ?agent=qa-host): same shared row menu.
const ROUTED = 'qa-host', ag = { id: ROUTED, label: 'Synthetic routed', privacy: 'standard' }, routed = [{ ...mk('qa_r_live', 'QA · Zephyr routed live', 40), agent: ag }, { ...arch(mk('qa_r_old', 'QA · Zephyr routed archived', 90000)), agent: ag }];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const writes = [], errors = []; let prefs = { pinnedChats: [], chatLayout: 'status' };
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

  const ctxs = [['phone', { viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1280, height: 860 } }]];
  for (const [shell, opts] of ctxs) {
    const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
    await ctx.route('**/*', routeRequest);
    await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.skin', 'nebula'); localStorage.setItem('wos.chats.layout.v1', 'status'); } catch (_) {} });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
    await page.goto('https://wizard.test/wizard-os-home/' + (shell === 'desktop' ? 'desktop.html' : ''), { waitUntil: 'load' });
    await page.waitForFunction(() => (window.__wos || window.__wux) && window.WizCore?.apps, null, { timeout: 20000 });
    if (shell === 'phone') await page.evaluate(() => __wos.openApp(WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')));
    const wid = await page.waitForFunction(() => Object.values((window.__wos || window.__wux).wins).find(w => w.app === 'chats' && !w.agent)?.id || '', null, { timeout: 15000 }).then(h => h.jsonValue());
    const rootOf = id => shell === 'desktop' ? `.win[data-win="${id}"]` : `[data-chats="${id}"]`;
    let root = rootOf(wid);
    await page.waitForSelector(`${root} .ch-row[data-chopen="qa_s_live"], ${root} [data-sec="archive"]`, { timeout: 20000 }); await settle(page);
    const order = () => page.evaluate(root => [...document.querySelectorAll(`${root} .ch-sec[data-sec]`)].filter(e => e.getBoundingClientRect().width > 0).map(e => [e.dataset.sec, Math.round(e.getBoundingClientRect().top), e.classList.contains('open')]).sort((a, b) => a[1] - b[1]), root);
    const foot = () => page.evaluate(root => { const f = document.querySelector(`${root} .ch-bodysearch`); const secs = [...document.querySelectorAll(`${root} .ch-sec`)]; return f && secs.length ? Math.round(f.getBoundingClientRect().top) - Math.max(...secs.map(e => Math.round(e.getBoundingClientRect().top))) : null; }, root);
    const run = async (label, prefix, liveId, oldId) => {
      await page.fill(`${root} [data-chsearch]:visible`, 'zephyr'); await sleep(1500);
      let o = await order();
      ok(o.length >= 2 && o[o.length - 1][0] === 'archive' && o[o.length - 1][2] && o[0][0] !== 'archive', `${shell} ${label}: search lists live matches first and Archive last, open`, o);
      const fo = await foot(); ok(fo === null || fo > 0, `${shell} ${label}: search footer stays below Archive`, fo);
      await page.click(`${root} [data-sectoggle="archive"]:visible`); await sleep(250);
      o = await order();
      ok(o[o.length - 1][0] === 'archive' && !o[o.length - 1][2] && await page.locator(`${root} .ch-row[data-chopen="${oldId}"]:visible`).count() === 0 && await page.locator(`${root} .ch-row[data-chopen="${liveId}"]:visible`).count() === 1, `${shell} ${label}: tapping Archive collapses only it`, o);
      await page.click(`${root} [data-sectoggle="archive"]:visible`); await sleep(250);
      ok(await page.locator(`${root} .ch-row[data-chopen="${oldId}"]:visible`).count() === 1, `${shell} ${label}: tapping Archive again expands it`);
      await page.locator(`${root} [data-chsearch]:visible`).click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); await sleep(1500);
      o = await order(); ok(o[0][0] === 'archive', `${shell} ${label}: clearing the search puts Archive back on top`, [o, await page.evaluate(root => { const l = document.querySelector(`${root} .ch-list`); return [l?.className, [...l.querySelectorAll('.ch-sec')].map(e => e.className + '|' + getComputedStyle(e).order), [...document.querySelectorAll(`${root} [data-chsearch]`)].map(e => e.value), window.WizLive?.chatLayout]; }, root)]);
    };
    await run('main agent', '', 'qa_s_live', 'qa_s_old');
    ok(await page.evaluate(ag => window.WizOpenAgentChats(ag), ROUTED), `${shell} routed agent: its chats open`);
    { const rw = await page.waitForFunction(ag => Object.values((window.__wos || window.__wux).wins).find(w => w.app === 'chats' && w.agent === ag)?.id || Object.values((window.__wos || window.__wux).wins).find(w => w.app === 'chats' && !w.agent && document.querySelector(`[data-chats="${w.id}"] .ch-row[data-chopen="qa_r_live"]`))?.id || '', ROUTED, { timeout: 15000 }).then(h => h.jsonValue()); root = rootOf(rw); }
    await page.waitForSelector(`${root} .ch-row[data-chopen="qa_r_live"], ${root} [data-sec="archive"]`, { timeout: 15000 }); await sleep(500);
    await run('routed agent', '', 'qa_r_live', 'qa_r_old');
    await page.screenshot({ path: path.join(OUT, `${shell}-routed.png`) });
    await ctx.close();
  }
  ok(errors.length === 0, 'no page errors', errors.slice(0, 2));
  await browser.close();
  console.log(`${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
