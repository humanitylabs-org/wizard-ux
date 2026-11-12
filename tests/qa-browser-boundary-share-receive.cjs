// Browser QA for the browser owner boundary, slice 20 (wizard-os#133): a sandboxed app receives shares again.
// Real Chromium: a shell page with the boundary on (WizShellBoundary set the way shell-token.js does), the real
// core/browser-boundary.js, core/app-services.js and core/share-sheet.js, and an app page in a sandboxed frame that
// loads the real core/app-client.js and registers with WizardApp.share.receive.
//  - The app's registration reaches the shell: the share sheet offers the app (and its person) under Apps / People.
//  - A tap on the app in the shell's share sheet hands it the text (and a picture as a file); the app places it and
//    the item is acked (no longer pending).
//  - 40 shares waiting for an app that registers later all arrive (the boundary hands them over in batches of 32).
//  - A second sandboxed page that is not the installed app it claims to be can't register or take anything.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-share-receive.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
const page_ = (who, appId) => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body style="font:14px sans-serif;margin:8px"><b>${who}</b><div id="box" style="border:1px solid #999;min-height:40px;padding:4px;margin-top:4px">(composer)</div><script>
  window.got = [];
  // ?late: the app registers only when the test says so (shares wait for it meanwhile).
  window.go = () => WizardApp.share.receive({ accepts: ['text', 'url', 'image'], targets: [{ id: '${appId}-ann', name: 'Ann (${who})' }], receive: async it => {
    const file = it.file ? { name: it.name, mime: it.mime, size: it.size, bytes: (await it.file.arrayBuffer()).byteLength } : null;
    got.push({ id: it.id, kind: it.kind, text: it.text || '', target: it.target, file, keys: Object.keys(it).sort() });
    document.getElementById('box').textContent = (it.text || '') + (file ? ' [' + file.name + ']' : '');
    return true;
  } });
  if (!location.search.includes('late')) go();
  WizardApp.ready?.();
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>
  const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  const APP = Object.fromEntries(APPS.map(a => [a.id, a]));
  window.WizCore = { apps: () => ({ APPS, APP }), workspaceNav: { setCount() {} } };
  window.WizConfig = { stripAddress: s => s };
  window.opened = []; window.WizOpenApp = id => { opened.push(id); return true; };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<script src="/wizard-os-home/core/share-sheet.js"></script>
