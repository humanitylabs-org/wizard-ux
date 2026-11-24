// Browser QA for wizard-os issue 747: Save and Share in the full-screen media viewer did nothing.
// Real Chromium, the real chat-kit.js + share-sheet.js and the desktop toast, a chat photo served the way Messenger
// serves one (private + immutable cache, Content-Disposition with the original file name).
//  1. "slow": the picture is on screen, but asking the box for the whole file again never answers (the box re-reads
//     the original from the chat network). Save must still save at once, under the photo's own file name.
//  2. "refused": the box answers the picture (not kept in the cache) but refuses a script's read of it. Save must still
//     save the file (the browser downloads the address itself), never leave the owner with nothing.
//  3. Share on a desktop browser that cannot hand a file to another app: the photo is saved instead, and both the
//     button and the notice say so (a chat photo's link would be a dead link for anyone else).
//  The Save button also says what it is doing while it works.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-viewer-save-share.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOTS=<dir>: screenshots (save-<case>.png, share.png).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
// A real 64x40 PNG (solid colour), so the viewer can draw it.
const zlib = require('zlib');
function png(w, h, rgb) {
  const crc = buf => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const b of buf) x = t[(x ^ b) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)))]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
const PHOTO = png(64, 40, [40, 157, 143]);
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/wizard-os-home/desktop/desktop.css"><link rel="stylesheet" href="/wizard-os-home/core/chats.css"><link rel="stylesheet" href="/wizard-os-home/core/share-sheet.css">
</head><body style="margin:0;background:#111;color:#eee;font:15px system-ui"><div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>window.WizCore = { apps: () => ({ APP: {} }) }; window.__toasts = [];
window.WizAppServices = { claimShare: () => true };</script>
<script src="/wizard-os-home/core/chat-kit.js"></script><script src="/wizard-os-home/core/share-sheet.js"></script>
<script>let tt; WosChat.K.notify = (icon, text) => { window.__toasts.push(text); const t = document.getElementById('toast'); t.innerHTML = '<span>' + icon + '</span><span>' + text + '</span>'; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 4000); };</script>
</body></html>`;
const hits = [];
function serve() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/wizard-os-home/desktop.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    const m = /^\/messenger\/api\/unified\/media\/(slow|refused|share)$/.exec(u.pathname);
    if (m) {
      // A script's read (fetch) comes with mode `cors`; a picture is `no-cors`, a browser download `navigate`.
      const dest = req.headers['sec-fetch-mode'] === 'cors' ? 'read' : req.headers['sec-fetch-dest'] || '';
      hits.push(m[1] + ':' + dest);
      const send = () => {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': PHOTO.length, 'cache-control': m[1] === 'refused' ? 'no-store' : 'private, max-age=86400, immutable', 'content-disposition': 'inline; filename="IMG-20261120-WA0003.png"', 'x-content-type-options': 'nosniff' });
        res.end(PHOTO);
      };
      // A picture and a browser download always answer.
      if (dest === 'read' && m[1] === 'slow') return; // the whole file again from the box: never answers
      if (dest === 'read' && m[1] === 'refused') { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"refused"}'); }
      return send();
    }
    const file = path.join(WEB, u.pathname.replace(/^\/wizard-os-home\//, '/'));
    if (!file.startsWith(WEB) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/javascript' }); fs.createReadStream(file).pipe(res);
  });
}
const fails = [], ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
(async () => {
  const browser = await chromium.launch();
  const server = serve(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    for (const kind of ['slow', 'refused']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
      const page = await context.newPage();
      const downloads = [], finished = []; page.on('download', d => { downloads.push(d.suggestedFilename()); d.failure().then(f => finished.push(f ? 'failed: ' + f : 'complete')); });
      await page.goto(base + 'wizard-os-home/desktop.html'); await page.waitForFunction(() => !!window.WosChat?.viewer);
      await page.evaluate(k => WosChat.viewer.open([{ url: `/messenger/api/unified/media/${k}`, kind: 'image', name: 'Miguel', mime: 'image/jpeg' }], 0), kind);
      await page.waitForFunction(() => document.querySelector('.mviewer .mv-stage img')?.naturalWidth > 0, null, { timeout: 5000 });
      await page.click('.mviewer [data-mv="save"]');
      const during = await page.evaluate(() => document.querySelector('.mviewer [data-mv="save"]').textContent);
      await page.waitForTimeout(2500);
      const after = await page.evaluate(() => ({ toasts: window.__toasts.slice(), label: document.querySelector('.mviewer [data-mv="save"]').textContent }));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `save-${kind}.png`) });
      if (kind === 'slow') {
        ok(downloads.length === 1, `slow box: Save saves the photo at once (downloads ${JSON.stringify(downloads)}, toasts ${JSON.stringify(after.toasts)})`);
        ok(downloads[0] === 'IMG-20261120-WA0003.png', `slow box: the file keeps the photo's own name (${JSON.stringify(downloads[0])})`);
        ok(/Saving/.test(during) || after.toasts.length > 0, `the tap shows at once that it is working (button said ${JSON.stringify(during)})`);
      } else {
        ok(downloads.length === 1 && finished[0] === 'complete', `refused read: Save still saves the file through the browser's downloads (downloads ${JSON.stringify(downloads)} ${JSON.stringify(finished)}, toasts ${JSON.stringify(after.toasts)})`);
        ok(after.toasts.some(t => /Saving to Downloads|Saved/.test(t)), `refused read: the owner is told it is saving (${JSON.stringify(after.toasts)})`);
      }
      await context.close();
    }
    // Share on a desktop browser that cannot share files.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const page = await context.newPage();
    const downloads = []; page.on('download', d => downloads.push(d.suggestedFilename()));
    await page.goto(base + 'wizard-os-home/desktop.html'); await page.waitForFunction(() => !!window.WosChat?.viewer);
    await page.evaluate(() => WosChat.viewer.open([{ url: '/messenger/api/unified/media/share', kind: 'image', name: 'Miguel', mime: 'image/jpeg' }], 0));
    await page.waitForFunction(() => document.querySelector('.mviewer .mv-stage img')?.naturalWidth > 0, null, { timeout: 5000 });
    await page.click('.mviewer [data-mv="share"]'); await page.waitForTimeout(400);
    const label = await page.evaluate(() => document.querySelector('.mviewer [data-mv="share"]').textContent);
    await page.waitForTimeout(1500);
    const st = await page.evaluate(async () => ({ toasts: window.__toasts.slice(), clip: await navigator.clipboard?.readText?.().catch(() => '') || '' }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'share.png') });
    ok(downloads.length === 1 && downloads[0] === 'IMG-20261120-WA0003.png', `Share without file sharing saves the photo instead (downloads ${JSON.stringify(downloads)})`);
    ok(st.toasts.some(t => /saved to Downloads instead/.test(t)), `Share says what happened (${JSON.stringify(st.toasts)}; button ${JSON.stringify(label)})`);
    ok(!st.toasts.some(t => /Link copied/.test(t)), 'Share never copies the private photo link instead');
    // An app's own picture handed over as bytes (a shell blob: address), and a refused read: Share saves them too,
    // reading the bytes once (no second wait for a read that already failed).
    downloads.length = 0; await page.evaluate(() => { window.__toasts.length = 0; });
    await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 30; c.height = 20; c.getContext('2d').fillRect(0, 0, 30, 20); const b = await new Promise(r => c.toBlob(r, 'image/png')); WosChat.viewer.open([{ url: URL.createObjectURL(b), kind: 'image', name: 'Made here', mime: 'image/png' }], 0); });
    await page.waitForFunction(() => document.querySelector('.mviewer .mv-stage img')?.naturalWidth > 0, null, { timeout: 5000 });
    await page.click('.mviewer [data-mv="share"]'); await page.waitForTimeout(1500);
    ok(downloads.length === 1 && downloads[0] === 'Made here.png', `an app's own picture (bytes) is saved instead too (${JSON.stringify(downloads)}, ${JSON.stringify(await page.evaluate(() => window.__toasts))})`);
    downloads.length = 0; const before = hits.filter(h => h === 'refused:read').length;
    await page.evaluate(() => WosChat.viewer.open([{ url: '/messenger/api/unified/media/refused', kind: 'image', name: 'Miguel', mime: 'image/jpeg' }], 0));
    await page.waitForFunction(() => document.querySelector('.mviewer .mv-stage img')?.naturalWidth > 0, null, { timeout: 5000 });
    await page.click('.mviewer [data-mv="share"]'); await page.waitForTimeout(2000);
    const refusedReads = hits.filter(h => h === 'refused:read').length - before;
    ok(downloads.length === 1 && refusedReads === 1, `a refused read: Share saves through the browser's downloads after one read (${JSON.stringify(downloads)}, reads ${refusedReads})`);
    await context.close();
    const reads = hits.filter(h => h === 'slow:read');
    console.log('media requests: ' + JSON.stringify(hits));
    ok(reads.length === 0, `the shown photo is not fetched again from the box for Save (${reads.length} extra reads)`);
  } finally { await browser.close(); server.close(); }
  const broken = process.env.QA_EXPECT === 'broken';
  if (broken) { console.log(fails.length ? `expected failures on this build: ${fails.length}` : 'UNEXPECTED: all checks passed'); process.exit(fails.length ? 0 : 1); }
  console.log(fails.length ? `${fails.length} failed` : 'all checks passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
