// Browser QA for desktop keys and clicks from a sandboxed app (wizard-os#133, browser owner boundary).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js, and an app page in a sandboxed
// frame that loads the real core/app-client.js. Real clicks and key presses in the app must reach the shell (click to
// focus, Esc, the shell's named ⌥ keys) while plain typing and every other ⌥ key stay the app's alone, the shell's ⌥
// keys never type into the app's field, and a page that only posts messages (no real input, so no user activation)
// cannot press the shell's keys. The named keys are the desktop's real list (desktop.js), read from its source.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-keys.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = path.join(__dirname, '..', 'web');
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><input id="f" value=""><script>
  window.appKeys = []; addEventListener('keydown', e => appKeys.push((e.altKey ? 'alt+' : '') + e.code));
  // A hostile page: it learns the channel from the shell's hello and forges a named key (⌥1, a desk switch) and a click.
  let channel = ''; addEventListener('message', e => { if (e.data?.op === 'hello') channel = e.data.channel; });
  window.forge = () => parent.postMessage({ type: 'wizard:boundary', version: 1, channel, op: 'input', kind: 'key', event: 'keydown', key: '¡', code: 'Digit1', altKey: true }, location.origin);
  window.forgeClick = () => parent.postMessage({ type: 'wizard:boundary', version: 1, channel, op: 'input', kind: 'pointer' }, location.origin);
  if (location.search === '?hostile') setTimeout(() => { forge(); forgeClick(); }, 600);
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script></head>
<body><button id="other">other</button><div class="win" data-win="w1"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/" style="width:400px;height:200px"></iframe></div>
<script>const f = document.querySelector('iframe'); window.got = [];
  WizBrowserBoundary.keys(__KEYS__);
  WizBrowserBoundary.onInput((fr, ev) => got.push(fr === f ? (ev.kind === 'key' ? ev.type + ':' + (ev.altKey ? 'alt+' : '') + ev.code + (ev.field ? ':field' : '') : ev.kind) : 'wrong-frame'));
  WizBrowserBoundary.attach(f);
  // Hostile run: the frame gets focus from script (no user input), and the shell notes its activation when the app posts.
  if (location.search === '?hostile') { f.addEventListener('load', () => f.focus()); addEventListener('message', () => { window.activationAtForge = navigator.userActivation.isActive; }); }
</script></body></html>`;
// The desktop's real list of keys it takes from a sandboxed app.
const KEYS = /WizBrowserBoundary\.keys\((\[[^\]]*\])\)/.exec(fs.readFileSync(path.join(WEB, 'desktop', 'desktop.js'), 'utf8'))[1];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { const shell = SHELL.replace('__KEYS__', KEYS); res.setHeader('content-type', 'text/html'); return res.end(u.search === '?hostile' ? shell.replace('src="/notes/"', 'src="/notes/?hostile"') : shell); }
  if (u.pathname === '/notes/') { res.setHeader('content-type', 'text/html'); return res.end(APP); }
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = 404; res.end('');
});
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const result = {}, fails = [];
  // 1. A hostile page with focus but no real input: forged ⌥V and clicks are dropped.
  {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    // No page.evaluate before the forgery: Playwright runs evaluate as a user gesture, which would activate the page.
    await page.goto(base + '/?hostile'); await wait(1500);
    result.forgedActivation = await page.evaluate(() => window.activationAtForge);
    result.focusedFrame = await page.evaluate(() => document.activeElement?.tagName);
    result.forged = await page.evaluate(() => window.got.slice());
    if (result.forgedActivation !== false) fails.push('the test page already had user activation');
    if (result.focusedFrame !== 'IFRAME') fails.push('the hostile frame did not have focus');
    if (result.forged.length) fails.push('forged input without user activation reached the shell');
    if (errors.length) fails.push('page errors (forged): ' + errors);
    await page.close();
  }
  // 2. Real input.
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/');
  const app = () => page.frames().find(fr => fr.url().endsWith('/notes/'));
  await page.waitForFunction(() => !!document.querySelector('iframe').contentWindow, null, { timeout: 5000 }); await wait(400);
  await app().click('#f'); await wait(150);
  await page.keyboard.type('ab');
  await page.keyboard.press('Alt+Digit1');
  await page.keyboard.press('Alt+KeyN');
  await page.keyboard.press('Alt+KeyV');
  await page.keyboard.press('Alt+KeyE');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.keyboard.press('Escape');
  await wait(300);
  result.got = await page.evaluate(() => window.got.slice());
  result.appKeys = await app().evaluate(() => window.appKeys.slice());
  result.field = await app().evaluate(() => document.getElementById('f').value);
  // Focus leaves the app: the shell hears it lost focus (the keys guide hides).
  await page.click('#other'); await wait(200);
  result.after = await page.evaluate(() => window.got.slice(-1));
  result.errors = errors;
  console.log(JSON.stringify(result, null, 1));
  // ⌥1 and Esc are the shell's; ⌥N, ⌥V, ⌥E and ⌥← stay the app's (only the bare ⌥ around them is posted, for the guide).
  const alt = ['keydown:alt+AltLeft:field', 'keyup:AltLeft'];
  const want = ['pointer', 'keydown:alt+AltLeft:field', 'keydown:alt+Digit1:field', 'keyup:AltLeft', ...alt, ...alt, ...alt, ...alt, 'keydown:Escape:field'];
  if (result.got.join() !== want.join()) fails.push('shell input: ' + result.got.join());
  if (result.got.some(x => /Key[AB]\b/.test(x))) fails.push('plain typing left the app');
  if (result.appKeys.includes('alt+Digit1') || result.appKeys.includes('Escape')) fails.push('the app page saw a shell key');
  if (!['alt+KeyN', 'alt+KeyV', 'alt+KeyE', 'alt+ArrowLeft'].every(k => result.appKeys.includes(k))) fails.push('the app lost its own ⌥ keys');
  if (result.field !== 'ab') fails.push('field value: ' + result.field);
  if (result.after[0] !== 'blur') fails.push('blur not heard');
  if (errors.length) fails.push('page errors');
  await browser.close(); server.close();
  if (fails.length) { console.error('FAIL', fails); process.exit(1); }
  console.log('PASS: clicks, Esc and ⌥ keys from a sandboxed app reach the shell; typing stays in the app; forged input is refused');
})().catch(e => { console.error(e); process.exit(1); });
