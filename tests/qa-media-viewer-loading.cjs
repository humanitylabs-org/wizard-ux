// Browser QA for ux#1509: Wizard's media viewer (web/core/chat-kit.js) never opens a picture on an empty black stage.
// Real Chromium, the real chat-kit.js + chats.css. The original picture answers slowly (or fails); its stand-in is quick.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-media-viewer-loading.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOTS=<dir>: save screenshots (stand-in shown while loading, failed load).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const svg = (fill, word) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="${fill}"/><text x="40" y="220" font-size="64" fill="white">${word}</text></svg>`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/core/chats.css"><style>body{margin:0;background:#111}</style></head><body><div id="device"></div>
<script src="/core/chat-kit.js"></script></body></html>`;
let failNext = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  if (u.pathname.startsWith('/pic/')) {
    const name = u.pathname.slice(5), thumb = u.searchParams.has('thumb'), view = u.searchParams.has('view');
    if (name === 'broken' && !thumb && failNext > 0) { failNext--; res.writeHead(500, { 'cache-control': 'no-store' }); return res.end('no'); }
    const send = () => { res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }); res.end(svg(thumb ? '#555' : view ? '#264653' : '#2a9d8f', (thumb ? 'thumb ' : view ? 'view ' : 'full ') + name)); };
    return thumb ? send() : setTimeout(send, view ? 300 : 2500);
  }
  const file = path.join(WEB, u.pathname);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/javascript' }); fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 860 } });
  const fails = [], ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
  await page.goto(base); await page.waitForFunction(() => !!window.WosChat?.viewer);
  const stage = () => page.evaluate(() => { const st = document.querySelector('.mv-stage'), img = st?.querySelector('img');
    return { src: img ? new URL(img.src || location.href).pathname + new URL(img.src || location.href).search : '', w: img?.naturalWidth || 0, shown: !!img && !img.hidden, loading: !!st?.querySelector('.mv-load'), fail: st?.querySelector('.mv-fail')?.textContent || '' }; });
  // 1. A picture with a stand-in: the stand-in is on screen at once with a loading mark, then the original takes over.
  await page.evaluate(() => WosChat.viewer.open([{ url: '/pic/a', placeholder: '/pic/a?thumb', kind: 'image', name: 'A' }, { url: '/pic/b', placeholder: '/pic/b?thumb', kind: 'image', name: 'B' }], 0));
  await page.waitForTimeout(400);
  let s = await stage();
  ok(s.w > 0 && /thumb/.test(s.src), `stand-in shows within 0.4 s (src=${s.src}, width=${s.w})`);
  ok(s.loading, 'a loading mark shows while the original loads');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'loading.png') });
  await page.waitForFunction(() => /\/pic\/a$/.test(document.querySelector('.mv-stage img')?.src || ''), null, { timeout: 6000 }).catch(() => {});
  s = await stage();
  ok(s.src === '/pic/a' && s.w > 0, `the original takes over once it is in (src=${s.src})`);
  ok(!s.loading, 'the loading mark goes when the original is in');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'loaded.png') });
  // 1b. wizard-messenger issue 348: a stand-in plus a sharper `preview`: stand-in first, then the preview, then the original.
  await page.evaluate(() => { WosChat.viewer.close(); WosChat.viewer.open([{ url: '/pic/p', placeholder: '/pic/p?thumb', preview: '/pic/p?view', kind: 'image', name: 'P' }], 0); });
  await page.waitForTimeout(150);
  s = await stage();
  ok(s.w > 0 && /thumb/.test(s.src), `with a preview the stand-in still shows first (src=${s.src})`);
  await page.waitForFunction(() => /\?view$/.test(document.querySelector('.mv-stage img')?.src || ''), null, { timeout: 2000 }).catch(() => {});
  s = await stage();
  ok(/\?view$/.test(s.src) && s.w > 0 && s.loading, `the preview takes the stand-in's place while the original loads (src=${s.src})`);
  await page.waitForFunction(() => /\/pic\/p$/.test(document.querySelector('.mv-stage img')?.src || ''), null, { timeout: 6000 }).catch(() => {});
  s = await stage();
  ok(s.src === '/pic/p' && !s.loading, `the original still takes over last (src=${s.src})`);
  // 2. No stand-in: a loading mark while the stage waits.
  await page.evaluate(() => { WosChat.viewer.close(); WosChat.viewer.open([{ url: '/pic/c', kind: 'image', name: 'C' }], 0); });
  await page.waitForTimeout(400);
  s = await stage();
  ok(s.loading, 'without a stand-in a loading mark shows on the waiting stage');
  // 3. The original fails: "Couldn't load this photo" with Retry; Retry loads it.
  failNext = 1;
  await page.evaluate(() => { WosChat.viewer.close(); WosChat.viewer.open([{ url: '/pic/broken', placeholder: '/pic/broken?thumb', kind: 'image', name: 'Broken' }], 0); });
  await page.waitForTimeout(800);
  s = await stage();
  ok(/Couldn.t load this photo/.test(s.fail) && /Retry/.test(s.fail), `a failed load says so with Retry (${JSON.stringify(s.fail)})`);
  ok(!s.loading, 'no loading mark once it failed');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'failed.png') });
  await page.click('.mv-fail [data-mv="retry"]', { timeout: 3000 }).catch(e => ok(false, 'Retry button tap: ' + e.message.split('\n')[0]));
  await page.waitForFunction(() => /\/pic\/broken$/.test(document.querySelector('.mv-stage img')?.src || ''), null, { timeout: 6000 }).catch(() => {});
  s = await stage();
  ok(s.src === '/pic/broken' && s.w > 0 && !s.fail, `Retry loads the picture (src=${s.src})`);
  ok(await page.evaluate(() => WosChat.viewer.isOpen()), 'Retry keeps the viewer open');
  await browser.close(); server.close();
  const broken = process.env.QA_EXPECT === 'broken';
  if (broken) { console.log(fails.length ? `expected failures on this build: ${fails.length}` : 'UNEXPECTED: all checks passed'); process.exit(fails.length ? 0 : 1); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
