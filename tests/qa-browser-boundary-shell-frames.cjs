// Browser QA for the browser owner boundary (wizard-os#133): the shell's own pages in an app window.
// Real Chromium: a top-level shell page with a shell token in its meta (as nginx writes it), the real
// core/shell-token.js and core/browser-boundary.js, and app windows made the way app.js/desktop.js make them
// (`frameAttributes(url)`). The real Store, Agents and Setup pages must stay same-origin and send their owner calls
// with the token; an app page must be sandboxed and send none; a shell window that lands on an app page is reloaded
// sandboxed.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-shell-frames.cjs
//   QA_WEB=<other web dir> runs the same checks against another build (e.g. main: the Store frame is sandboxed there).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB || path.join(__dirname, '..', 'web');
const TOKEN = 'cd'.repeat(32);
const seen = [];
const APP = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
  window.probe = async () => {
    const out = { origin: self.origin };
    try { out.parentDoc = !!parent.document; } catch (e) { out.parentDoc = 'blocked:' + e.name; }
    try { const r = await fetch('/wizard/v1/threads', { method: 'POST', body: '{}' }); out.owner = r.status; } catch (e) { out.owner = 'blocked:' + e.name; }
    return out;
  };
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<meta name="wizard-shell-token" content="${TOKEN}">
<script src="/wizard-os-home/core/shell-token.js"></script>
<script src="/wizard-os-home/core/browser-boundary.js"></script></head>
<body><div id="wins"></div><script>
  window.openWin = (id, url) => {
    const B = window.WizBrowserBoundary;
    const attrs = B && B.enabled ? ' ' + (B.frameAttributes.length ? B.frameAttributes(url) : B.frameAttributes()) : '';
    document.getElementById('wins').insertAdjacentHTML('beforeend', '<div class="win"><iframe id="' + id + '"' + attrs + ' src="' + url + '"></iframe></div>');
    const f = document.getElementById(id); B && B.attach(f); return f.getAttribute('sandbox');
  };
</script></body></html>`;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push({ path: u.pathname, ref: req.headers.referer || '', origin: req.headers.origin || '', token: req.headers['x-wizard-shell-token'] || '' });
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(SHELL); }
  if (u.pathname === '/notes/') { res.setHeader('content-type', 'text/html'); return res.end(APP); }
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
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base + '/');
  check(await page.evaluate(() => !!window.WizBrowserBoundary?.enabled), 'boundary on in the shell');
  for (const [id, url] of [['store', '/wizard-os-home/store/index.html'], ['agents', '/wizard-os-home/agents/index.html'], ['setup', '/wizard-os-home/setup/index.html']]) {
    const sandbox = await page.evaluate(([i, u]) => window.openWin(i, u), [id, url]);
    check(sandbox === null, `${id}: window not sandboxed (got ${sandbox})`);
    const fr = await page.waitForFunction(i => document.getElementById(i).contentWindow?.document?.readyState === 'complete', id, { timeout: 8000 }).then(() => page.frames().find(f => f.url().endsWith(url)), () => null);
    // One owner call from the page itself (as its own code would make it), plus whatever its scripts sent on load.
    const status = fr ? await fr.evaluate(() => fetch('/wizard/v1/agents').then(r => r.status, e => 'blocked:' + e.name)).catch(e => 'error:' + e.message) : 'no frame';
    check(status === 200, `${id}: owner call from the page gets through (status ${status})`);
    const fromPage = seen.filter(s => s.ref.includes(url.replace(/index\.html$/, '')) && /^\/(wizard\/|api\/|v1\/|wizard-os-home\/(api|store-install)\/)/.test(s.path));
    check(fromPage.length > 0 && fromPage.every(s => s.token === TOKEN), `${id}: every owner call from the page carried the token (${fromPage.length}: ${[...new Set(fromPage.map(s => s.path))].join(', ')})`);
  }
  const appSandbox = await page.evaluate(() => window.openWin('app', '/notes/'));
  check(appSandbox === 'allow-scripts allow-forms allow-downloads', `app page sandboxed (${appSandbox})`);
  await page.waitForTimeout(400);
  const app = page.frames().find(f => f.url().endsWith('/notes/'));
  const probe = await app.evaluate(() => window.probe());
  check(probe.origin === 'null' && String(probe.parentDoc).startsWith('blocked') && (probe.owner === 401 || String(probe.owner).startsWith('blocked')), `app page opaque, can't reach the shell, owner call refused: ${JSON.stringify(probe)}`);
  const appCall = seen.filter(s => s.path === '/wizard/v1/threads');
  check(appCall.length === 1 && appCall[0].token === '' && appCall[0].origin === 'null', 'app owner call went out with Origin null and no token');
  // The Store window lands on an app page: it comes back sandboxed.
  await page.evaluate(() => { document.getElementById('store').contentWindow.location.href = '/notes/'; });
  await page.waitForFunction(() => document.getElementById('store').getAttribute('sandbox'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => document.getElementById('store').getAttribute('sandbox'));
  check(after === 'allow-scripts allow-forms allow-downloads', `a shell window that lands on an app page is reloaded sandboxed (${after})`);
  const moved = page.frames().filter(f => f.url().endsWith('/notes/'));
  const probes = await Promise.all(moved.map(f => f.evaluate(() => window.probe()).catch(() => null)));
  check(probes.length === 2 && probes.every(p => p && p.origin === 'null'), `…and runs opaque (${JSON.stringify(probes)})`);
  await browser.close(); server.close();
  console.log(fails.length ? `${fails.length} FAIL` : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
