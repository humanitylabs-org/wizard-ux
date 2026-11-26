// Get set up (wizard-ux issue 1837, switch wizard/get-set-up): the real shell (phone, 412 px) opens the real Setup page;
// with the switch on, the Get set up list shows after the phone row, connected apps say Done, a tap on an installed
// app opens that app, and a tap on one not installed opens the Store at it. With the switch off, Setup's list is
// byte-identical to main's (QA_WEB=<main>/web gives the baseline). No live box: tools/fake-setup-api.cjs + routes.
// Env: QA_SWITCH=on|off (default on), QA_WEB, QA_OUT (shots + list html), QA_PLAYWRIGHT.
const QA_ROOT = require('node:path').resolve(__dirname, '..');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const pw = require('../tools/qa-playwright.cjs');
const port = Number(process.env.QA_PORT || 19837), origin = `http://127.0.0.1:${port}`;
const SW = (process.env.QA_SWITCH || 'on') === 'on';
const out = process.env.QA_OUT || path.join(process.env.TMPDIR || process.cwd(), 'qa-setup-get-set-up');
const web = process.env.QA_WEB || path.join(QA_ROOT, 'web');
const fixture = spawn(process.execPath, ['tools/fake-setup-api.cjs', String(port), web], { cwd: QA_ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
const APPS = [
  { id: 'wizard-mail', name: 'Mail', url: '/wizard-mail/', source: 'apps.json', status: 'running' },
  { id: 'messenger', name: 'Messenger', url: '/messenger/', source: 'apps.json', status: 'running' },
  { id: 'wizard-calendar', name: 'Calendar', url: '/wizard-calendar/', source: 'apps.json', status: 'running' },
];
let browser;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((resolve, reject) => { fixture.stdout.on('data', b => { if (String(b).includes('fake-setup-api')) resolve(); }); fixture.on('exit', c => reject(Error('fixture exited ' + c))); });
  browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
  await ctx.addInitScript(sw => {
    localStorage.setItem('wux.shell', 'phone'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true');
    localStorage.setItem('wos.welcome.v1', 'done');
    localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify({ version: 1, preset: 'none', off: {}, mix: sw ? { 'wizard/get-set-up': true } : {} }));
  }, SW);
  const appReads = [], errors = [];
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.origin !== origin) return route.abort();
    if (u.pathname === '/wizard/v1/bootstrap') { const r = await route.fetch(); const b = await r.json(); b.endpoints = { apps: '/wizard/v1/apps' }; return json(b); }
    if (u.pathname === '/wizard/v1/apps') return json({ apps: APPS });
    if (/^\/(wizard-mail|messenger|wizard-calendar|importer|finances)\/api\//.test(u.pathname)) {
      appReads.push(u.pathname + (req.headers()['x-wizard-request'] ? ' [' + req.headers()['x-wizard-request'] + ']' : ''));
      if (u.pathname === '/wizard-mail/api/accounts') return json({ sources: [], connected: req.headers()['x-wizard-request'] === 'mail' });
      if (u.pathname === '/messenger/api/unified/connectors') return json({ providers: [{ network: 'telegram', state: 'not_configured', logins: [] }] });
      if (u.pathname === '/wizard-calendar/api/live') return json({ sources: [], connected: true });
      return route.fulfill({ status: 404, body: '{}' });
    }
    if (u.pathname === '/messenger/' || u.pathname === '/messenger/index.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>Messenger connect fixture</h1><p>Connect an account to bring its chats into your Inbox</p></body></html>' });
    return route.continue();
  });
  const report0 = {};
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(origin + '/wizard-os-home/?shell=phone', { waitUntil: 'load' });
  const hasSetup = () => [...document.querySelectorAll('iframe')].some(f => f.src.includes('/setup/'));
  await page.waitForFunction(() => !!window.__wos && !!window.WizCore?.apps, null, { timeout: 20000 });
  if (SW) await page.waitForFunction(() => String(document.documentElement.getAttribute('data-tweaks') || '').includes('wizard/get-set-up'), null, { timeout: 15000 })
    .catch(async e => { console.error('tweaks', await page.evaluate(() => [document.documentElement.getAttribute('data-tweaks'), localStorage.getItem('wos.skin-tweaks.v1')])); throw e; });
  // The Setup tile, as an owner taps it: switch off it opens the Welcome (as today); on, the Setup page.
  await page.evaluate(() => __wos.openApp(WizCore.apps('mobile').APPS.find(a => a.id === 'setup')));
  if (!SW) {
    await page.waitForSelector('#wosWelcome', { timeout: 15000 });
    report0.tileOpens = 'welcome';
    await page.screenshot({ path: path.join(out, 'tile-off-welcome.png') });
    await page.evaluate(() => WosWelcome.close());
    // The page itself (reachable by its address) must be unchanged with the switch off: frame it in the shell.
    await page.evaluate(() => { const f = document.createElement('iframe'); f.src = '/wizard-os-home/setup/index.html'; f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:99999;border:0;background:#000'; document.body.appendChild(f); });
  } else report0.tileOpens = 'setup';
  await page.waitForFunction(hasSetup, null, { timeout: 15000 });
  let f = null;
  for (let i = 0; i < 100 && !f; i++) { f = page.frames().find(x => x.url().includes('/setup/')); if (!f) await page.waitForTimeout(100); }
  await f.waitForSelector('[data-act="open-phone"]');
  if (SW) await f.waitForFunction(() => document.querySelectorAll('[data-gsu][data-state="done"]').length >= 2, null, { timeout: 15000 })
    .catch(async e => { console.error('debug', JSON.stringify(await f.evaluate(() => ({ ep: (()=>{try{return parent.WizConfig?.endpoint?.('apps')}catch(e){return 'ERR '+e}})(), st: window.WosGetSetUp?.state, on: window.WosGetSetUp?.on(), log: window.__setupLog, html: document.querySelector('#list').innerHTML.slice(0, 600) }))), appReads); throw e; });
  else await page.waitForTimeout(3000);
  const report = { switch: SW ? 'on' : 'off', errors, ...report0 };
  report.rows = await f.evaluate(() => [...document.querySelectorAll('[data-gsu]')].map(b => ({ id: b.dataset.gsu, state: b.dataset.state, name: b.querySelector('b').textContent, line: b.querySelector('small').textContent, word: b.querySelector('.gsu-state').textContent })));
  report.order = await f.evaluate(() => [...document.querySelectorAll('#list > .rows, #list > section')].map(n => n.className));
  const listHtml = await f.evaluate(() => document.querySelector('#list').innerHTML);
  fs.writeFileSync(path.join(out, `list-${report.switch}.html`), listHtml);
  const sec = f.locator(SW ? '[data-get-set-up]' : '#list');
  await sec.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, `setup-${report.switch}.png`) });
  report.appReads = [...appReads];
  if (!SW) {
    assert.equal(report.rows.length, 0);
    assert.deepEqual(appReads.filter(p => !p.endsWith('/api/inbox')), []); // the shell's own inbox feed reads are not Setup's
  } else {
    assert.deepEqual(report.rows.map(r => [r.id, r.state]), [['wizard-mail', 'done'], ['messenger', 'todo'], ['finances', 'todo'], ['wizard-calendar', 'done'], ['importer', 'todo']]);
    assert.deepEqual(report.rows.map(r => r.name), ['Email', 'Messages', 'Money', 'Calendar', 'Bring what your old AI knows']);
    assert.deepEqual(report.order, ['rows', 'get-set-up', 'recommended']);
    // Tap Messages (installed, not connected): the shell opens Messenger, where its connect screen is.
    await f.locator('[data-gsu="messenger"]').tap();
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(x => x.src.includes('/messenger/')), null, { timeout: 15000 });
    report.messengerOpened = true;
    // Back to Setup, tap the Importer (not installed): the Store opens at the Importer, set to open it once installed.
    await page.evaluate(() => __wos.openApp(WizCore.apps('mobile').APPS.find(a => a.id === 'setup')));
    await page.waitForTimeout(800);
    const f2 = page.frames().find(x => x.url().includes('/setup/'));
    await f2.locator('[data-gsu="importer"]').tap();
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(x => /\/store\/index\.html\?app=importer&open=1/.test(x.src)), null, { timeout: 15000 });
    report.storeOpened = await page.evaluate(() => [...document.querySelectorAll('iframe')].map(x => x.getAttribute('src')).find(s => /store\/index\.html\?app=importer/.test(s)));
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, `report-${report.switch}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); fixture.kill(); });
