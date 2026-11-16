// Browser QA for the browser owner boundary's other app frames (wizard-os#133): the link sheet and hidden voice frames.
// Real Chromium: a shell page that loads the real core/browser-boundary.js, core/links.js and core/app-services.js, with
// the boundary on (WizShellBoundary set the way shell-token.js does) and off. On: a page opened in the link sheet is
// opaque and cannot reach the shell, its owner call goes out tokenless with Origin: null, and no hidden app frame is
// warmed for voice commands. Remembered: no token in the page (the offline copy), but this device remembers the box
// turned the boundary on (the mark core/shell-token.js keeps): the same as on. Off: everything stays as before.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-other-frames.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = path.join(__dirname, '..', 'web');
const seen = [];
const APP = `<!doctype html><html><head><meta charset="utf-8"><title>Notes</title></head><body><p>app page</p><script>
  window.probe = async () => {
    const out = { origin: self.origin };
    try { out.parentDoc = !!parent.document; } catch (e) { out.parentDoc = 'blocked:' + e.name; }
    try { out.parentSecret = parent.secretInShell; } catch (e) { out.parentSecret = 'blocked:' + e.name; }
    try { out.storage = localStorage.getItem('shell'); } catch (e) { out.storage = 'blocked:' + e.name; }
    try { const r = await fetch('/wizard/v1/threads', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }); out.owner = r.status; } catch (e) { out.owner = 'blocked:' + e.name; }
    return out;
  };
</script></body></html>`;
const shell = on => `<!doctype html><html><head><meta charset="utf-8">
${on ? `<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>` : ''}
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>const LIST = { APPS: [{ id: 'notes', name: 'Notes', url: '/notes/', provides: ['voice-commands'] }] };
  window.WizCore = { apps: () => LIST };</script>
<script src="/wizard-os-home/core/links.js"></script>
<script src="/wizard-os-home/core/app-services.js"></script></head>
<body><script>window.secretInShell = 'shell-only'; localStorage.setItem('shell', 'private');
  window.sheet = WizLinks.mount({ parent: document.body, mode: 'sheet' });</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push({ path: u.pathname, origin: req.headers.origin || '', token: req.headers['x-wizard-shell-token'] || '' });
  if (u.pathname === '/on' || u.pathname === '/off' || u.pathname === '/remembered') { res.setHeader('content-type', 'text/html'); return res.end(shell(u.pathname === '/on')); }
  if (u.pathname === '/notes/' || u.pathname === '/notes/page') { res.setHeader('content-type', 'text/html'); return res.end(APP); }
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/css'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = u.pathname.startsWith('/wizard/') ? 401 : 404; res.end('');
});
async function run(browser, base, mode) {
  const page = await browser.newPage();
  if (mode === 'remembered') await page.addInitScript(() => { if (window === top) localStorage.setItem('wos.browser-boundary.v1', '1'); });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  seen.length = 0;
  await page.goto(`${base}/${mode}`);
  await page.waitForTimeout(400); // app-services warms voice frames on a 0 ms timer
  const voiceFrames = await page.evaluate(() => document.querySelectorAll('iframe[data-voice-service]').length);
  const sandbox = await page.evaluate(() => document.querySelector('.ls-frame').getAttribute('sandbox'));
  await page.evaluate(() => window.sheet.open('/notes/page'));
  await page.waitForFunction(() => !document.querySelector('.linksheet').classList.contains('loading'), null, { timeout: 8000 });
  const frame = page.frames().find(fr => fr.url().endsWith('/notes/page'));
  const probe = frame ? await frame.evaluate(() => window.probe()) : null;
  const owner = seen.filter(s => s.path === '/wizard/v1/threads').at(-1) || null;
  // The sheet's own Back still closes it, whatever the page is.
  const closed = await page.evaluate(() => window.sheet.back());
  await page.close();
  return { mode, voiceFrames, sandbox, probe, owner, closed, errors };
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const on = await run(browser, base, 'on'), off = await run(browser, base, 'off'), mem = await run(browser, base, 'remembered');
  await browser.close(); server.close();
  const checks = [
    ['on: link sheet frame is sandboxed without same-origin', !!on.sandbox && !on.sandbox.split(/\s+/).includes('allow-same-origin')],
    ['on: page in the sheet has an opaque origin', on.probe?.origin === 'null'],
    ['on: page in the sheet cannot read the shell document', String(on.probe?.parentDoc).startsWith('blocked:')],
    ['on: page in the sheet cannot read shell globals', String(on.probe?.parentSecret).startsWith('blocked:')],
    ['on: page in the sheet cannot read shell storage', String(on.probe?.storage).startsWith('blocked:')],
    ['on: its owner call carries no token and Origin: null', !!on.owner && on.owner.token === '' && on.owner.origin === 'null'],
    ['on: no hidden voice frame is warmed', on.voiceFrames === 0],
    ['on: sheet Back still closes the sheet', on.closed === true],
    ['off: link sheet frame has no sandbox (unchanged)', off.sandbox === null],
    ['off: page in the sheet is same-origin (unchanged)', off.probe?.origin === base && off.probe?.parentDoc === true],
    ['off: the voice frame is still warmed (unchanged)', off.voiceFrames === 1],
    ['remembered (offline copy, no token): link sheet frame is sandboxed', !!mem.sandbox && !mem.sandbox.split(/\s+/).includes('allow-same-origin')],
    ['remembered: page in the sheet is opaque and cannot read the shell', mem.probe?.origin === 'null' && String(mem.probe?.parentDoc).startsWith('blocked:')],
    ['remembered: no hidden voice frame is warmed', mem.voiceFrames === 0],
    ['no page errors', !on.errors.length && !off.errors.length && !mem.errors.length],
  ];
  let failed = 0;
  for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
  if (failed) console.log(JSON.stringify({ on, off, mem }, null, 1));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
