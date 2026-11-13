// Browser QA for the browser owner boundary (wizard-os#133, slice 41): the Welcome's provider sign-in and the
// Importer are app pages, sandboxed like any app window. Real Chromium: a shell page with the boundary on and the real
// core/browser-boundary.js, core/app-services.js and core/welcome.js; the app pages load the real core/app-client.js.
// An opaque page's own fetch goes out with `Origin: null` and no cookie, and the browser hides the answer, so before
// this slice the sign-in page could not reach its own backend from inside the Welcome (signing in never finished)
// and its saved settings threw. Now the Welcome attaches the frame as that app's window:
//  - Connect your AI › Claude: the sign-in page reads its status and posts the sign-in to its own backend (with the
//    owner's cookie, no token), keeps a setting in localStorage, and Esc inside it still steps the Welcome back.
//  - Bring your AI: the Importer page loads its sources from its own backend the same way.
//  - Neither page can reach an owner route or another app (Origin null, no cookie, no token, refused).
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-welcome-signin.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the backend and storage checks must fail there.
//   QA_SHOT=<file.png>: a screenshot of the Welcome with the sign-in page after it loaded.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
const BROKEN = process.env.QA_EXPECT === 'broken';
const TOKEN = 'ab'.repeat(32);
// A provider app's sign-in page, the way wizard-claude's `?connect=1` page works: it asks its own backend whether
// the owner is signed in, remembers the last step in localStorage, and a tap on Sign in posts to its backend.
const SIGNIN = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{margin:0;padding:16px 18px;font:15px system-ui;background:#fbfaf7;color:#1d1b22}h1{font-size:18px;margin:0 0 10px}
.row{margin:8px 0;padding:10px 12px;border-radius:10px;background:#efece4}.bad{background:#fde3e1;color:#8a1c12}
button{font:inherit;padding:8px 14px;border-radius:9px;border:0;background:#cc785c;color:#fff}</style></head>
<body><h1>Sign in to Claude</h1><div id="out"><div class="row">Checking…</div></div><button id="go">Sign in with Claude</button><input id="f">
<script>
  window.keys = []; addEventListener('keydown', e => window.keys.push(e.key), true);
  const out = document.getElementById('out');
  try { window.stepWas = localStorage.getItem('claude.step'); localStorage.setItem('claude.step', 'status'); window.storage = 'ok'; }
  catch (e) { window.storage = 'blocked:' + e.name; }
  window.signState = fetch('api/login/status').then(r => r.json()).then(j => { out.innerHTML = '<div class="row">' + (j.signedIn ? 'Signed in' : 'Not signed in yet') + ' (box owner: <b>' + j.who + '</b>)</div>'; return j; },
    e => { out.innerHTML = '<div class="row bad">Couldn\\u2019t reach Claude on this Wizard (' + e.name + '). Signing in can\\u2019t finish.</div>'; return 'blocked:' + e.name; });
  window.signIn = () => fetch('api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'abc' }) })
    .then(r => r.status, e => 'blocked:' + e.name);
  window.probe = async () => {
    const o = { origin: self.origin };
    try { o.parentDoc = !!parent.document; } catch (e) { o.parentDoc = 'blocked:' + e.name; }
    try { const r = await fetch('/wizard/v1/threads', { method: 'POST', body: '{}' }); o.owner = r.status; } catch (e) { o.owner = 'blocked:' + e.name; }
    try { const r = await fetch('/other/api/secret'); o.other = r.status; } catch (e) { o.other = 'blocked:' + e.name; }
    return o;
  };
</script></body></html>`;
const IMPORTER = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><h1>Bring your AI</h1><div id="out"></div><script>
  window.sources = fetch('api/sources').then(r => r.json()).then(j => j.sources, e => 'blocked:' + e.name);
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<meta name="wizard-shell-token" content="${TOKEN}">
<script>document.cookie = 'sid=owner; path=/';</script>
<script src="/wizard-os-home/core/shell-token.js"></script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>const APPS = [{ id: 'wizard-claude', kind: 'wizard', url: '/wizard-claude/', name: 'Claude' }, { id: 'importer', kind: 'wizard', url: '/importer/', name: 'Importer' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } }; window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<script src="/wizard-os-home/core/welcome.js"></script>
<style>body{margin:0;background:#16121f;font:14px system-ui;color:#fff}.wl-overlay{position:fixed;inset:0;display:grid;place-items:center}
.wl-card{width:460px;background:#221c31;border-radius:16px;padding:16px}.wl-frame iframe{width:100%;height:230px;border:0;border-radius:10px;background:#fff}
.wl-head h2{margin:6px 0}.wl-brand img{display:none}.wl-dots{display:none}.wl-status{opacity:.8}
.wl-back,.wl-choice,.wl-primary,.wl-skip{font:inherit;color:#fff;background:#3a3150;border:0;border-radius:8px;padding:6px 10px;margin:4px}</style></head>
<body><script>
  window.WosWelcome.boot({ app: id => APPS.find(a => a.id === id) || null, deeplinked: () => true });
</script></body></html>`;
const html = (res, body) => { res.setHeader('content-type', 'text/html'); res.end(body); };
const seen = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    if (u.pathname.includes('/api/') || u.pathname.startsWith('/wizard/')) seen.push({ path: u.pathname, method: req.method, origin: req.headers.origin || '', cookie: req.headers.cookie || '', token: req.headers['x-wizard-shell-token'] || '', body });
    const json = (o, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    const owner = /sid=owner/.test(req.headers.cookie || '');
    if (u.pathname === '/') return html(res, SHELL);
    if (u.pathname === '/wizard-claude/') return html(res, SIGNIN);
    if (u.pathname === '/importer/') return html(res, IMPORTER);
    if (u.pathname === '/wizard-claude/api/login/status') return owner ? json({ signedIn: false, who: 'owner' }) : json({ error: 'sign in' }, 401);
    if (u.pathname === '/wizard-claude/api/login' && req.method === 'POST') return owner && JSON.parse(body || '{}').code === 'abc' ? json({ ok: true }, 201) : json({ error: 'no' }, 401);
    if (u.pathname === '/importer/api/sources') return owner ? json({ sources: ['ChatGPT export', 'Claude export'] }) : json({ error: 'sign in' }, 401);
    if (u.pathname === '/other/api/secret') return json({ secret: 'other app data' });
    // Owner routes answer like the Agent Service with the boundary on: the token or 401 (the model list for the poll too).
    if (u.pathname.startsWith('/wizard/')) return json(req.headers['x-wizard-shell-token'] === TOKEN ? {} : { error: 'token' }, req.headers['x-wizard-shell-token'] === TOKEN ? 200 : 401);
    if (u.pathname.startsWith('/wizard-os-home/')) {
      const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
      if (file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile()) { res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(file)); }
    }
    res.statusCode = 404; res.end('');
  });
});
const fails = [];
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const frameOf = (page, p) => page.frames().find(f => { try { return new URL(f.url() || 'about:blank', 'http://x').pathname === p; } catch (_) { return false; } });
async function appFrame(page, p) {
  let fr = null;
  for (let i = 0; i < 50 && !fr; i++) { fr = frameOf(page, p); if (!fr) await page.waitForTimeout(100); }
  return fr;
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 520, height: 470 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/');
  check(await page.evaluate(() => !!window.WizBrowserBoundary?.enabled), 'boundary on in the shell');

  // Welcome › Connect your AI › Claude.
  await page.evaluate(() => window.WosWelcome.open('ai'));
  await page.click('[data-wl="provider"][data-app="wizard-claude"]');
  const sandbox = await page.evaluate(() => document.querySelector('.wl-frame iframe')?.getAttribute('sandbox'));
  check(/allow-scripts/.test(sandbox || '') && !/allow-same-origin/.test(sandbox || ''), `sign-in: frame sandboxed (${sandbox})`);
  const claude = await appFrame(page, '/wizard-claude/');
  await claude?.waitForFunction(() => window.signState !== undefined, null, { timeout: 5000 }).catch(() => {});
  const status = claude ? await Promise.race([claude.evaluate(() => window.signState), new Promise(r => setTimeout(() => r('timeout'), 6000))]).catch(e => 'error:' + e.message) : 'no frame';
  check(status?.who === 'owner', `sign-in: the page reads its sign-in state from its own backend (${JSON.stringify(status)})`);
  const statusCall = seen.find(s => s.path === '/wizard-claude/api/login/status');
  check(!!statusCall && statusCall.origin !== 'null' && /sid=owner/.test(statusCall.cookie) && statusCall.token === '',
    `sign-in: that call carried the owner's cookie, not Origin null, and no token (${JSON.stringify(statusCall && { origin: statusCall.origin, cookie: statusCall.cookie, token: statusCall.token })})`);
  if (SHOT) { await page.waitForTimeout(300); await page.screenshot({ path: SHOT }); }
  const posted = claude ? await Promise.race([claude.evaluate(() => window.signIn()), new Promise(r => setTimeout(() => r('timeout'), 6000))]).catch(e => 'error:' + e.message) : 'no frame';
  check(posted === 201, `sign-in: posting the sign-in code to its own backend works (${posted})`);
  const storage = claude ? await claude.evaluate(() => window.storage).catch(e => 'error:' + e.message) : 'no frame';
  check(storage === 'ok', `sign-in: its saved settings work (localStorage: ${storage})`);
  await page.waitForTimeout(400); // the page's save reaches the shell
  const kept = await page.evaluate(() => localStorage.getItem('wos.app-storage.v1.wizard-claude'));
  check(/claude\.step/.test(kept || ''), `sign-in: the shell keeps them under the app's own id (${kept})`);
  const probe = claude ? await claude.evaluate(() => window.probe()).catch(e => ({ error: e.message })) : { error: 'no frame' };
  check(probe.origin === 'null' && String(probe.parentDoc).startsWith('blocked') && (probe.owner === 401 || String(probe.owner).startsWith('blocked'))
    && String(probe.other).startsWith('blocked'), `sign-in: still opaque; owner route and another app stay out of reach (${JSON.stringify(probe)})`);
  const ownerCall = seen.filter(s => s.path === '/wizard/v1/threads');
  check(ownerCall.length === 1 && ownerCall[0].token === '' && ownerCall[0].origin === 'null' && ownerCall[0].cookie === '', 'sign-in: its owner call went out with Origin null, no cookie and no token');
  const other = seen.filter(s => s.path === '/other/api/secret');
  check(other.length === 1 && other[0].origin === 'null' && other[0].cookie === '', 'sign-in: its call to another app went out with Origin null and no cookie');

  // Esc inside the sign-in page still steps the Welcome back (a real click, then a real key).
  if (claude) {
    const box = await page.locator('.wl-frame iframe').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 200);
    await claude.focus('#f').catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.wl-frame iframe'), null, { timeout: 3000 }).catch(() => {});
  }
  const backTo = await page.evaluate(() => ({ frame: !!document.querySelector('.wl-frame iframe'), title: document.querySelector('.wl-card h2')?.textContent }));
  check(!backTo.frame && backTo.title === 'Connect your AI', `sign-in: Esc inside the page steps back (${JSON.stringify(backTo)})`);
  const left = await page.evaluate(() => window.WizAppServices.inspect().map(x => x.appId));
  check(!left.includes('wizard-claude'), `sign-in: leaving the step lets the window go (${JSON.stringify(left)})`);

  // Welcome › Bring your AI › the Importer.
  await page.evaluate(() => { window.WosWelcome.close(); window.WosWelcome.open('bring'); });
  await page.click('[data-wl="bring"]');
  const imp = await appFrame(page, '/importer/');
  await imp?.waitForFunction(() => window.sources !== undefined, null, { timeout: 5000 }).catch(() => {});
  const sources = imp ? await Promise.race([imp.evaluate(() => window.sources), new Promise(r => setTimeout(() => r('timeout'), 6000))]).catch(e => 'error:' + e.message) : 'no frame';
  check(Array.isArray(sources) && sources.length === 2, `importer: loads its sources from its own backend (${JSON.stringify(sources)})`);
  await page.evaluate(() => window.WosWelcome.close());
  const after = await page.evaluate(() => window.WizAppServices.inspect().length);
  check(after === 0, `closing the Welcome lets every window go (${after})`);
  check(!errors.length, `no page errors (${errors.join(' | ')})`);

  await browser.close(); server.close();
  if (BROKEN) { console.log(fails.length ? `EXPECTED BROKEN: ${fails.length} FAIL` : 'UNEXPECTED: all pass on the broken build'); process.exit(fails.length ? 0 : 1); }
  console.log(fails.length ? `${fails.length} FAIL` : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
