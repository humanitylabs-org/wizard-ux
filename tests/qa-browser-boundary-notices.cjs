// Browser QA for the browser owner boundary, slice 19 (wizard-os#133): the shell's own notices reach a sandboxed app.
// Real Chromium: a shell page with the boundary on (WizShellBoundary set the way shell-token.js does), the real
// core/browser-boundary.js and core/app-services.js, and an app page in a sandboxed frame that loads the real
// core/app-client.js and listens with WizardApp.update.onAvailable and WizardApp.view.onRefresh.
//  - A shell update reaches the app (only its version), and a reloaded app hears it again.
//  - The fresh-data asks (a minute in view, an agent tool for this app) reach the app with their reason.
//  - A second sandboxed page that is not the installed app it claims to be hears nothing.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-notices.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
const page_ = who => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><p id="t">${who}</p><script>
  window.heard = { updates: [], refreshes: [] };
  WizardApp.update.onAvailable(v => { heard.updates.push(v); document.getElementById('t').textContent = '${who}: update ' + (v && v.version); });
  WizardApp.view.onRefresh(r => { heard.refreshes.push(r.reason); });
  WizardApp.ready?.();
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>
  const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } };
  window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>iframe{width:400px;height:80px;border:1px solid #888}</style></head>
<body><div class="win" id="w1"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<div class="win" id="w2"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/evil/"></iframe></div>
<script>
  const [a, b] = document.querySelectorAll('iframe');
  WizAppServices.attach(a, { appId: 'notes', path: '/notes/', isVisible: () => true });
  // The second window claims to be "other" but its frame shows a page outside that app's path.
  WizAppServices.attach(b, { appId: 'other', path: '/other/', isVisible: () => true });
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = body => { res.setHeader('content-type', 'text/html'); res.end(body); };
  if (u.pathname === '/') return html(SHELL);
  if (u.pathname === '/notes/') return html(page_('Notes'));
  if (u.pathname === '/evil/') return html(page_('Evil'));
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 460, height: 220 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const frameOf = p => page.frames().find(fr => fr.url().endsWith(p));
  const heard = p => frameOf(p).evaluate(() => heard).catch(() => null);
  // Both app documents answered on their channel.
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(f => WizBrowserBoundary.ready(f)), null, { timeout: 6000 }).catch(() => {});
  const origin = await frameOf('/notes/').evaluate(() => self.origin);
  ok(origin === 'null', 'the app page is opaque (origin ' + origin + ')');
  if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-before.png') });
  // A shell update is ready (web-update.js announces it the same way).
  await page.evaluate(() => WizAppServices.update.announce({ version: 'v:qa-2', changes: [{ thread: 'a shell thread' }] }));
  await page.waitForTimeout(300);
  let h = await heard('/notes/');
  ok(JSON.stringify(h?.updates) === '[{"version":"v:qa-2"}]', 'the app hears the shell update, only its version: ' + JSON.stringify(h?.updates));
  if (SHOT) await page.screenshot({ path: SHOT });
  // The shell reloads the window: the new document hears the pending update too.
  await page.evaluate(() => { document.querySelector('#w1 iframe').src = '/notes/?r=1'; });
  await page.waitForTimeout(800);
  h = await heard('/notes/?r=1');
  ok(JSON.stringify(h?.updates) === '[{"version":"v:qa-2"}]', 'a reloaded app hears the pending update again: ' + JSON.stringify(h?.updates));
  // Fresh data: a minute in view, then an agent tool for this app.
  await page.evaluate(() => { const t = Date.now(); WizAppServices.fresh.tick(t); WizAppServices.fresh.tick(t + 61000); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { const t = Date.now() + 70000; WizAppServices.fresh.tool('mcp_wizard_notes_create_note', t); });
  await page.waitForTimeout(200);
  h = await heard('/notes/?r=1');
  ok(JSON.stringify(h?.refreshes) === '["poll","agent"]', 'the app is asked to read its data again (a minute in view, an agent tool): ' + JSON.stringify(h?.refreshes));
  // The page outside its window's app path hears nothing.
  const evil = await heard('/evil/');
  ok(evil && evil.updates.length === 0 && evil.refreshes.length === 0, 'a page outside its app\'s path hears nothing: ' + JSON.stringify(evil));
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
