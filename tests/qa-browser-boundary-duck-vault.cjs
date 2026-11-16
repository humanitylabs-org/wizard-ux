// Browser QA for the browser owner boundary, slice 21 (wizard-os#133): a sandboxed app ducks Wizard Music and uses
// its fingerprint vault again. Real Chromium: a shell page with the boundary on (WizShellBoundary set the way
// shell-token.js does), the real core/browser-boundary.js and core/app-services.js, and app pages in sandboxed frames
// that load the real core/app-client.js and call WizardApp.audio.duck and WizardApp.vault.*.
// The phone's device envelope (core/bridge.js -> Android VaultBridge) and Wizard Music (core/background-audio.js) are
// stand-ins that record what the shell asked them.
//  - The app ducks the music for its own window; a reload of that window restores it.
//  - The vault answers has / seal / open / forget under the window's installed app id (never the one the page names),
//    and the app gets only its secret or the saved flags; a native error keeps its code (cancelled).
//  - A second sandboxed page that is not the installed app it claims to be gets neither (and the phone is never asked).
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-duck-vault.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
const APP = who => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{font:14px system-ui;margin:8px}</style></head>
<body><p id="t">${who}</p><script>
  window.out = {};
  const say = s => { document.getElementById('t').textContent = '${who}: ' + s; };
  const code = e => (e && e.code) || String(e && e.message);
  window.run = async () => {
    await WizardApp.ready();
    out.duck = await WizardApp.audio.duck(true);
    out.has = await WizardApp.vault.has();
    try { out.seal = await WizardApp.vault.seal('fixture-secret', 'Unlock ${who}'); } catch (e) { out.seal = 'error:' + code(e); }
    try { out.open = await WizardApp.vault.open('Unlock ${who}'); } catch (e) { out.open = 'error:' + code(e); }
    try { out.denied = await WizardApp.vault.open('cancel me'); } catch (e) { out.denied = 'error:' + code(e); }
    try { out.forget = await WizardApp.vault.forget(); } catch (e) { out.forget = 'error:' + code(e); }
    say('music ' + (out.duck ? 'lowered' : 'not lowered') + ', vault ' + (out.open === 'fixture-secret' ? 'opened' : out.open));
    return out;
  };
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>
  const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.shellLog = { ducks: [], vault: [] };
  const owners = [];
  // Like core/background-audio.js: an owner that never ducked restoring is a no-op (not logged).
  const ducking = new Set();
  window.WizBackgroundAudio = { duck: async (owner, on) => {
    if (on) ducking.add(owner); else if (!ducking.delete(owner)) return false;
    let i = owners.indexOf(owner); if (i < 0) { owners.push(owner); i = owners.length - 1; }
    shellLog.ducks.push([i, on]); return on; } };
  // The phone's device envelope: the stored secret is keyed by the app id the shell sends.
  const saved = {};
  window.wizardDevicePort = { postMessage() {} };
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} }, bridge: { call: async (method, params) => {
    shellLog.vault.push([method, params.appId]);
    if (method === 'vault.has') return { available: true, saved: !!saved[params.appId], appId: params.appId };
    if (method === 'vault.seal') { saved[params.appId] = params.secret; return { saved: true }; }
    if (method === 'vault.open') { if (params.title === 'cancel me') throw new Error('cancelled'); return { secret: saved[params.appId], appId: params.appId }; }
    if (method === 'vault.forget') { delete saved[params.appId]; return { saved: false }; }
    throw new Error('unknown method');
  } } };
  window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{font:14px system-ui}iframe{width:440px;height:60px;border:1px solid #888;display:block}</style></head>
<body><div class="win" id="w1"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<div class="win" id="w2"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/evil/"></iframe></div>
<script>
  const [a, b] = document.querySelectorAll('iframe');
  WizAppServices.attach(a, { appId: 'notes', path: '/notes/', isVisible: () => true, isFront: () => true });
  // The second window claims to be "other" but its frame shows a page outside that app's path.
  WizAppServices.attach(b, { appId: 'other', path: '/other/', isVisible: () => true, isFront: () => true });
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = body => { res.setHeader('content-type', 'text/html'); res.end(body); };
  if (u.pathname === '/') return html(SHELL);
  if (u.pathname === '/notes/') return html(APP('Notes'));
  if (u.pathname === '/evil/') return html(APP('Evil'));
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
  const page = await browser.newPage({ viewport: { width: 470, height: 150 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const frameOf = p => page.frames().find(fr => fr.url().endsWith(p));
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(f => WizBrowserBoundary.ready(f)), null, { timeout: 6000 }).catch(() => {});
  const origin = await frameOf('/notes/').evaluate(() => self.origin);
  ok(origin === 'null', 'the app page is opaque (origin ' + origin + ')');
  if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-before.png') });
  const out = await frameOf('/notes/').evaluate(() => run()).catch(e => ({ error: String(e) }));
  const log = () => page.evaluate(() => JSON.parse(JSON.stringify(shellLog)));
  let l = await log();
  ok(out.duck === true && JSON.stringify(l.ducks) === '[[0,true]]', 'the app lowers Wizard Music for its window: ' + JSON.stringify({ duck: out.duck, ducks: l.ducks }));
  ok(JSON.stringify(out.has) === '{"available":true,"saved":false}', 'vault.has: only the flags cross: ' + JSON.stringify(out.has));
  ok(JSON.stringify(out.seal) === '{"saved":true}', 'vault.seal keeps the secret: ' + JSON.stringify(out.seal));
  ok(out.open === 'fixture-secret', 'vault.open gives the app its own secret back: ' + JSON.stringify(out.open));
  ok(out.denied === 'error:cancelled', 'a cancelled fingerprint prompt reaches the app as code cancelled: ' + JSON.stringify(out.denied));
  ok(JSON.stringify(out.forget) === '{"saved":false}', 'vault.forget: ' + JSON.stringify(out.forget));
  ok(l.vault.length === 5 && l.vault.every(v => v[1] === 'notes'), 'every vault call went to the phone under the window\'s app id: ' + JSON.stringify(l.vault));
  if (SHOT) await page.screenshot({ path: SHOT });
  // The page outside its window's app path gets nothing, and the phone is never asked for it.
  const evil = await frameOf('/evil/').evaluate(() => run()).catch(e => ({ error: String(e) }));
  l = await log();
  ok(evil.duck === false && evil.open !== 'fixture-secret' && String(evil.open).startsWith('error:') && l.vault.length === 5 && l.ducks.length === 1,
    'a page outside its app\'s path can\'t duck or reach the vault: ' + JSON.stringify({ evil, vault: l.vault.length, ducks: l.ducks.length }));
  // The shell reloads the Notes window: the old document's duck ends with it.
  await page.evaluate(() => { document.querySelector('#w1 iframe').src = '/notes/?r=1'; });
  await page.waitForTimeout(800);
  l = await log();
  ok(JSON.stringify(l.ducks.at(-1)) === '[0,false]', 'a reload of the window restores the music: ' + JSON.stringify(l.ducks));
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
