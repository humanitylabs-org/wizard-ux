// Browser QA for the browser owner boundary's sandboxed app frames (wizard-os#133).
// Real Chromium: a shell page with the boundary on (WizShellBoundary set the way shell-token.js does), the real
// core/browser-boundary.js and core/appearance-host.js, and an app page in a sandboxed frame that loads the real
// core/app-client.js. Checks the app is opaque and cannot reach the shell, and that Back, appearance and dictation into
// the app's focused field (the real core/focused-field.js, as the orb uses it) still work.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-frames.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = path.join(__dirname, '..', 'web');
const seen = [];
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><input id="f" value="hello"><script>
  let depth = 1; window.steps = [];
  WizardApp.back.register({ canGoBack: () => depth > 0, back: () => { depth--; steps.push('app-back'); return true; } });
  WizardApp.theme?.onChange?.(t => steps.push('theme:' + t.revision));
  window.probe = async () => {
    const out = { origin: self.origin, locationOrigin: location.origin };
    try { out.parentDoc = !!parent.document; } catch (e) { out.parentDoc = 'blocked:' + e.name; }
    try { out.storage = typeof localStorage.getItem('x'); } catch (e) { out.storage = 'blocked:' + e.name; }
    try { const r = await fetch('/wizard/v1/threads', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }); out.owner = r.status; } catch (e) { out.owner = 'blocked:' + e.name; }
    return out;
  };
</script></body></html>`;
const SHELL = `<!doctype html><html data-skin="nebula"><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>window.WizCore = { apps: () => ({ APPS: [{ id: 'notes', url: '/notes/' }] }) };</script>
<script src="/wizard-os-home/core/appearance-host.js"></script>
<script src="/wizard-os-home/core/focused-field.js"></script></head>
<body><button id="orb">orb</button><div class="win" data-win="w1"><iframe class="appframe" sandbox="${'allow-scripts allow-forms allow-downloads'}" src="/notes/"></iframe></div>
<script>window.secretInShell = 'shell-only'; localStorage.setItem('shell', 'private');
  const f = document.querySelector('iframe'); WizBrowserBoundary.attach(f); window.rootSteps = [];
  window.backOnce = () => WizBrowserBoundary.back(f, () => rootSteps.push('shell-step'));
  window.fieldPaints = [];
  const FIELDS = WizCore.focusedField.create({ frames: () => [f], controls: el => el?.id === 'orb', onChange: c => fieldPaints.push(!!c) });
  // The orb's dictation path: capture at the start of the take, insert the words at the end, release right after.
  window.dictate = async words => { const seal = FIELDS.capture(); if (!seal) return 'no-field'; const p = FIELDS.insert(seal, words); seal.release(); return (await p) ? 'inserted' : 'refused'; };
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push({ path: u.pathname, origin: req.headers.origin || '', token: req.headers['x-wizard-shell-token'] || '' });
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(SHELL); }
  if (u.pathname === '/notes/') { res.setHeader('content-type', 'text/html'); return res.end(APP); }
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/css'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = u.pathname.startsWith('/wizard/') ? 401 : 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/');
  const app = () => page.frames().find(fr => fr.url().endsWith('/notes/'));
  await page.waitForFunction(() => document.querySelector('.win').classList.contains('wz-themed'), null, { timeout: 8000 });
  const probe = await app().evaluate(() => window.probe());
  const r1 = await page.evaluate(() => window.backOnce());
  await page.waitForFunction(() => true); await new Promise(r => setTimeout(r, 300));
  const r2 = await page.evaluate(() => window.backOnce());
  await new Promise(r => setTimeout(r, 300));
  const steps = await app().evaluate(() => window.steps);
  // Dictation: tap into the app's field (focus stays in the app), then the orb inserts the words at the cursor.
  const before = await page.evaluate(() => window.dictate('nothing'));
  await app().click('#f'); await app().evaluate(() => { const i = document.getElementById('f'); i.setSelectionRange(5, 5); });
  await page.waitForFunction(() => window.fieldPaints.at(-1) === true, null, { timeout: 4000 });
  const dictated = await page.evaluate(() => window.dictate('world'));
  // Keyboard on the orb (focus moves to a shell control): the field the take started in still gets the words.
  await app().click('#f'); await app().evaluate(() => { const i = document.getElementById('f'); i.setSelectionRange(0, 0); });
  await page.waitForTimeout(100); await page.focus('#orb');
  const fromOrb = await page.evaluate(() => window.dictate('Say'));
  const fieldValue = await app().evaluate(() => document.getElementById('f').value);
  // The focused field turns read-only without a focus event: the shell stops offering dictation.
  await app().click('#f'); await page.waitForFunction(() => window.fieldPaints.at(-1) === true, null, { timeout: 4000 });
  await app().evaluate(() => { document.getElementById('f').readOnly = true; });
  const readOnlyDropped = await page.waitForFunction(() => window.fieldPaints.at(-1) === false, null, { timeout: 4000 }).then(() => true, () => false);
  const rootSteps = await page.evaluate(() => window.rootSteps);
  const ownerCall = seen.find(s => s.path === '/wizard/v1/threads');
  const result = { probe, back: [r1, r2], steps, rootSteps, ownerCall, dictation: { before, dictated, fromOrb, fieldValue, readOnlyDropped }, errors };
  console.log(JSON.stringify(result, null, 1));
  const fails = [];
  if (probe.origin !== 'null') fails.push('app origin is not opaque');
  if (probe.locationOrigin !== new URL(base).origin) fails.push('location.origin');
  if (!String(probe.parentDoc).startsWith('blocked')) fails.push('app reached parent.document');
  if (!String(probe.storage).startsWith('blocked')) fails.push('app reached shell storage');
  if (!ownerCall || ownerCall.token || ownerCall.origin !== 'null') fails.push('owner call from the app was not opaque/tokenless');
  if (r1 !== 'pending' || r2 !== 'pending') fails.push('back result');
  if (!steps.includes('app-back')) fails.push('app Back did not run');
  if (rootSteps.join() !== 'shell-step') fails.push('shell step at root did not run once');
  if (before !== 'no-field') fails.push('dictation offered with no field focused');
  if (dictated !== 'inserted' || fromOrb !== 'inserted' || fieldValue !== 'Say hello world') fails.push('dictation into the sandboxed field');
  if (!readOnlyDropped) fails.push('a read-only field still offered dictation');
  if (errors.length) fails.push('page errors');
  await browser.close(); server.close();
  if (fails.length) { console.error('FAIL', fails); process.exit(1); }
  console.log('PASS: sandboxed app is opaque, cannot reach the shell; Back, appearance and dictation work by postMessage');
})().catch(e => { console.error(e); process.exit(1); });
