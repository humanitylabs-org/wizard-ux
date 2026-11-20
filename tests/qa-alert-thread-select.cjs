/* Browser proof for issue 1650: an alert thread's text selects like a chat message, real Chromium, real shell CSS.
 *   node tests/qa-alert-thread-select.cjs   (QA_PLAYWRIGHT=<path> if Playwright is not installed locally)
 *   QA_WEB=<other checkout>/web QA_EXPECT=broken  -> baseline: asserts the Original alert does NOT select there.
 *   QA_SHOTS=<dir> saves phone screenshots of a drag-selection on both skins.
 * Fixture markup copies the templates in web/core/chats.js (renderThread's NV branch, noteStackHtml, alertsHtml), and
 * the page loads every stylesheet web/index.html loads, on the phone shell in the AI apps layout. */
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert/strict');
const WEB = path.resolve(process.env.QA_WEB || path.join(__dirname, '..', 'web'));
const SHOTS = process.env.QA_SHOTS || '', BROKEN = process.env.QA_EXPECT === 'broken';
const links = [...fs.readFileSync(path.join(WEB, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
const ORIGINAL = 'cron job "nightly-backup" exited 1\nrsync: connection unexpectedly closed (0 bytes received so far)\nrsync error: error in rsync protocol data stream (code 12)';
const page = skin => `<!doctype html><html data-shell="phone" data-layout="ai-apps" data-skin="${skin}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${links.map(h => `<link rel="stylesheet" href="/${h}">`).join('\n')}
<link rel="stylesheet" href="/layouts/ai-apps/layout.css"><style>body{touch-action:auto;background:var(--wz-base,#111)}</style></head><body>
<div data-chats="w1"><div data-part="thread" class="ch-thread ch-notif-thread"><div class="ch-msgs">
<section class="ch-notif-more ch-nstack" aria-label="2 from Scheduled job"><div class="ch-notif-more-h"><span>2 from Scheduled job</span><button type="button" data-chnotif-doneall="n1"><span>Archive all 2</span></button></div>
<div class="msg a ch-notif is-quiet is-open" data-morph-key="notif:n1" aria-current="true"><div class="ch-ncard-h"><b id="title">Nightly backup failed</b><time>2m</time></div>
<div class="bub" id="msg"><p>The nightly backup did not finish.</p></div>
<section class="ch-notif-details" aria-label="Original alert"><h2>Original alert</h2><div class="ch-notif-original" id="orig">${ORIGINAL}</div></section>
<div class="ch-tacts"><button type="button" id="btn">Archive</button></div></div>
<button type="button" class="ch-notif-more-i ch-ncard" data-chnotif-go="n2"><b>Disk almost full</b><span>92% used</span><time>1h</time></button></section>
<section class="appr ch-sweep ch-alerts" role="group" aria-label="Alerts now"><b>Alerts now</b><ul class="ch-sw-l"><li class="ch-sw-i ch-al-i"><div class="ch-sw-t"><b id="alt">Backup failed twice</b></div><p class="ch-sw-ask" id="ask">Should I retry the backup tonight?</p></li></ul></section>
</div></div></div></body></html>`;

const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(page(u.searchParams.get('skin') === 'grove' ? 'grove' : 'nebula')); }
  const f = path.join(WEB, decodeURIComponent(u.pathname));
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    for (const skin of ['nebula', 'grove']) {
      const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      await p.goto(base + '?skin=' + skin); await p.waitForLoadState('networkidle');
      const us = await p.evaluate(() => Object.fromEntries(['msg', 'orig', 'title', 'alt', 'ask', 'btn'].map(id => [id, getComputedStyle(document.getElementById(id)).userSelect])));
      // drag across the Original alert, the way a long-press + handle drag selects on the phone
      const box = await p.locator('#orig').boundingBox();
      await p.mouse.move(box.x + 4, box.y + 6); await p.mouse.down(); await p.mouse.move(box.x + box.width - 10, box.y + box.height - 6, { steps: 8 }); await p.mouse.up();
      const sel = await p.evaluate(() => String(getSelection()));
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `alert-select-${BROKEN ? 'before' : 'after'}-${skin}.png`) }); }
      console.log(skin, JSON.stringify(us), 'selected:', JSON.stringify(sel.slice(0, 60)));
      if (BROKEN) {
        assert.equal(us.orig, 'none', 'baseline: Original alert is not selectable'); assert.equal(sel, '', 'baseline: dragging selects nothing');
      } else {
        for (const id of ['msg', 'orig', 'title', 'alt', 'ask']) assert.equal(us[id], 'text', `#${id} selectable on ${skin}`);
        assert.equal(us.btn, 'none', 'buttons stay unselectable');
        assert.match(sel, /nightly-backup/, 'drag selects the Original alert words');
      }
      await ctx.close();
    }
    console.log(BROKEN ? 'baseline confirmed broken' : 'ok: alert thread text selects');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
