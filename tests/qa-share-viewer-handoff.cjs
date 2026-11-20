// Browser QA for wizard-ux issue 1630: with a file open in the real media viewer, Share, then Messenger.
// Real Chromium, the real chat-kit.js + share-sheet.js + desktop toast. Messenger opens as a desktop window (z-index of
// a normal window, under shell overlays) showing its own "Send to…" contact list, as the real app does.
// Checks: the Send to… list is the top element where it is drawn (clickable, not under the viewer), the viewer is
// closed, and no "Shared" toast claims a delivery that has not happened.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-share-viewer-handoff.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOTS=<dir>: screenshots (after-tap.png).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const ID = '0123456789abcdef0123456789abcdef', BODY = '# Trip notes\n\nPack the charger.\n';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/wizard-os-home/desktop/desktop.css"><link rel="stylesheet" href="/wizard-os-home/core/chats.css"><link rel="stylesheet" href="/wizard-os-home/core/share-sheet.css">
<style>.qa-win{position:fixed;left:340px;top:90px;width:600px;height:560px;z-index:40;background:#1d1f24;border:1px solid #333;border-radius:12px;padding:18px}
.qa-win h3{margin:0 0 12px}.qa-win button{display:block;width:100%;margin:6px 0;padding:12px;background:#2a2d34;color:#eee;border:0;border-radius:8px;text-align:left;font:15px system-ui}</style>
</head><body style="margin:0;background:#111;color:#eee;font:15px system-ui"><div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>window.WizCore = { apps: () => ({ APP: { messenger: { id: 'messenger', name: 'Messenger', kind: 'wizard' } } }) };
window.WizCanOpen = id => id === 'messenger';
window.__opened = []; window.__toasts = [];
window.WizOpenApp = id => { window.__opened.push(id); const w = document.createElement('div'); w.className = 'qa-win'; w.innerHTML = '<h3>Messenger · Send to…</h3><button type="button" data-qa-pick="ana">Ana</button><button type="button" data-qa-pick="ben">Ben</button>'; w.addEventListener('click', e => { const b = e.target.closest('[data-qa-pick]'); if (b) window.__picked = b.dataset.qaPick; }); document.body.appendChild(w); return true; };
window.WizAppServices = { claimShare: o => { window.__ops = o; return true; } };
localStorage.setItem('wos.share.receivers.v1', JSON.stringify({ messenger: { kinds: ['text', 'url', 'image', 'file'], at: Date.now() } }));</script>
<script src="/wizard-os-home/core/chat-kit.js"></script><script src="/wizard-os-home/core/share-sheet.js"></script>
<script>let tt; WosChat.K.notify = (icon, text) => { window.__toasts.push(text); const t = document.getElementById('toast'); t.innerHTML = '<span>' + icon + '</span><span>' + text + '</span>'; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 4000); };</script>
</body></html>`;
function serve() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/wizard-os-home/desktop.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    if (u.pathname === `/wizard/attachments/${ID}`) { res.writeHead(200, { 'content-type': 'text/markdown' }); return res.end(BODY); }
    if (u.pathname === '/wizard-os-home/store-install/_feature-switches') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ switches: [{ id: 'messenger:share-files', kind: 'app', app: 'messenger', name: 'Share files to Messenger', on: true }], apps: [{ id: 'messenger', name: 'Messenger', ok: true }] }));
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
  try {
    const base = `http://127.0.0.1:${server.address().port}/`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(base + 'wizard-os-home/desktop.html'); await page.waitForFunction(() => !!window.WosChat?.viewer && !!window.WosShareSheet);
    await page.evaluate(id => WosChat.viewer.open([{ url: `/wizard/attachments/${id}`, kind: 'file', name: 'trip-notes.md', mime: 'text/markdown', bytes: 40 }], 0), ID);
    await page.waitForSelector('[data-mv="share"]', { timeout: 5000 }); await page.waitForTimeout(400);
    await page.click('[data-mv="share"]');
    await page.waitForSelector('.wos-share.on [data-shs-app="messenger"]', { timeout: 5000 }); await page.waitForTimeout(300);
    await page.click('.wos-share.on [data-shs-app="messenger"]'); await page.waitForTimeout(900);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after-tap.png') });
    const st = await page.evaluate(() => {
      const b = document.querySelector('[data-qa-pick="ana"]'); if (!b) return { picker: false };
      const r = b.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { picker: true, top: at === b || b.contains(at), covering: at?.closest?.('.mviewer') ? 'media viewer' : at?.className || '', viewer: WosChat.viewer.isOpen(), opened: window.__opened.slice(), toasts: window.__toasts.slice() };
    });
    ok(st.picker && st.opened.length === 1 && st.opened[0] === 'messenger', `picking Messenger opens it with its Send to… list (${JSON.stringify(st.opened)})`);
    ok(st.viewer === false, 'the media viewer closed for the handoff');
    ok(st.top === true, `the Send to… list is on top where it is drawn (covered by: ${st.covering || 'nothing'})`);
    ok(!(st.toasts || []).some(t => t === 'Shared'), `no "Shared" toast before a person is picked (${JSON.stringify(st.toasts)})`);
    if (st.top) { await page.click('[data-qa-pick="ana"]'); ok(await page.evaluate(() => window.__picked === 'ana'), 'a tap on a contact reaches Messenger'); }
    const p = await page.evaluate(() => (window.__ops?.pending('messenger') || []).map(x => x.name));
    ok(p.length === 1 && p[0] === 'trip-notes.md', `the file still waits for Messenger (${JSON.stringify(p)})`);
    await context.close();
  } finally { await browser.close(); server.close(); }
  const expectBroken = process.env.QA_EXPECT === 'broken';
  if (expectBroken) { console.log(fails.length ? `expected failures seen (${fails.length})` : 'FAIL: QA_EXPECT=broken but every check passed'); process.exit(fails.length ? 0 : 1); }
  console.log(fails.length ? `${fails.length} failed` : 'all checks passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
