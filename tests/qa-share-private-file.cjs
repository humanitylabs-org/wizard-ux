// Browser QA for wizard-ux issue 1621: Share on a chat file in the media viewer never hands Messenger (or anyone)
// the owner's private /wizard/attachments/… link as text. Real Chromium, the real chat-kit.js + share-sheet.js.
// Desktop browser: no native bridge and no navigator.share for files, so the file itself can't leave from here:
// it is saved to Downloads instead (wizard-os issue 747).
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-share-private-file.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOTS=<dir>: save a screenshot after Share.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const ID = '0123456789abcdef0123456789abcdef';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/core/chats.css"><link rel="stylesheet" href="/core/share-sheet.css">
<style>body{margin:0;background:#111;color:#eee;font:15px system-ui}#toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:99999;background:#333;color:#fff;padding:10px 16px;border-radius:10px}#toast:empty{display:none}</style>
</head><body><div id="toast"></div>
<script>window.WizCore = { apps: () => ({ APP: { messenger: { id: 'messenger', name: 'Messenger', kind: 'wizard' } } }) };
window.__opened = []; window.WizOpenApp = id => { window.__opened.push(id); return true; };</script>
<script src="/core/chat-kit.js"></script><script src="/core/share-sheet.js"></script>
<script>WosChat.K.notify = (icon, text) => { document.getElementById('toast').textContent = icon + ' ' + text; };</script>
</body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  if (u.pathname === `/wizard/attachments/${ID}`) { res.writeHead(200, { 'content-type': 'text/markdown' }); return res.end('# Trip notes\n\nPack the charger.\n'); }
  const file = path.join(WEB, u.pathname);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/javascript' }); fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const fails = [], ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
  await page.goto(base); await page.waitForFunction(() => !!window.WosChat?.viewer && !!window.WosShareSheet);
  await page.evaluate(id => WosChat.viewer.open([{ url: `/wizard/attachments/${id}`, kind: 'file', name: 'trip-notes.md', mime: 'text/markdown', bytes: 40 }], 0), ID);
  await page.waitForSelector('[data-mv="share"]', { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.click('[data-mv="share"]');
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => ({
    sheet: !!document.querySelector('.wos-share'),
    messenger: !!document.querySelector('.wos-share [data-shs-app="messenger"]'),
    preview: document.querySelector('.wos-share .shs-prev')?.textContent || '',
    toast: document.getElementById('toast').textContent,
  }));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'share.png') });
  ok(!/\/wizard\/attachments\//.test(seen.preview), `no sheet offers the private link as text (preview=${JSON.stringify(seen.preview)})`);
  ok(!seen.messenger, 'Messenger is not offered the link');
  ok(/saved to Downloads instead/.test(seen.toast), `the file is saved instead and the owner is told so (wizard-os issue 747) (${JSON.stringify(seen.toast)})`);
  // Even if a tap got through to Messenger, nothing would carry the link: deliver a tap on whatever sheet is open.
  if (seen.messenger) { await page.click('.wos-share [data-shs-app="messenger"]'); await page.waitForTimeout(300); }
  const opened = await page.evaluate(() => window.__opened.slice());
  ok(!opened.some(id => id === 'messenger'), `Messenger is never opened with the link pending (${JSON.stringify(opened)})`);
  await browser.close(); server.close();
  const broken = process.env.QA_EXPECT === 'broken';
  if (broken) { console.log(fails.length ? `expected failures on this build: ${fails.length}` : 'UNEXPECTED: all checks passed'); process.exit(fails.length ? 0 : 1); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
