// Isolated Desktop close QA: real Wizard registry/session reads; all writes intercepted.
// App frame bodies are explicitly QA fixtures; no installed app is mutated.
// QA_OUT=<private screenshot dir> QA_BASE=<read-only qa-origin URL> node tests/desktop-close-desktop.browser.cjs
// Without QA_BASE, starts tools/qa-origin.cjs itself. QA_BACKEND_PORT supports a read-only SSH tunnel.
const { chromium } = require('../tools/qa-playwright.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const OUT = process.env.QA_OUT || path.join(os.homedir(), '.hermes/cache/screenshots/desktop-close-desks');
const ROOT = path.resolve(__dirname, '..');
const port = process.env.QA_ORIGIN_PORT || '9396';
const BASE = process.env.QA_BASE || `http://127.0.0.1:${port}/wizard-os-home/`;
fs.mkdirSync(OUT, { recursive: true });
let server, browser, pass = 0;
const writes = [], results = [], errors = [];
function ok(value, name) { assert.ok(value, name); pass++; results.push(name); console.log('PASS', name); }
async function ready() {
  if (process.env.QA_BASE) return;
  server = spawn(process.execPath, ['tools/qa-origin.cjs', port, path.join(ROOT, 'web')], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.stderr.once('data', d => reject(Error(String(d)))); server.once('exit', code => reject(Error('qa-origin exited ' + code))); });
}
async function state(p) {
  return p.evaluate(() => { const u = __wux; return { count: u.ws.length, cur: u.cur, desk: u.ws[u.cur].id, wins: u.ws[u.cur].wins, focus: u.ws[u.cur].focus, active: document.activeElement?.closest('.win')?.dataset.win, home: u.homeOpen }; });
}
async function seed(p) {
  const setup = await p.evaluate(() => {
    const u = __wux; window.WosTour?.desk?.finish('skip'); u.closePalette();
    while (u.ws.length > 1) u.closeDesktop(u.ws.length - 1);
    u.closeDesktop(0);
    const apps = WizCore.apps('desktop').APPS.filter(a => a.id !== 'wizard' && a.url && new URL(a.url, location.href).origin === location.origin).slice(0, 3);
    if (apps.length < 3) throw Error('QA requires three real app registry entries');
    const ids = [], desks = [];
    for (let i = 0; i < 3; i++) {
      if (i) u.newDesktop();
      ids.push(u.newWin({ app: 'frame', appId: apps[i].id, url: apps[i].url }).id);
      desks.push(u.ws[u.cur].id); u.closePalette();
    }
    // A genuine workspaceNav count on a real registry app (browser-only value).
    WizCore.workspaceNav.setCount(apps[1].id, 7);
    u.goWs(1); u.focusWin(ids[1]);
    return { ids, desks, apps: apps.map(a => ({ id: a.id, name: a.name })) };
  });
  await p.waitForFunction(() => [...document.querySelectorAll('.win iframe')].every(f => f.contentDocument?.title === 'QA app fixture'));
  await p.evaluate(() => { for (const f of document.querySelectorAll('.win iframe')) f.contentWindow.__wizardCloseOverlay = () => false; });
  return setup;
}
async function menuAt(p, index = 1) { await p.locator(`.ws[data-ws="${index}"]`).click({ button: 'right' }); await p.locator('.wos-context-menu').waitFor(); }
async function settle(p) { await p.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))); }
(async () => {
  try {
    await ready();
    browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream'] });
    for (const skin of ['nebula', 'grove']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36' });
      await ctx.addInitScript(skin => { localStorage.setItem('wos.skin', skin); localStorage.setItem('wos.coached', 'true'); }, skin);
      await ctx.route('**/*', async route => {
        const req = route.request();
        if (!['GET', 'HEAD'].includes(req.method())) {
          writes.push({ method: req.method(), path: new URL(req.url()).pathname });
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        }
        // The owner's synced desks would land mid-seed and race the fixture; QA starts from no saved workspace.
        if (new URL(req.url()).pathname.startsWith('/wizard/v1/workspaces')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        if (req.isNavigationRequest() && req.frame().parentFrame()) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>QA app fixture</title></head><body style="background:#151020;color:#e9dfff;font:18px system-ui;padding:48px"><h1>Desktop close check</h1><p>Isolated app frame · owner data is read-only.</p><input aria-label="App input" placeholder="Focus stays with this desktop"></body></html>' });
        return route.continue();
      });
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push(String(e)));
      await p.goto(BASE + 'desktop.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__wux?.live?.ok, null, { timeout: 60000 });
      const setup = await seed(p);
      await settle(p);
      ok(await p.evaluate(s => document.documentElement.dataset.skin === s, skin), `${skin}: real skin loaded`);
      ok((await state(p)).count === 3, `${skin}: three app desktops created`);
      await p.evaluate(() => { __wux.goHome(); __wux.closeCurrent(); });
      ok((await state(p)).count === 3 && await p.evaluate(() => Object.keys(__wux.wins).length === 3), `${skin}: Home shortcut preserves parked desktops`);
      await p.evaluate(() => __wux.goWs(1));
      await p.locator('.ws[data-ws="1"]').hover();
      ok(await p.locator('[data-wsclose], .ws-close').count() === 0, `${skin}: hovering a tile shows no close ✕`);
      ok(await p.locator('.ws[data-ws="1"] .dbg').innerText() === '7', `${skin}: unread badge retained`);
      await p.locator('.bar-l').screenshot({ path: path.join(OUT, `${skin}-hover-unread-detail.png`) });
      await menuAt(p); await settle(p);
      ok(await p.getByRole('menuitem', { name: 'Close desktop', exact: true }).count() === 1, `${skin}: right-click offers Close desktop`);
      await p.screenshot({ path: path.join(OUT, `${skin}-context-menu.png`) });
      // Pixel proof: the panel interior must be identical over blank and loud text.
      const box = await p.locator('.wos-context-menu').boundingBox();
      const clip = { x: box.x + 10, y: box.y + 10, width: box.width - 20, height: box.height - 20 };
      await p.evaluate(({ x, y, width, height }) => {
        const under = document.createElement('div'); under.id = 'qa-menu-underlay';
        Object.assign(under.style, { position: 'fixed', left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px', zIndex: '2147482999', background: '#00ff00', color: '#ff0000', font: 'bold 22px monospace', pointerEvents: 'none' });
        under.textContent = 'LOUD TEXT LOUD TEXT'; document.body.appendChild(under);
      }, box);
      const loud = await p.screenshot({ clip });
      await p.evaluate(() => { const el = document.querySelector('#qa-menu-underlay'); el.style.background = '#0000ff'; el.textContent = ''; });
      const blank = await p.screenshot({ clip });
      ok(loud.equals(blank), `${skin}: menu pixels fully opaque over loud text`);
      await p.evaluate(() => document.querySelector('#qa-menu-underlay').remove());
      await p.keyboard.press('Escape'); ok(await p.locator('.wos-context-menu').count() === 0, `${skin}: Escape dismisses menu first`);
      ok((await state(p)).count === 3, `${skin}: Escape does not close desktop`);
      await menuAt(p); await p.locator('#clock').click();
      ok(await p.locator('.wos-context-menu').count() === 0, `${skin}: outside click dismisses menu`);
      await p.evaluate(() => __wux.goWs(1));
      await menuAt(p); await p.evaluate(() => dispatchEvent(new Event('scroll')));
      ok(await p.locator('.wos-context-menu').count() === 0, `${skin}: scroll dismisses menu`);
      await menuAt(p); await p.evaluate(() => dispatchEvent(new Event('blur')));
      ok(await p.locator('.wos-context-menu').count() === 0, `${skin}: window blur dismisses menu`);
      // Close current middle desktop from its right-click menu.
      await menuAt(p); await p.getByRole('menuitem', { name: 'Close desktop', exact: true }).click();
      let s = await state(p);
      ok(s.count === 2 && s.desk === setup.desks[0] && s.cur === 0, `${skin}: closing middle desktop lands left and drops tile`);
      ok(s.focus === setup.ids[0] && s.active === setup.ids[0], `${skin}: left app owns DOM focus`);
      ok(await p.locator(`.win[data-win="${setup.ids[1]}"]`).count() === 0, `${skin}: closed frame detached`);
      await settle(p); await p.screenshot({ path: path.join(OUT, `${skin}-closed-middle-focus-left.png`) });
      // Closing the final window takes precisely the same left-neighbour path.
      await p.evaluate(() => __wux.goWs(1));
      await p.locator(`.win[data-win="${setup.ids[2]}"] [data-wact="close"]`).click();
      s = await state(p);
      ok(s.count === 1 && s.desk === setup.desks[0] && s.active === setup.ids[0], `${skin}: closing last app removes its desktop and focuses left`);
      await settle(p); await p.screenshot({ path: path.join(OUT, `${skin}-last-app-removed.png`) });
      // Menu choose closes a noncurrent desk without selecting it first.
      const again = await seed(p); await p.evaluate(() => __wux.goWs(2));
      await menuAt(p, 0); await p.getByRole('menuitem', { name: 'Close desktop', exact: true }).click();
      s = await state(p);
      ok(s.count === 2 && s.desk === again.desks[2], `${skin}: menu closes background desktop without navigation`);
      ok(await p.locator('.wos-context-menu').count() === 0, `${skin}: choosing an item dismisses menu`);
      // Internal closes keep desks; a caller's explicit focus after pruning wins.
      await p.evaluate(ids => { __wux.closeWin(ids[2], true); }, again.ids);
      ok((await state(p)).count === 2, `${skin}: internal close never prunes`);
      // Re-seed for a true cross-desktop workflow Back: the explicit origin is
      // two desks left, not the immediate left-neighbour fallback.
      const workflow = await seed(p);
      const workflowBack = await p.evaluate(ids => {
        const u = __wux; u.goWs(2); u.wins[ids[2]].workflow = true; u.wins[ids[2]].returnWid = ids[0];
        return u.escStep();
      }, workflow.ids);
      s = await state(p);
      ok(workflowBack === 'workflow' && s.desk === workflow.desks[0] && s.active === workflow.ids[0], `${skin}: workflow Back return target wins over default left neighbour`);
      const preview = await seed(p);
      const previewBack = await p.evaluate(ids => { __wux.goWs(2); __wux.wins[ids[2]].preview = true; return __wux.escStep(); }, preview.ids);
      s = await state(p);
      ok(previewBack === 'preview' && s.count === 2 && s.desk === preview.desks[1] && s.active === preview.ids[1], `${skin}: preview Back prunes and focuses left`);
      const store = await seed(p);
      const storeBack = await p.evaluate(ids => { __wux.goWs(2); __wux.wins[ids[2]].appId = 'app-store'; return __wux.escStep(); }, store.ids);
      s = await state(p);
      ok(storeBack === 'store-parent' && s.count === 2 && s.desk === store.desks[1], `${skin}: Store parent Back prunes and focuses left`);
      const settings = await seed(p);
      await p.evaluate(ids => { __wux.goWs(2); __wux.closeWin(ids[2], true); __wux.openSettings(); __wux.closeSettings(); }, settings.ids);
      s = await state(p);
      ok(s.count === 2 && s.desk === settings.desks[1] && s.active === settings.ids[1], `${skin}: Settings close prunes and focuses left`);
      const shortcut = await seed(p);
      await p.evaluate(() => { __wux.goWs(2); __wux.focusWin(__wux.ws[2].focus); });
      await p.keyboard.press('Alt+w'); s = await state(p);
      ok(s.count === 2 && s.desk === shortcut.desks[1] && s.active === shortcut.ids[1], `${skin}: Alt+W last-window close prunes and focuses left`);
      await p.evaluate(() => { __wux.newDesktop(); __wux.closePalette(); });
      await menuAt(p, 2); await p.getByRole('menuitem', { name: 'Close desktop', exact: true }).click();
      s = await state(p); ok(s.count === 2 && s.desk === shortcut.desks[1], `${skin}: empty desktop closes left`);
      // Last desktop: explicit close keeps one empty desk and opens Home.
      await p.evaluate(() => { while (__wux.ws.length > 1) __wux.closeDesktop(__wux.ws.length - 1); __wux.closeDesktop(0); });
      s = await state(p); ok(s.count === 1 && s.wins.length === 0 && s.home, `${skin}: only desktop closes to Home`);
      await ctx.close();
    }
    ok(errors.length === 0, 'no browser page errors');
    console.log(JSON.stringify({ pass, fail: 0, interceptedWrites: writes.length, results }, null, 2));
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ pass, fail: 0, interceptedWrites: writes.length, results }, null, 2));
  } catch (e) {
    console.error(e); fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ pass, fail: 1, error: String(e), errors }, null, 2)); process.exitCode = 1;
  } finally { if (browser) await browser.close(); if (server) server.kill(); }
})();
