// Browser QA for the browser owner boundary (wizard-os#133): the Welcome's app frames and Settings › Connections.
// Real Chromium: a top-level shell page with a shell token in its meta (as nginx writes it), the real
// core/shell-token.js, core/browser-boundary.js and core/welcome.js. App pages load the real core/app-client.js.
//  - Welcome › Connect your AI: the provider's sign-in page is sandboxed (opaque, can't reach the shell, its owner
//    call goes out with Origin null and no token), and Esc pressed inside it still steps the Welcome back.
//  - Welcome › Bring your AI: the Importer page is sandboxed the same way.
//  - Settings › Connections (the App Manager's view at store-install/_connections/, which loads core/shell-token.js
//    first, wizard-app-manager connections_view.py): stays same-origin and its api/ calls carry the token.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-welcome-settings.cjs
//   QA_WEB=<other web dir> runs the same checks against another build (e.g. main: the Welcome frames are open there).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB || path.join(__dirname, '..', 'web');
const TOKEN = 'ef'.repeat(32);
const SANDBOX = 'allow-scripts allow-forms allow-downloads';
const seen = [];
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><h1>App</h1><input id="f"><script>
  window.keys = []; addEventListener('keydown', e => window.keys.push(e.key), true);
  window.probe = async () => {
    const out = { origin: self.origin };
    try { out.parentDoc = !!parent.document; } catch (e) { out.parentDoc = 'blocked:' + e.name; }
    // The shell's own storage is out of reach; since slice 34 the app kit gives the page a stand-in of its own (a number).
    try { out.storage = localStorage.length; } catch (e) { out.storage = 'blocked:' + e.name; }
    try { const r = await fetch('/wizard/v1/threads', { method: 'POST', body: '{}' }); out.owner = r.status; } catch (e) { out.owner = 'blocked:' + e.name; }
    return out;
  };
</script></body></html>`;
// What wizard-app-manager connections_view.page('settings') serves, cut down: core/shell-token.js first, then the
// view's own script, which reads its API relative to the page.
const CONNECTIONS = `<!doctype html><html lang="en" data-embed="settings"><head><meta charset="utf-8">
<script src="/wizard-os-home/core/shell-token.js"></script>
<script type="module">window.loaded = await fetch('api/connections').then(r => r.status, e => 'blocked:' + e.name);</script></head>
<body class="wux" data-only="connections"><div id="body">Connections</div></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<meta name="wizard-shell-token" content="${TOKEN}">
<script src="/wizard-os-home/core/shell-token.js"></script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script src="/wizard-os-home/core/welcome.js"></script></head>
<body><div id="settings"></div><script>
  window.WosWelcome.boot({ app: id => ({ id, url: '/' + id + '/' }), deeplinked: () => true });
  // Settings › Connections as core/settings.js writes it.
  window.openConnections = () => { document.getElementById('settings').innerHTML = '<div class="st-embed" data-st-connections><iframe src="/wizard-os-home/store-install/_connections/?embed=settings" title="Connections"></iframe></div>'; };
