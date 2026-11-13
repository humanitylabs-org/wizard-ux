// Browser QA for the browser owner boundary, slice 50 (wizard-os#133): an owner's own version of an app (an "own screen",
// /wizard/views/<id>/, core/own-views.js) in a sandboxed window. Before, the shell could not read the opaque document,
// ignored its boot script's `null`-origin ready message and could not make its relative `api/…` calls (an owner route
// under /wizard/), so after the load (or 12 s) it fell back to the original screen ("Your version couldn't load …").
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js, core/app-services.js and
// core/own-views.js, and a stand-in Agent Service that answers /wizard/views/ the way wizard-agent-service
// server/app-views.mjs does with the boundary on (files without a token, `Access-Control-Allow-Origin: *` for an
// `Origin: null` file, the page never to an opaque caller, `view.api` in the app list, api/ only as a 307).
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-own-views.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOTS=<dir>: also save a screenshot of the shell.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const VIEW = {
  'index.html': `<!doctype html><html><head><script src="/wizard/views/_boot.js"></script><meta charset="utf-8"><link rel="stylesheet" href="./style.css" crossorigin></head>
<body><h1>My habits (your version)</h1><ul id="list"><li>Loading…</li></ul><input id="name"><button id="add">Add</button><p id="status"></p>
<script src="/wizard-os-home/core/app-client.js"></script><script type="module" src="./app.js"></script></body></html>`,
  'style.css': 'body{font:15px system-ui;background:#10131c;color:#e8ecff;margin:12px} h1{color:#9fb4ff;font-size:20px}',
  'util.js': 'export const row = h => `<li>${h.name}</li>`;',
  'app.js': `import { row } from './util.js';
const list = document.getElementById('list'), status = document.getElementById('status');
window.results = {};
async function load() { const r = await fetch('api/items'); results.listStatus = r.status; list.innerHTML = (await r.json()).items.map(row).join(''); }
document.getElementById('add').onclick = async () => {
  const r = await fetch('api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('name').value }) });
  results.addStatus = r.status; status.textContent = r.ok ? 'Saved' : 'Not saved'; await load();
};
// A hostile line in the same screen: the owner's own routes stay closed to it.
fetch('/wizard/v1/settings').then(r => { results.owner = r.status; }, () => { results.owner = 'refused'; });
load().then(() => { results.loaded = true; }, e => { results.loaded = 'error ' + e; });`,
};
const BOOT = `(() => { const send = (type, file) => { if (parent !== window) parent.postMessage({ type, file, at: performance.timeOrigin }, location.origin); };
  addEventListener('error', e => send('wizard:own-view:error', e.target?.src || e.target?.href || e.filename || 'index.html'), true);
  addEventListener('DOMContentLoaded', () => send('wizard:own-view:ready', 'index.html')); })();`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const items = [{ name: 'Walk' }, { name: 'Read' }], log = [];
