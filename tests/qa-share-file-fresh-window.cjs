// Browser QA for wizard-ux issue 1625: Share on a chat file (.md) in a window that has never opened Messenger.
// Real Chromium, a fresh profile (no wos.share.receivers.v1), the real chat-kit.js + share-sheet.js, the real desktop
// toast (#toast.toast with web/desktop/desktop.css) under the real media viewer.
//  1. Messenger's own share-files switch on (App Manager switch catalog): the sheet lists Messenger without Messenger
//     ever having run here; tapping it opens Messenger with the file waiting for it (pending, bytes intact).
//  2. Same sheet, Other apps… on a desktop browser (no native bridge, no file share): the file is saved to Downloads
//     instead (wizard-os issue 747) and a message saying so shows ABOVE the viewer.
//  3. Switch off: no receiver takes the file; it is saved instead and the owner is told so (above the viewer).
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-share-file-fresh-window.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOTS=<dir>: screenshots of each step.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const ID = '0123456789abcdef0123456789abcdef', BODY = '# Trip notes\n\nPack the charger.\n';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/wizard-os-home/desktop/desktop.css"><link rel="stylesheet" href="/wizard-os-home/core/chats.css"><link rel="stylesheet" href="/wizard-os-home/core/share-sheet.css">
</head><body style="margin:0;background:#111;color:#eee;font:15px system-ui"><div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>window.WizCore = { apps: () => ({ APP: { messenger: { id: 'messenger', name: 'Messenger', kind: 'wizard' } } }) };
window.__opened = []; window.WizOpenApp = id => { window.__opened.push(id); return true; };
window.WizAppServices = { claimShare: o => { window.__ops = o; return true; } };</script>
<script src="/wizard-os-home/core/chat-kit.js"></script><script src="/wizard-os-home/core/share-sheet.js"></script>
<script>let tt; WosChat.K.notify = (icon, text) => { const t = document.getElementById('toast'); t.innerHTML = '<span>' + icon + '</span><span>' + text + '</span>'; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 4000); };</script>
</body></html>`;
function serve(switchOn) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/wizard-os-home/desktop.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    if (u.pathname === `/wizard/attachments/${ID}`) { res.writeHead(200, { 'content-type': 'text/markdown' }); return res.end(BODY); }
    if (u.pathname === '/wizard-os-home/store-install/_feature-switches') {
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ switches: [{ id: 'messenger:share-files', kind: 'app', app: 'messenger', name: 'Share files to Messenger', on: switchOn }], apps: [{ id: 'messenger', name: 'Messenger', ok: true }] }));
    }
    const file = path.join(WEB, u.pathname.replace(/^\/wizard-os-home\//, '/'));
    if (!file.startsWith(WEB) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/javascript' }); fs.createReadStream(file).pipe(res);
  });
}
const fails = [], ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
// The toast is seen only if it is the top element where it is drawn (not under the viewer or the sheet).
const toastSeen = page => page.evaluate(() => {
  const t = document.getElementById('toast'), r = t.getBoundingClientRect();
  if (!t.classList.contains('on') || !r.width) return { text: '', top: false };
  const pe = t.style.pointerEvents; t.style.pointerEvents = 'auto'; // the toast lets taps through: hit-test it on purpose
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); t.style.pointerEvents = pe;
  return { text: t.textContent, top: !!at && (at === t || t.contains(at)) };
});
async function openShare(browser, base, tag) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }); // fresh profile every time
  const page = await context.newPage();
  await page.goto(base + 'wizard-os-home/desktop.html'); await page.waitForFunction(() => !!window.WosChat?.viewer && !!window.WosShareSheet);
  ok(await page.evaluate(() => !localStorage.getItem('wos.share.receivers.v1')), `${tag}: fresh profile, Messenger never registered here`);
  await page.evaluate(id => WosChat.viewer.open([{ url: `/wizard/attachments/${id}`, kind: 'file', name: 'trip-notes.md', mime: 'text/markdown', bytes: 40 }], 0), ID);
  await page.waitForSelector('[data-mv="share"]', { timeout: 5000 }); await page.waitForTimeout(400);
  await page.click('[data-mv="share"]'); await page.waitForTimeout(1200);
  return { context, page };
}
(async () => {
  const browser = await chromium.launch();
  try {
    // 1 + 2: switch on.
    let server = serve(true); await new Promise(r => server.listen(0, '127.0.0.1', r));
    let base = `http://127.0.0.1:${server.address().port}/`;
    let { context, page } = await openShare(browser, base, 'switch on');
    const sheet = await page.evaluate(() => ({ open: !!document.querySelector('.wos-share.on'), messenger: !!document.querySelector('.wos-share.on [data-shs-app="messenger"]'), preview: document.querySelector('.wos-share.on .shs-prev')?.textContent || '' }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'sheet-switch-on.png') });
    ok(sheet.open && sheet.messenger, `switch on: the share sheet lists Messenger without opening it first (${JSON.stringify(sheet)})`);
    ok(/trip-notes\.md/.test(sheet.preview), 'the sheet previews the file name');
    if (sheet.messenger) {
      await page.click('.wos-share.on [data-shs-app="messenger"]'); await page.waitForTimeout(300);
      const got = await page.evaluate(async () => { const p = window.__ops?.pending('messenger') || []; return { opened: window.__opened.slice(), n: p.length, kind: p[0]?.kind, name: p[0]?.name, text: p[0]?.file ? await p[0].file.text() : '' }; });
      ok(got.opened.some(id => id === 'messenger'), `picking Messenger opens it (${JSON.stringify(got.opened)})`);
      ok(got.n === 1 && got.kind === 'file' && got.name === 'trip-notes.md' && got.text === BODY, `the file itself waits for Messenger, bytes intact (${JSON.stringify({ ...got, text: got.text.length })})`);
    }
    await context.close();
    ({ context, page } = await openShare(browser, base, 'other apps'));
    const other = await page.$('.wos-share.on [data-shs-other]');
    ok(!!other, 'Other apps… is in the sheet');
    if (other) { await other.click(); await page.waitForTimeout(800); }
    const seenOther = await toastSeen(page);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'other-apps.png') });
    ok(seenOther.top && /saved to Downloads instead/.test(seenOther.text), `Other apps… on desktop saves the file and says so, visible above the viewer (${JSON.stringify(seenOther)})`);
    await context.close(); server.close();
    // 3: switch off.
    server = serve(false); await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/`;
    ({ context, page } = await openShare(browser, base, 'switch off'));
    const off = await page.evaluate(() => !!document.querySelector('.wos-share.on [data-shs-app="messenger"]'));
    const seenOff = await toastSeen(page);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'switch-off.png') });
    ok(!off, 'switch off: Messenger is not offered a file it would refuse');
    ok(seenOff.top && /saved to Downloads instead/.test(seenOff.text), `no receiver: the file is saved and the owner is told, visible above the viewer (${JSON.stringify(seenOff)})`);
    await context.close(); server.close();
  } finally { await browser.close(); }
  const broken = process.env.QA_EXPECT === 'broken';
  if (broken) { console.log(fails.length ? `expected failures on this build: ${fails.length}` : 'UNEXPECTED: all checks passed'); process.exit(fails.length ? 0 : 1); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
