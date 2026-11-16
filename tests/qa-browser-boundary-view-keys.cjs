'use strict';
// Browser QA for the AI apps view's own ⌥ keys typed in a sandboxed app (wizard-os#133 slice 25, browser owner
// boundary). Real Chromium, the real desktop shell (desktop.html) in the AI apps view with the boundary ON (a shell
// token in the page, as nginx writes it after `wam browser-boundary on`), and one app window whose page loads the real
// core/app-client.js in a sandboxed (opaque) frame. Synthetic owner fixture: no box is read or written.
// Real clicks and key presses inside the app's text field:
//  - ⌥K opens the view's chat search, and the app page never sees the key;
//  - ⌥H goes Home (everything away), as it does from a same-origin app;
//  - ⌥N (a new chat) stays the app's while it has the keyboard, and plain typing stays in its field.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-view-keys.cjs
//   QA_WEB=<main worktree>/web QA_EXPECT=broken: main leaves ⌥K and ⌥H with the app (the checks must fail there).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const repo = path.resolve(__dirname, '..'), origin = 'https://view-keys.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(repo, 'web');
const EXPECT = process.env.QA_EXPECT || 'fixed', SHOT = process.env.QA_SHOT || '';
const TOKEN = 'a'.repeat(64);
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="${prefix}core/app-client.js"></script>
<style>body{margin:0;padding:40px;font:15px sans-serif;background:#fff}input{font-size:15px;padding:6px;width:260px}</style></head>
<body><h1>Synthetic app</h1><input id="f" placeholder="Type here"><script>
  window.seen = []; addEventListener('keydown', e => { if (e.altKey && e.code !== 'AltLeft') seen.push(e.code); });
</script></body></html>`;
const QA_APP = { id: 'qa-app', name: 'Synthetic app', url: '/qa-app/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
const DESK = { wins: { wqa1: { id: 'wqa1', app: 'frame', appId: 'qa-app', url: '/qa-app/', title: 'Synthetic app' } },
  ws: [{ id: 'dqa1', wins: ['wqa1'], focus: 'wqa1', mono: false }], cur: 0 };
const nap = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const result = { expect: EXPECT, web, errors: [], refused: [] }, fails = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(({ desk, app }) => {
      if (window !== top) return;
      if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
      localStorage.setItem('wux.apps.v1', JSON.stringify([app]));   // the installed app, as the shell cached it
      for (const [k, v] of Object.entries({ wins: desk.wins, ws: desk.ws, cur: desk.cur, homeOpen: false, layoutVersion: 2 })) localStorage.setItem('wux.desk.' + k, JSON.stringify(v));
      for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
    }, { desk: DESK, app: QA_APP });
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
      if (u.origin !== origin) { result.refused.push(q.url()); return r.abort(); }
      if (!['GET', 'HEAD'].includes(method)) { result.refused.push(method + ' ' + p); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses writes' } }); }
      if (p === '/qa-app/') return r.fulfill({ body: APP, contentType: 'text/html' });
      if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
      if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [QA_APP] } });
      if (p === prefix + 'desktop.html') {
        // nginx's sub_filter after `wam browser-boundary on`: the shell-only token in the top-level page.
        const html = fs.readFileSync(path.join(web, 'desktop.html'), 'utf8').replace('<meta name="wizard-shell-token" content="off">', `<meta name="wizard-shell-token" content="${TOKEN}">`);
        return r.fulfill({ body: html, contentType: 'text/html' });
      }
      if (p.startsWith(prefix)) {
        const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
        if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
        return r.fulfill({ status: 404, body: 'No synthetic static asset' });
      }
      if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage(); page.on('pageerror', e => result.errors.push(e.message));
    await page.goto(origin + prefix + 'desktop.html');
    await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 20000 });
    result.boundary = await page.evaluate(() => !!window.WizBrowserBoundary?.enabled);
    if (!result.boundary) throw new Error('the boundary did not turn on');
    const FRAME = 'iframe[data-own-app="qa-app"]';
    await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(n => n.getClientRects().length), FRAME, { timeout: 15000 });
    // A restored app desk paints its panel at width 0 in this fixture: its row in the open-apps column twice (hide, show).
    for (let i = 0; i < 2; i++) { await page.locator('.aad-vtab[data-app="qa-app"]').first().click(); await nap(900); }
    await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(n => n.getBoundingClientRect().width > 200 && window.WizBrowserBoundary.ready(n)), FRAME, { timeout: 15000 });
    await nap(1500);
    const handle = (await page.evaluateHandle(sel => [...document.querySelectorAll(sel)].find(n => n.getBoundingClientRect().width > 200), FRAME)).asElement();
    result.sandbox = await handle.getAttribute('sandbox');
    if (!result.sandbox || /allow-same-origin/.test(result.sandbox)) fails.push('the app frame is not sandboxed: ' + result.sandbox);
    const app = await handle.contentFrame();
    // A real click into the app's field: the field's box in the app plus the frame's box in the shell.
    const input = {
      click: async () => { const fb = await handle.boundingBox(), ib = await app.evaluate(() => { const r = document.getElementById('f').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }); await page.mouse.click(fb.x + ib.x, fb.y + ib.y); await nap(200); },
      inputValue: () => app.evaluate(() => document.getElementById('f').value),
    };
    // Every ⌥ key below is typed with the keyboard in the app's field.
    const inApp = async step => {
      const focus = { shell: await page.evaluate(() => document.activeElement?.tagName), app: await app.evaluate(() => document.activeElement?.id) };
      if (focus.shell !== 'IFRAME' || focus.app !== 'f') fails.push(step + ': the keyboard is not in the app field ' + JSON.stringify(focus));
    };
    const view = () => page.evaluate(() => ({
      search: [...document.querySelectorAll('.aad-search')].some(n => !n.hidden && n.getClientRects().length),
      home: document.documentElement.dataset.aadFocus != null,
      active: document.activeElement?.className || document.activeElement?.tagName || '',
    }));
    result.start = await view();
    if (result.start.search || result.start.home) fails.push('start: the search or Home is already open ' + JSON.stringify(result.start));
    if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-start.png') });
    // 1. ⌥N typed in the app (a new chat) stays the app's; plain typing stays in its field.
    await input.click(); await inApp('⌥N');
    await page.keyboard.type('hi'); await page.keyboard.press('Alt+KeyN'); await nap(500);
    result.afterN = { view: await view(), seen: await app.evaluate(() => seen.slice()), value: await input.inputValue() };
    if (!result.afterN.seen.includes('KeyN')) fails.push('⌥N did not stay with the app: ' + JSON.stringify(result.afterN));
    if (!/^hi/.test(result.afterN.value)) fails.push('plain typing left the app field: ' + result.afterN.value);
    // 2. ⌥K typed in the app opens the view's chat search; the app never sees it.
    await input.click(); await inApp('⌥K'); await page.keyboard.press('Alt+KeyK'); await nap(600);
    result.afterK = { view: await view(), seen: await app.evaluate(() => seen.slice()) };
    if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-k.png') });
    if (!result.afterK.view.search) fails.push('⌥K in the app did not open the view\'s search');
    if (result.afterK.seen.includes('KeyK')) fails.push('the app page saw ⌥K');
    // 3. ⌥H typed in the app goes Home.
    await page.keyboard.press('Escape'); await nap(300);
    await input.click(); await inApp('⌥H'); await page.keyboard.press('Alt+KeyH'); await nap(900);
    result.afterH = { view: await view(), seen: await app.evaluate(() => seen.slice()) };
    if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-h.png') });
    if (!result.afterH.view.home) fails.push('⌥H in the app did not go Home');
    if (result.afterH.seen.includes('KeyH')) fails.push('the app page saw ⌥H');
    if (result.errors.length) fails.push('page errors: ' + result.errors.join('; '));
    await context.close();
  } catch (e) { fails.push('crash: ' + (e.stack || e)); }
  finally { await browser.close(); }
  result.fails = fails;
  console.log(JSON.stringify(result, null, 1));
  if (EXPECT === 'broken') {
    const crashed = fails.some(f => f.startsWith('crash'));
    const ok = !crashed && fails.includes('⌥K in the app did not open the view\'s search') && fails.includes('⌥H in the app did not go Home');
    console.log(ok ? 'EXPECTED BROKEN: main leaves the view\'s keys with the app' : 'UNEXPECTED: main did not fail as expected');
    process.exitCode = ok ? 0 : 1;
  } else process.exitCode = fails.length ? 1 : 0;
})();