<style>iframe{width:420px;height:90px;border:1px solid #888} .wos-share{position:fixed;right:8px;top:8px;background:#eee;padding:6px;border:1px solid #444;font:12px sans-serif} .wos-share button{display:block;margin:2px 0}</style></head>
<body><div class="win" id="w1"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<div class="win" id="w2"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/evil/"></iframe></div>
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
  if (u.pathname === '/notes/') return html(page_('Notes', 'notes'));
  if (u.pathname === '/evil/') return html(page_('Evil', 'other'));
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
  const page = await browser.newPage({ viewport: { width: 640, height: 260 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const frameOf = p => page.frames().find(fr => fr.url().endsWith(p));
  const got = p => frameOf(p).evaluate(() => got).catch(() => null);
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(f => WizBrowserBoundary.ready(f)), null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  const origin = await frameOf('/notes/').evaluate(() => self.origin);
  ok(origin === 'null', 'the app page is opaque (origin ' + origin + ')');
  const state = await page.evaluate(() => WosShareSheet._state().receivers);
  ok(JSON.stringify(state.notes?.accepts) === '["text","url","image"]', 'the sandboxed app registered as a share receiver: ' + JSON.stringify(state.notes || null));
  ok(!state.other, 'the page outside its app\'s path could not register: ' + JSON.stringify(state.other || null));
  // The shell's share sheet, as WosChat.sharePayload opens it.
  const shown = page.evaluate(() => { window.outcome = WosShareSheet.show({ text: 'Lunch at noon?' }, () => 'native'); return window.outcome; });
  await page.waitForSelector('.wos-share [data-shs-app="notes"]', { timeout: 3000 }).catch(() => {});
  ok(await page.locator('.wos-share .shs-app[data-shs-app="notes"]').count() === 1, 'the share sheet offers the sandboxed app under Apps');
  ok(await page.locator('.wos-share .shs-person[data-shs-target="notes-ann"]').count() === 1, 'and its person under People');
  if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-sheet.png') });
  await page.locator('.wos-share .shs-person[data-shs-target="notes-ann"]').click().catch(() => {});
  const outcome = await Promise.race([shown, new Promise(r => setTimeout(() => r('no answer'), 2000))]);
  await page.waitForTimeout(600);
  let g = await got('/notes/');
  ok(outcome === 'shared' && g?.length === 1 && g[0].text === 'Lunch at noon?' && g[0].target === 'notes-ann', 'a tap on the app\'s person hands the app the text for that person: ' + outcome + ' ' + JSON.stringify(g));
  ok(g?.[0] && JSON.stringify(g[0].keys) === '["id","kind","target","text"]', 'only the item\'s share fields cross: ' + JSON.stringify(g?.[0]?.keys));
  ok((await page.evaluate(() => WosShareSheet._state().pending.length)) === 0, 'the app placed it, so it is no longer pending');
  if (SHOT) await page.screenshot({ path: SHOT });
  // A picture: it reaches the app as a file it can read.
  const shown2 = page.evaluate(() => WosShareSheet.show({ file: new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'pic.png', { type: 'image/png' }) }, () => 'native'));
  await page.waitForSelector('.wos-share .shs-app[data-shs-app="notes"]', { timeout: 3000 }).catch(() => {});
  await page.locator('.wos-share .shs-app[data-shs-app="notes"]').click().catch(() => {});
  const outcome2 = await Promise.race([shown2, new Promise(r => setTimeout(() => r('no answer'), 2000))]);
  await page.waitForTimeout(600);
  g = await got('/notes/');
  ok(outcome2 === 'shared' && g?.length === 2 && g[1].kind === 'image' && g[1].file?.name === 'pic.png' && g[1].file.bytes === 7, 'a shared picture reaches the app as a file: ' + JSON.stringify(g?.[1]));
  // 40 shares wait while the app's window loads and has not registered yet; once it does, all of them arrive.
  await page.evaluate(() => { document.querySelector('#w1 iframe').src = '/notes/?late=1'; });
  await page.waitForFunction(() => WizBrowserBoundary.ready(document.querySelector('#w1 iframe')), null, { timeout: 6000 }).catch(() => {});
  for (let i = 0; i < 40; i++) {
    const s = page.evaluate(n => WosShareSheet.show({ text: 'batch ' + n }, () => 'native'), i);
    await page.locator('.wos-share.on .shs-app[data-shs-app="notes"]').click({ timeout: 2000 }).catch(() => {});
    await Promise.race([s, new Promise(r => setTimeout(r, 1000))]);
  }
  const waiting = await page.evaluate(() => WosShareSheet._state().pending.length);
  await page.waitForTimeout(600); // every "a share is waiting" notice has reached the not-yet-registered app
  await frameOf('/notes/?late=1').evaluate(() => go());
  await page.waitForTimeout(1500);
  const late = await got('/notes/?late=1');
  ok(waiting === 40 && late?.length === 40 && new Set(late.map(x => x.text)).size === 40, '40 waiting shares all arrive once the app registers: ' + waiting + ' waiting, ' + late?.length + ' arrived');
  ok((await page.evaluate(() => WosShareSheet._state().pending.length)) === 0, 'and none is left pending');
  // The page outside its window's app path took nothing.
  const evil = await got('/evil/');
  ok(Array.isArray(evil) && evil.length === 0, 'a page outside its app\'s path receives nothing: ' + JSON.stringify(evil));
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
