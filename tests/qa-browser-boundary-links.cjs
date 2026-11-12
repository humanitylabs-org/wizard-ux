// Browser QA for the browser owner boundary, slice 43 (wizard-os#133): links and pop-ups in a sandboxed app window.
// The sandbox has no allow-popups or allow-top-navigation and the shell can no longer patch the page's links
// (core/links.js guardFrame), so a tapped link that leaves the window goes to the shell (`link.open`) and opens the
// way it does for a same-origin app. Real Chromium: a shell page with the boundary on (WizShellBoundary set the way
// shell-token.js does), the real core/browser-boundary.js, core/app-services.js and core/links.js (the shell's own
// sheet), and app pages in sandboxed frames that load the real core/app-client.js. The owner's browser (window.open
// in the shell), the shell's route (an app window / link desk) and the image viewer are recorded stand-ins.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-links.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOTS=<dir>: also save a screenshot of the shell after the taps.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{font:13px system-ui;margin:6px} a,button{display:inline-block;margin:3px 6px 3px 0}</style></head>
<body><b>Notes</b><br>
<a id="ext" href="https://example.com/article" target="_blank">Other site, new tab</a>
<a id="extself" href="https://example.net/page">Other site</a>
<a id="other" href="/other/page?x=1">Another app</a>
<a id="own" href="b.html" target="_blank">Own page, new tab</a>
<a id="img" href="/notes/pic.png">Photo</a>
<a id="browse" href="https://example.org/doc" data-wizard-browse>In my browser</a>
<a id="anchor" href="#later">Anchor</a>
<a id="inapp" href="b.html">Own page</a>
<button id="pop">window.open</button>
<p id="later">later</p>
<script>
  window.results = {};
  (async () => {
    await WizardApp.ready?.();
    // No tap: a page alone opens nothing.
    results.untapped = window.open('https://example.com/sneaky', '_blank');
    results.ready = true;
  })();
  document.getElementById('pop').onclick = () => { results.pop = window.open('https://example.com/popup', '_blank', 'noopener'); };
  window.later = () => setTimeout(() => { window.open('https://example.com/later', '_blank'); results.later = true; }, 300);
</script></body></html>`;
const B_PAGE = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><b>Notes page b</b><script>window.results = { ready: true, page: 'b' };</script></body></html>`;
// Not the installed app it claims to be (outside that app's path): the same link, with a real tap.
const EVIL = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><a id="ext" href="https://example.com/evil" target="_blank">Evil link</a><script>window.results = {};
  (async () => { await WizardApp.ready?.(); results.ready = true; })();</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>window.opened = []; window.routed = []; window.viewed = [];
  const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } };
  // The owner's browser: what the shell opens in a new tab.
  window.open = (href) => { opened.push(String(href)); return null; };
  // The shell's media viewer.
  window.WosChat = { viewer: { open: (items, i) => { viewed.push({ items: items.map(x => x.url), i }); return true; }, isOpen: () => false, close() {} } };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<script src="/wizard-os-home/core/links.js"></script>