const TILE = { id: 'habits', kind: 'wizard', name: 'Habits', source: 'apps.json', originalUrl: '/habits/', url: '/wizard/views/habits/',
  view: { mode: 'own', url: '/wizard/views/habits/', api: '/habits/api/' } };
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });
const T = ${JSON.stringify(TILE)};
window.WizCore = { apps: () => ({ APPS: [T] }), workspaceNav: { setCount() {} }, deeplink: { route() {} }, refreshApps: async () => {} };
window.WosSettings = { register() {}, refresh() {} };</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script><script src="/wizard-os-home/core/app-services.js"></script>
<script src="/wizard-os-home/core/own-views.js"></script></head>
<body style="background:#222;color:#ddd;font:13px system-ui;margin:8px"><div class="win"><div class="wbar">Habits</div>
<iframe class="appframe" data-own-app="habits" sandbox="allow-scripts allow-forms allow-downloads" src="/wizard/views/habits/" style="width:640px;height:300px;border:0"></iframe></div>
<script>WizAppServices.attach(document.querySelector('iframe'), { appId: 'habits', path: T.url, isVisible: () => true });</script></body></html>`;
const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'Cache-Control': 'no-store', ...headers }); res.end(body); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), origin = req.headers.origin, opaque = String(origin || '').toLowerCase() === 'null';
  const note = code => log.push(`${req.method} ${u.pathname} origin=${origin} -> ${code}`);
  if (u.pathname === '/') return send(res, 200, SHELL, { 'Content-Type': 'text/html' });
  if (u.pathname.startsWith('/wizard-os-home/core/')) {
    const f = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), { 'Content-Type': 'text/javascript' }) : send(res, 404, '');
  }
  if (u.pathname === '/wizard/views/_boot.js') { note(200); return send(res, 200, BOOT, { 'Content-Type': 'text/javascript' }); }
  if (u.pathname.startsWith('/wizard/views/habits/')) {
    const rel = u.pathname.slice('/wizard/views/habits/'.length) || 'index.html';
    if (rel.startsWith('api/')) {
      // The Service's 307 to the app's API; under the boundary it needs the shell token (a sandboxed page has none).
      const code = opaque ? 403 : req.headers['x-wizard-shell-token'] ? 307 : 401; note(code);
      return send(res, code, '', code === 307 ? { Location: '/habits/api/' + rel.slice(4) + u.search } : {});
    }
    if (!['GET', 'HEAD'].includes(req.method) || !VIEW[rel] || (opaque && rel.endsWith('.html'))) { note(404); return send(res, opaque ? 403 : 404, ''); }
    note(200);
    return send(res, 200, VIEW[rel], { 'Content-Type': TYPES[path.extname(rel)], ...(opaque ? { 'Access-Control-Allow-Origin': '*' } : {}),
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'" });
  }
  if (u.pathname.startsWith('/wizard/')) { note(opaque ? 403 : 401); return send(res, opaque ? 403 : 401, '{"error":"shell_token_required"}'); }
  if (u.pathname === '/habits/api/items') {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      if (req.method === 'POST') { try { items.push({ name: JSON.parse(body).name }); } catch (_) {} }
      note(200); send(res, 200, JSON.stringify({ items }), { 'Content-Type': 'application/json' });
    }); return;
  }
  if (u.pathname.startsWith('/habits/')) return send(res, 200, '<!doctype html><h1>Habits (original screen)</h1>', { 'Content-Type': 'text/html' });
  send(res, 404, '');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 680, height: 360 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/');
  const frame = () => page.frames().find(f => f !== page.mainFrame());
  const results = async () => frame().evaluate(() => window.results || {}).catch(() => ({}));
  for (let i = 0; i < 40 && !(await results()).loaded; i++) await page.waitForTimeout(100);
  const f = frame();
  await f.locator('#name').fill('Stretch', { timeout: 2000 }).catch(() => {});
  await f.locator('#add').click({ timeout: 2000 }).catch(() => {});
  for (let i = 0; i < 30 && !(await results()).addStatus; i++) await page.waitForTimeout(100);
  // The readiness watchdog falls back after 12 s without a ready message: wait it out.
  await page.waitForTimeout(12500);
  const r = await results(), note = await page.evaluate(() => document.querySelector('.own-view-note')?.textContent || '');
  const src = await page.evaluate(() => document.querySelector('iframe').getAttribute('src'));
  const text = await frame().evaluate(() => document.body.innerText).catch(() => '');
  if (process.env.QA_SHOTS) { fs.mkdirSync(process.env.QA_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.QA_SHOTS, 'own-view-boundary.png') }); }
  const checks = [
    ['the own screen stays in its window (no fallback to the original)', src === '/wizard/views/habits/' && !note],
    ['its document is opaque (sandboxed)', await frame().evaluate(() => self.origin).catch(() => '') === 'null'],
    ['its module script, import and stylesheet loaded', r.loaded === true && /Walk/.test(text)],
    ['its api/ list call went to the app\'s API through the shell', r.listStatus === 200 && log.some(l => l.startsWith('GET /habits/api/items'))],
    ['Add saved through the app\'s API', r.addStatus === 200 && items.some(x => x.name === 'Stretch') && /Saved/.test(text)],
    ['no api/ call reached the Service\'s /wizard/ route', !log.some(l => l.includes('/wizard/views/habits/api/'))],
    ['an owner route stays closed to the screen', r.owner !== undefined && r.owner !== 200],
  ];
  let failed = 0;
  for (const [name, ok] of checks) { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; }
  if (errors.length) console.log('page errors:', errors.join(' | '));
  if (failed) console.log(log.join('\n'));
  await browser.close(); server.close();
  const broken = process.env.QA_EXPECT === 'broken';
  console.log(broken ? `expected broken: ${failed} checks failed` : `${checks.length - failed}/${checks.length} passed`);
  process.exit(broken ? (failed ? 0 : 1) : (failed ? 1 : 0));
})().catch(e => { console.error(e); process.exit(1); });