</script></body></html>`;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push({ path: u.pathname, ref: req.headers.referer || '', origin: req.headers.origin || '', token: req.headers['x-wizard-shell-token'] || '', dest: req.headers['sec-fetch-dest'] || '' });
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(SHELL); }
  if (u.pathname === '/wizard-claude/' || u.pathname === '/importer/') { res.setHeader('content-type', 'text/html'); return res.end(APP); }
  // The App Manager lets the view's own page files load without the token (cli._static_asset); api/ needs it.
  if (u.pathname === '/wizard-os-home/store-install/_connections/') { res.setHeader('content-type', 'text/html'); return res.end(CONNECTIONS); }
  if (u.pathname.startsWith('/wizard-os-home/') && !/\/(api|store-install|store-data)\//.test(u.pathname)) {
    let file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.endsWith('/')) file += 'index.html';
    if (file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile()) { res.setHeader('content-type', TYPES[path.extname(file)] || 'text/plain'); return res.end(fs.readFileSync(file)); }
  }
  // Owner routes answer like the Agent Service / App Manager with the boundary on: the token or 401.
  const owner = /^\/(wizard\/|api\/|v1\/|wizard-os-home\/(api|store-install)\/)/.test(u.pathname);
  res.statusCode = owner ? (req.headers['x-wizard-shell-token'] === TOKEN ? 200 : 401) : 404;
  res.setHeader('content-type', 'application/json'); res.end(owner ? '{}' : '');
});
const fails = [];
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const frameOf = (page, p) => page.frames().find(f => new URL(f.url() || 'about:blank', 'http://x').pathname === p);
async function opaqueApp(page, p, label) {
  await page.waitForFunction(q => [...document.querySelectorAll('.wl-frame iframe')].some(f => f.src.includes(q)), p, { timeout: 5000 }).catch(() => {});
  const sandbox = await page.evaluate(() => document.querySelector('.wl-frame iframe')?.getAttribute('sandbox'));
  check(sandbox === SANDBOX, `${label}: frame sandboxed (${sandbox})`);
  let fr = null;
  for (let i = 0; i < 40 && !fr; i++) { fr = frameOf(page, p); if (!fr) await page.waitForTimeout(100); }
  await fr?.waitForFunction(() => typeof window.probe === 'function', null, { timeout: 5000 }).catch(() => {});
  const before = seen.filter(s => s.path === '/wizard/v1/threads').length;
  const probe = fr ? await fr.evaluate(() => window.probe()).catch(e => ({ error: e.message })) : { error: 'no frame' };
  check(probe.origin === 'null' && String(probe.parentDoc).startsWith('blocked') && (String(probe.storage).startsWith('blocked') || typeof probe.storage === 'number') && (probe.owner === 401 || String(probe.owner).startsWith('blocked')),
    `${label}: page is opaque, can't reach the shell or its storage, owner call refused: ${JSON.stringify(probe)}`);
  const call = seen.filter(s => s.path === '/wizard/v1/threads').slice(before);
  check(call.length === 1 && call[0].token === '' && call[0].origin === 'null', `${label}: its owner call went out with Origin null and no token`);
  return fr;
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base + '/');
  check(await page.evaluate(() => !!window.WizBrowserBoundary?.enabled), 'boundary on in the shell');

  // Welcome › Connect your AI › Claude.
  await page.evaluate(() => window.WosWelcome.open('ai'));
  await page.click('[data-wl="provider"][data-app="wizard-claude"]');
  const claude = await opaqueApp(page, '/wizard-claude/', 'sign-in');
  // Esc inside the sign-in page steps the Welcome back to the provider list (a real click, then a real key).
  if (claude) {
    await page.waitForTimeout(300); // the app client says ready on the boundary channel
    const box = await page.locator('.wl-frame iframe').boundingBox();
    await page.mouse.click(box.x + 20, box.y + 60);
    await claude.focus('#f').catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.wl-frame iframe'), null, { timeout: 3000 }).catch(() => {});
  }
  const backTo = await page.evaluate(() => ({ frame: !!document.querySelector('.wl-frame iframe'), title: document.querySelector('.wl-card h2')?.textContent }));
  check(!backTo.frame && backTo.title === 'Connect your AI', `sign-in: Esc inside the page steps back (${JSON.stringify(backTo)})`);

  // Welcome › Bring your AI › the Importer.
  await page.evaluate(() => { window.WosWelcome.close(); window.WosWelcome.open('bring'); });
  await page.click('[data-wl="bring"]');
  await opaqueApp(page, '/importer/', 'importer');
  await page.evaluate(() => window.WosWelcome.close());

  // Settings › Connections: owner code, same-origin, armed.
  check(await page.evaluate(() => window.WizBrowserBoundary.frameAttributes('/wizard-os-home/store-install/_connections/?embed=settings') === ''),
    'Connections view is one of the shell\'s own pages (no sandbox)');
  await page.evaluate(() => window.openConnections());
  let conn = null;
  for (let i = 0; i < 40; i++) { conn = frameOf(page, '/wizard-os-home/store-install/_connections/'); if (conn && await conn.evaluate(() => window.loaded !== undefined).catch(() => false)) break; await page.waitForTimeout(100); }
  const loaded = conn ? await conn.evaluate(() => window.loaded).catch(e => 'error:' + e.message) : 'no frame';
  check(loaded === 200, `Connections: its first api/ call gets through (status ${loaded})`);
  const later = conn ? await conn.evaluate(() => fetch('api/apps/wizard/connections').then(r => r.status)).catch(e => 'error:' + e.message) : 'no frame';
  check(later === 200, `Connections: a later api/ call gets through (status ${later})`);
  const api = seen.filter(s => s.path.startsWith('/wizard-os-home/store-install/_connections/api/'));
  check(api.length === 2 && api.every(s => s.token === TOKEN), `Connections: every api/ call carried the token (${api.length})`);
  const doc = seen.find(s => s.path === '/wizard-os-home/store-install/_connections/');
  check(!!doc && doc.token === '', 'Connections: the page load itself carried no token');

  await browser.close(); server.close();
  console.log(fails.length ? `${fails.length} FAIL` : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
