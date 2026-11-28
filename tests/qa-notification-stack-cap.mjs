/* Browser proof for wizard-ux issue 2059: a quiet notification stack with 20 waiting items from one source shows
 * all 20, in real Chromium on the phone shell (412 px) with every stylesheet web/index.html loads.
 *   node tests/qa-notification-stack-cap.mjs   (QA_PLAYWRIGHT=<path> if Playwright is not installed locally)
 *   QA_WEB=<other checkout>/web QA_EXPECT=broken -> baseline: asserts only 6 show there.  QA_SHOTS=<dir> saves a shot.
 * Main thread and routed agent windows (host-profile, container, restricted: renderThread adds `.agent` and its
 * colour; the stack markup is the same) are each checked. The stack markup comes from the real noteStackHtml in web/core/chats-drafts.js; core/unified-inbox.css is Notifications in
 * Chats (on by default), which the shell loads at runtime. */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import { block, runRecording } from './fixtures/source-slice.mjs';
const require = createRequire(import.meta.url); const { chromium } = require('../tools/qa-playwright.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(process.env.QA_WEB || path.join(here, '..', 'web'));
const SHOTS = process.env.QA_SHOTS || '', BROKEN = process.env.QA_EXPECT === 'broken';
const { withWebParts } = await import(path.join(WEB, '..', 'tests', 'fixtures', 'web-parts.mjs'));
const js = withWebParts(fs.readFileSync(path.join(WEB, 'core', 'chats-drafts.js'), 'utf8'));
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const all = Array.from({ length: 20 }, (_, k) => ({ id: 'n' + k, title: `Wingman beta feedback #${20 - k}`, message: `Tester note ${20 - k}: the share sheet closed itself.`, at: 1e6 - k * 60 }));
const stack = runRecording(`${block(js, '  function noteStackHtml(NV, body, acts) {')}\nthis.html = noteStackHtml;`, { esc, clip: (t, n) => String(t).slice(0, n),
  noteSiblings: it => all.filter(i => i.id !== it.id), noteAt: i => i.at * 1000, noteSrcName: () => 'Oscar', ago: () => '5m', noteTitle: i => i.title,
  notePlain: String, ACT: { done: { icon: '', label: 'Archive' } }, noteRouteQuiet: () => '' })
  .html({ id: 'n0', item: all[0] }, `<div class="bub"><p>${all[0].message}</p></div>`, '<div class="ch-tacts"><button type="button">Archive</button></div>');
const links = [...fs.readFileSync(path.join(WEB, 'index.html'), 'utf8').matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
const page = route => `<!doctype html><html data-shell="phone" data-layout="ai-apps" data-skin="nebula"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${links.map(h => `<link rel="stylesheet" href="/${h}">`).join('\n')}<link rel="stylesheet" href="/core/unified-inbox.css"><link rel="stylesheet" href="/layouts/ai-apps/layout.css"><style>body{background:var(--wz-base,#111)}</style></head><body>
<div data-chats="w1"><div data-part="thread" class="ch-thread${route ? ' agent' : ''} ch-notif-thread"${route ? ` data-route="${route}" style="--agc:#7aa2ff"` : ''}><div class="ch-msgs">${stack}</div></div></div></body></html>`;
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); if (u.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(page(['host-profile', 'container', 'restricted'].find(r => r === u.searchParams.get('route')) || '')); }
  const f = path.join(WEB, decodeURIComponent(u.pathname));
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
try {
  for (const route of ['', 'host-profile', 'container', 'restricted']) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 }), p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${server.address().port}/?route=${route}`); await p.waitForLoadState('networkidle');
    const r = await p.evaluate(() => ({ cards: [...document.querySelectorAll('.ch-nstack .ch-ncard, .ch-nstack .ch-notif.is-open')].filter(e => e.getBoundingClientRect().height > 0).length,
      notes: [...document.querySelectorAll('.ch-notif-more-x')].map(e => e.textContent) }));
    if (SHOTS && !route) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `stack-${BROKEN ? 'before' : 'after'}.png`), fullPage: true }); }
    console.log(route || 'main', JSON.stringify(r));
    if (BROKEN) { assert.equal(r.cards, 6); assert.deepEqual(r.notes, ['and 14 older · they move up as you finish these']); }
    else { assert.equal(r.cards, 20, `all 20 cards are drawn and visible (${route || 'main'})`); assert.deepEqual(r.notes, []); }
    await ctx.close();
  }
  console.log(BROKEN ? 'baseline confirmed broken' : 'ok: all 20 show in the main thread and every routed window');
} finally { await browser.close(); server.close(); }
