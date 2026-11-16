// Browser QA for the browser owner boundary, slice 16 (wizard-os#133): a sandboxed app sets its own badge and window
// title bar. Real Chromium: a shell page with the boundary on (WizShellBoundary set the way shell-token.js does), the
// real core/browser-boundary.js and core/app-services.js, and an app page in a sandboxed frame that loads the real
// core/app-client.js and calls WizardApp.badge.set / WizardApp.titlebar.set. A real click on the tool reaches the app;
// a reload clears the bar and the app's last bar comes back; a second sandboxed page that is not the installed app
// gets nothing.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-services.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><p>Notes</p><script>
  window.taps = []; window.results = {};
  (async () => {
    await WizardApp.ready?.();
    results.badge = await WizardApp.badge.set(3);
    results.bar = await WizardApp.titlebar.set([{ id: 'older', kind: 'button', icon: 'prev', label: 'Older' },
      { id: 'when', kind: 'select', label: 'Date', value: 'a', options: [{ value: 'a', label: 'Today' }, { value: 'b', label: 'Yesterday' }] }],
      t => taps.push(t.id + (t.value ? ':' + t.value : '')));
  })();
</script></body></html>`;
// Not the installed app: same tricks, other path.
const EVIL = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><script>window.results = {}; (async () => { await WizardApp.ready?.(); results.badge = await WizardApp.badge.set(99);
  results.bar = await WizardApp.titlebar.set([{ id: 'pwn', kind: 'button', text: 'X', label: 'X' }]); })();</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>window.counts = {};
  const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount: (k, n) => { counts[k] = n; } } };
  window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>.wbar{display:flex;gap:8px;height:32px;align-items:center;background:#223;color:#fff;padding:0 8px}.wtool{min-width:28px;height:24px}iframe{width:400px;height:120px;border:0}</style></head>
<body><div class="win" id="w1"><header class="wbar"><span>Notes</span><button class="wb">x</button></header>
<iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<div class="win" id="w2"><header class="wbar"><span>Other</span><button class="wb">x</button></header>
<iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/evil/"></iframe></div>
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
  if (u.pathname === '/notes/') return html(APP);
  if (u.pathname === '/evil/') return html(EVIL);
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
  const page = await browser.newPage({ viewport: { width: 460, height: 360 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const frameOf = p => page.frames().find(fr => fr.url().endsWith(p));
  const bar = () => page.evaluate(() => [...document.querySelectorAll('#w1 .wtools [data-tool]')].map(e => e.dataset.tool));
  await page.waitForFunction(() => document.querySelectorAll('#w1 .wtools [data-tool]').length === 2, null, { timeout: 6000 }).catch(() => {});
  const origin = await frameOf('/notes/').evaluate(() => self.origin);
  ok(origin === 'null', 'the app page is opaque (origin ' + origin + ')');
  ok(JSON.stringify(await bar()) === '["older","when"]', 'the app\'s tools are in its own window bar: ' + JSON.stringify(await bar()));
  const counts = await page.evaluate(() => counts);
  ok(counts.notes === 3, 'the app\'s badge is set for its own app id: ' + JSON.stringify(counts));
  const results = await frameOf('/notes/').evaluate(() => results);
  ok(results.badge === true && results.bar === true, 'the app is told both were set: ' + JSON.stringify(results));
  if (SHOT) await page.screenshot({ path: SHOT });
  await page.click('#w1 .wtools button[data-tool="older"]', { timeout: 2000 }).catch(() => {});
  await page.selectOption('#w1 .wtools select[data-tool="when"]', 'b', { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(200);
  const taps = await frameOf('/notes/').evaluate(() => taps);
  ok(JSON.stringify(taps) === '["older","when:b"]', 'real taps on the shell\'s bar reach the app: ' + JSON.stringify(taps));
  // Reload: the bar is cleared with the old document, then the new document sets it again.
  // A shell-side observer records every repaint of the bar, so a clear followed at once by the new set is seen.
  await page.evaluate(() => { window.barLog = []; new MutationObserver(() => barLog.push(document.querySelectorAll('#w1 .wtools [data-tool]').length))
    .observe(document.querySelector('#w1 .wbar'), { childList: true, subtree: true }); document.querySelector('#w1 iframe').src = '/notes/?r=1'; });
  await page.waitForFunction(() => barLog.includes(0) && barLog.at(-1) === 2, null, { timeout: 6000 }).catch(() => {});
  const barLog = await page.evaluate(() => barLog);
  ok(barLog.includes(0), 'a reload clears the old document\'s tools: ' + JSON.stringify(barLog));
  ok(barLog.at(-1) === 2 && (await bar()).length === 2, 'the new document\'s tools come back');
  // The app page navigates its own frame to another page (src still says /notes/): that document gets nothing.
  await page.frames().find(fr => fr.url().includes('/notes/')).evaluate(() => { location.href = '/evil/?nav=1'; });
  let nav = null;
  for (let i = 0; i < 40 && !(nav && 'bar' in nav); i++) { await page.waitForTimeout(100); const fr = frameOf('/evil/?nav=1'); nav = fr ? await fr.evaluate(() => results).catch(() => null) : null; }
  const counts3 = await page.evaluate(() => counts), navBar = await bar();
  ok(nav && nav.badge === false && nav.bar === false && counts3.notes === 3 && navBar.length === 0, 'a page the app navigated to by itself sets nothing in its window: ' + JSON.stringify({ nav, counts3, navBar }));
  // The second window's page is not the installed app it claims to be.
  const evil = await frameOf('/evil/').evaluate(() => results);
  const counts2 = await page.evaluate(() => counts);
  const evilBar = await page.evaluate(() => document.querySelectorAll('#w2 .wtools [data-tool]').length);
  ok(evil.badge === false && evil.bar === false && !('other' in counts2) && evilBar === 0, 'a page outside its app\'s path sets nothing: ' + JSON.stringify({ evil, counts2, evilBar }));
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