<style>body{font:13px system-ui;margin:8px;background:#120c24;color:#eee} iframe{width:640px;height:110px;border:1px solid #554;background:#fff}
 #log{white-space:pre-wrap;font:12px ui-monospace,monospace;margin-top:6px} .linksheet{display:none}</style></head>
<body><button id="shellbtn">Shell button</button><div class="win" id="w1"><header class="wbar"><span>Notes</span></header>
<iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<div class="win" id="w2"><header class="wbar"><span>Other</span></header>
<iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/evil/" style="height:40px"></iframe></div>
<div id="log"></div>
<script>
  const [a, b] = document.querySelectorAll('iframe');
  WizAppServices.attach(a, { appId: 'notes', path: '/notes/', isVisible: () => true });
  WizAppServices.attach(b, { appId: 'other', path: '/other/', isVisible: () => true });
  // The shell's own sheet, with its route: a page of this Wizard opens as an app window / link desk.
  window.LINKS = window.WizLinks.mount({ readerApp: () => null, parent: document.body, mode: 'pane' });
  LINKS.route = (href, from) => { routed.push({ href, from: from === a ? 'notes' : from === b ? 'other' : String(from) }); return true; };
  setInterval(() => { document.getElementById('log').textContent = 'Opened in the owner\\'s browser: ' + JSON.stringify(opened) + '\\nOpened as a Wizard window: ' + JSON.stringify(routed.map(r => r.href)) + '\\nPhoto viewer: ' + JSON.stringify(viewed.map(v => v.items[v.i])); }, 100);
</script></body></html>`;
const hits = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  hits.push(u.pathname);
  const html = body => { res.setHeader('content-type', 'text/html'); res.end(body); };
  if (u.pathname === '/') return html(SHELL);
  if (u.pathname === '/notes/') return html(APP);
  if (u.pathname === '/notes/b.html') return html(B_PAGE);
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
  const page = await browser.newPage({ viewport: { width: 680, height: 300 } });
  // Nothing may leave the test server.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<b>outside</b>' }));
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const frameOf = p => page.frames().find(fr => new URL(fr.url()).pathname === p);
  const until = async (p, fn, ms = 6000) => { for (let t = 0; t < ms; t += 100) { const f = frameOf(p); const r = f ? await f.evaluate(fn).catch(() => null) : null; if (r) return r; await page.waitForTimeout(100); } return null; };
  const shell = () => page.evaluate(() => ({ opened: [...opened], routed: [...routed], viewed: [...viewed] }));
  const settle = () => page.waitForTimeout(400);
  await until('/notes/', () => results.ready);
  await until('/evil/', () => results.ready);
  ok(await frameOf('/notes/').evaluate(() => self.origin) === 'null', 'the app page is opaque');
  await settle();
  ok((await shell()).opened.length === 0, 'without a tap the page opens nothing: ' + JSON.stringify(await shell()));
  // A build without the fix lets a link carry the app window away; put the app back so the next check still runs.
  const ensure = async () => { if (frameOf('/notes/')) return; await page.evaluate(() => { document.querySelector('iframe').src = '/notes/?again=' + Date.now(); }); await until('/notes/', () => results.ready); };
  const tap = async (sel) => { await ensure(); await frameOf('/notes/').click(sel); await settle(); };
  await tap('#ext');
  let s = await shell();
  ok(s.opened.some(x => x === 'https://example.com/article'), 'a link to another site in a new tab opens in the owner\'s browser: ' + JSON.stringify(s.opened));
  await tap('#extself');
  s = await shell();
  ok(s.opened.some(x => x === 'https://example.net/page') && frameOf('/notes/'), 'a link to another site opens in the owner\'s browser and the app stays in its window: ' + JSON.stringify(s.opened));
  await tap('#other');
  s = await shell();
  ok(s.routed.some(r => r.href === base + '/other/page?x=1' && r.from === 'notes') && frameOf('/notes/'), 'a link to another app opens as that app\'s window, not inside this one: ' + JSON.stringify(s.routed));
  await tap('#own');
  s = await shell();
  ok(s.routed.some(r => r.href === base + '/notes/b.html'), 'an own page in a new tab opens as a Wizard window: ' + JSON.stringify(s.routed));
  await tap('#img');
  s = await shell();
  ok(s.viewed.length === 1 && s.viewed[0].items[s.viewed[0].i] === '/notes/pic.png', 'a photo of this Wizard opens in the viewer: ' + JSON.stringify(s.viewed));
  await tap('#browse');
  s = await shell();
  ok(s.opened.some(x => x === 'https://example.org/doc'), 'a link marked for the browser opens there: ' + JSON.stringify(s.opened));
  await tap('#pop');
  s = await shell();
  const popRet = await frameOf('/notes/').evaluate(() => results.pop);
  ok(s.opened.some(x => x === 'https://example.com/popup') && popRet === null, 'window.open after a tap opens in the owner\'s browser: ' + JSON.stringify(s.opened));
  ok(!s.opened.some(x => x === 'https://example.com/sneaky'), 'window.open without a tap stayed closed');
  // A tap elsewhere in the shell activates the shell too; the app opening a pop-up right then gets nothing.
  await ensure(); await frameOf('/notes/').evaluate(() => later());
  await page.click('#shellbtn');
  await until('/notes/', () => results.later);
  await settle();
  s = await shell();
  ok(!s.opened.some(x => x === 'https://example.com/later'), 'a tap outside the app window does not let it open a pop-up: ' + JSON.stringify(s.opened));
  // In-page anchors and the app's own pages stay the page's.
  await tap('#anchor');
  ok(await frameOf('/notes/').evaluate(() => location.hash) === '#later', 'an in-page anchor stays the page\'s');
  await page.screenshot({ path: process.env.QA_SHOTS ? path.join(process.env.QA_SHOTS, 'links.png') : path.join(require('os').tmpdir(), 'qa-links.png') });
  // The page that is not its window's installed app gets nothing, even with a real tap.
  const before = (await shell()).opened.length;
  await frameOf('/evil/').click('#ext'); await settle();
  ok((await shell()).opened.length === before, 'a page outside its app\'s path can\'t open links through the shell');
  await ensure(); await frameOf('/notes/').click('#inapp');
  ok(!!(await until('/notes/b.html', () => results.page === 'b')), 'a link to the app\'s own page still opens in its window');
  ok(!hits.some(h => h === '/other/page'), 'the other app\'s page never loaded into the app window: ' + JSON.stringify(hits.filter(h => !h.startsWith('/wizard-os-home/'))));
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
