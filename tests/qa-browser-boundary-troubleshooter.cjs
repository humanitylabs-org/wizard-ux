// Browser QA for the browser owner boundary (wizard-os#133): the Troubleshooter window (core/reach.js).
// Real Chromium: a top-level shell page with a shell token in its meta (as nginx writes it), the real
// core/shell-token.js, core/browser-boundary.js and core/reach.js. The repair page loads the real core/app-client.js
// the way wizard-troubleshooter serves it (/troubleshoot/kit/app-client.js).
//  - The repair frame is sandboxed: its page is opaque, can't reach the shell's page or storage, and its owner call
//    goes out with Origin null and no token.
//  - It still shows: the repair page's answer on the boundary channel is the proof it loaded (the shell can't read it).
//  - A page at the repair address that never answers (an error page) is not shown; local help stays.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-troubleshooter.cjs
//   QA_WEB=<other web dir> runs the same checks against another build (e.g. main: the repair frame is open there).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB || path.join(__dirname, '..', 'web');
const TOKEN = 'cd'.repeat(32);
const SANDBOX = 'allow-scripts allow-forms allow-downloads';
const seen = [];
let repairBroken = false;
const REPAIR = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><header><h1>Fix Wizard</h1></header><main>Repair home</main>
<script src="/troubleshoot/kit/app-client.js"></script><script>
  window.probe = async () => {
    const out = { origin: self.origin };
    try { out.parentDoc = !!parent.document; } catch (e) { out.parentDoc = 'blocked:' + e.name; }
    try { out.storage = localStorage.length; } catch (e) { out.storage = 'blocked:' + e.name; }
    try { const r = await fetch('/wizard/v1/threads', { method: 'POST', body: '{}' }); out.owner = r.status; } catch (e) { out.owner = 'blocked:' + e.name; }
    return out;
  };
</script></body></html>`;
const SHELL = `<!doctype html><html data-shell="desktop"><head><meta charset="utf-8">
<meta name="wizard-shell-token" content="${TOKEN}">
<script src="/wizard-os-home/core/shell-token.js"></script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script src="/wizard-os-home/core/reach.js"></script></head>
<body><div class="win" id="w"></div><script>
  const w = document.getElementById('w');
  w.innerHTML = window.WizReach.recoveryHtml();
  window.WizReach.mountRecovery(w.querySelector('[data-recovery]'), '/troubleshoot/');
</script></body></html>`;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push({ path: u.pathname, origin: req.headers.origin || '', token: req.headers['x-wizard-shell-token'] || '' });
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(SHELL); }
  if (u.pathname === '/troubleshoot/') {
    res.setHeader('content-type', 'text/html');
    if (repairBroken) { res.statusCode = req.method === 'HEAD' ? 200 : 502; return res.end(req.method === 'HEAD' ? '' : '<h1>Bad gateway</h1>'); }
    return res.end(req.method === 'HEAD' ? '' : REPAIR);
  }
  if (u.pathname === '/troubleshoot/kit/app-client.js') { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(path.join(WEB, 'core/app-client.js'))); }
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile()) { res.setHeader('content-type', TYPES[path.extname(file)] || 'text/plain'); return res.end(fs.readFileSync(file)); }
  }
  // Owner routes answer like the Agent Service / App Manager with the boundary on: the token or 401.
  const owner = /^\/(wizard\/|api\/|v1\/)/.test(u.pathname);
  res.statusCode = owner ? (req.headers['x-wizard-shell-token'] === TOKEN ? 200 : 401) : 404;
  res.setHeader('content-type', 'application/json'); res.end(owner ? '{}' : '');
});
const fails = [];
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(base + '/');
    const sandbox = await page.evaluate(() => document.querySelector('[data-recovery] iframe')?.getAttribute('sandbox'));
    check(sandbox === SANDBOX, `repair frame sandboxed without same-origin (${sandbox})`);
    const shown = await page.waitForFunction(() => { const f = document.querySelector('[data-recovery] iframe'); return f && !f.hidden && document.querySelector('[data-recovery]').classList.contains('repair-ready'); }, null, { timeout: 9000 }).then(() => true, () => false);
    check(shown, 'the repair page shows (its answer on the boundary channel is the proof)');
    const fr = page.frames().find(f => new URL(f.url() || 'about:blank', 'http://x').pathname === '/troubleshoot/');
    await fr?.waitForFunction(() => typeof window.probe === 'function', null, { timeout: 5000 }).catch(() => {});
    const before = seen.filter(s => s.path === '/wizard/v1/threads').length;
    const probe = fr ? await fr.evaluate(() => window.probe()).catch(e => ({ error: e.message })) : { error: 'no frame' };
    check(probe.origin === 'null' && String(probe.parentDoc).startsWith('blocked') && String(probe.storage).startsWith('blocked') && (probe.owner === 401 || String(probe.owner).startsWith('blocked')),
      `repair page is opaque, can't reach the shell or its storage, owner call refused: ${JSON.stringify(probe)}`);
    const call = seen.filter(s => s.path === '/wizard/v1/threads').slice(before);
    check(call.length === 1 && call[0].token === '' && call[0].origin === 'null', 'its owner call went out with Origin null and no token');

    // An error page at the repair address never answers, so it is never shown as the repair page.
    repairBroken = true;
    const broken = await browser.newPage();
    await broken.goto(base + '/');
    await broken.waitForTimeout(9500);
    const state = await broken.evaluate(() => { const f = document.querySelector('[data-recovery] iframe'); return { src: f.getAttribute('src'), hidden: f.hidden, ready: document.querySelector('[data-recovery]').classList.contains('repair-ready'), help: document.querySelector('details').open }; });
    check(state.src === '/troubleshoot/' && state.hidden && !state.ready && state.help, `an error page is not shown; local help stays open: ${JSON.stringify(state)}`);
  } finally {
    await browser.close(); server.close();
  }
  console.log(fails.length ? `${fails.length} FAILED` : 'all passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
