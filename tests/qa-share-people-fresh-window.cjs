// Browser QA for wizard-ux issue 1627: Share on a chat file (.md) in a window that has never opened Messenger shows
// Messenger's recent people in the People row, and picking one puts the file in that chat.
// Real Chromium, the real chat-kit.js + share-sheet.js + media viewer, a fake box that answers the App Manager switch
// catalog (messenger:share-files on) and the Agent Service Pages file API (versioned GET/PUT, 409 on a stale save).
//  1. Window A (its own profile): Messenger runs there and publishes its recent chats (WizardApp.share.receive with
//     targets, through the same app-services ops the real frame uses).
//  2. Window B (a fresh profile: no wos.share.receivers.v1, Messenger never ran): open a chat's .md file, Share.
//     The People row lists Messenger's people; picking one opens Messenger with the file waiting for that chat
//     (target = that chat's id, bytes intact). On for everyone (switch wizard/share-people-box removed).
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-share-people-fresh-window.cjs
//   QA_WEB=<an older web/> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOTS=<dir>: a phone-size (412 px) screenshot of window B's sheet: sheet.png.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const ID = '0123456789abcdef0123456789abcdef', BODY = '# Trip notes\n\nPack the charger.\n';
const PEOPLE = [{ id: 'tg:4401', name: 'Ana Ruiz', detail: 'Telegram', lastActivity: 1764100000000 }, { id: 'tg:4402', name: 'Ben Okafor', detail: 'Telegram', lastActivity: 1764090000000 }, { id: 'sig:77', name: 'Family', detail: 'Group', lastActivity: 1764080000000 }];
const page = () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/wizard-os-home/core/base.css"><link rel="stylesheet" href="/wizard-os-home/core/chats.css"><link rel="stylesheet" href="/wizard-os-home/core/share-sheet.css">
</head><body style="margin:0;background:#111;color:#eee;font:15px system-ui"><div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>window.WizCore = { apps: () => ({ APP: { messenger: { id: 'messenger', name: 'Messenger', kind: 'wizard' } } }) };
window.__opened = []; window.WizOpenApp = id => { window.__opened.push(id); return true; };
window.WizAppServices = { claimShare: o => { window.__ops = o; return true; } };</script>
<script src="/wizard-os-home/core/chat-kit.js"></script><script src="/wizard-os-home/core/share-sheet.js"></script>
</body></html>`;
function serve() {
  const box = { text: null, version: null, n: 0, puts: 0, gets: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), json = (s, v) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (u.pathname === '/wizard-os-home/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page()); }
    if (u.pathname === `/wizard/attachments/${ID}`) { res.writeHead(200, { 'content-type': 'text/markdown' }); return res.end(BODY); }
    if (u.pathname === '/wizard-os-home/store-install/_feature-switches') return json(200, { switches: [{ id: 'messenger:share-files', kind: 'app', app: 'messenger', on: true }], apps: [{ id: 'messenger', name: 'Messenger', ok: true }] });
    if (u.pathname === '/wizard/v1/pages/wizard-share/people.json') {
      if (req.method === 'GET') { box.gets++; return box.text == null ? json(404, { error: 'file_not_found' }) : json(200, { text: box.text, version: box.version }); }
      if (req.method === 'PUT') {
        let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
          box.puts++; const { text, version } = JSON.parse(b);
          if ((version ?? null) !== box.version) return json(409, { error: 'stale_version', current: { text: box.text || '', version: box.version, exists: box.text != null } });
          box.text = text; box.version = 'v' + (++box.n); json(200, { version: box.version });
        });
        return;
      }
      return json(405, { error: 'method_not_allowed' });
    }
    const file = path.join(WEB, u.pathname.replace(/^\/wizard-os-home\//, '/'));
    if (!file.startsWith(WEB) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/javascript' }); fs.createReadStream(file).pipe(res);
  });
  return { server, box };
}
const fails = [], ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
async function run(browser) {
  const tag = 'fresh window';
  const { server, box } = serve(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/wizard-os-home/index.html`;
  try {
    // Window A: Messenger has run here and published its recent chats.
    const a = await browser.newContext({ viewport: { width: 412, height: 915 } }), pa = await a.newPage();
    await pa.goto(base); await pa.waitForFunction(() => !!window.__ops && !!window.WosShareSheet);
    await pa.evaluate(p => { window.__ops.register('messenger', { accepts: ['text', 'url', 'image', 'file'] }); window.__ops.setTargets('messenger', p); }, PEOPLE);
    await pa.waitForTimeout(3500); // the box copy is written a moment after the last change
    ok(box.puts >= 1 && /Ana Ruiz/.test(box.text || ''), `window A keeps Messenger's people on the box (${box.puts} writes, ${box.gets} reads)`);
    ok(!/lastActivity|Pack the charger/.test(box.text || ''), 'the box copy holds names and ids only (no activity times, no content)');
    await a.close();
    // Window B: a fresh profile that never opened Messenger.
    const b = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 }), pb = await b.newPage();
    await pb.goto(base); await pb.waitForFunction(() => !!window.WosChat?.viewer && !!window.WosShareSheet);
    ok(await pb.evaluate(() => !localStorage.getItem('wos.share.receivers.v1')), `${tag}: window B is fresh, Messenger never registered here`);
    await pb.evaluate(id => WosChat.viewer.open([{ url: `/wizard/attachments/${id}`, kind: 'file', name: 'trip-notes.md', mime: 'text/markdown', bytes: 40 }], 0), ID);
    await pb.waitForSelector('[data-mv="share"]', { timeout: 5000 }); await pb.waitForTimeout(800);
    await pb.click('[data-mv="share"]'); await pb.waitForTimeout(800);
    const sheet = await pb.evaluate(() => ({ open: !!document.querySelector('.wos-share.on'), people: [...document.querySelectorAll('.wos-share.on [data-shs-people] .shs-person')].map(b => b.getAttribute('aria-label')), messenger: !!document.querySelector('.wos-share.on [data-shs-apps] [data-shs-app="messenger"]') }));
    if (SHOTS) await pb.screenshot({ path: path.join(SHOTS, 'sheet.png') });
    ok(sheet.open && sheet.messenger, `${tag}: the sheet lists the Messenger app (${JSON.stringify(sheet)})`);
    ok(sheet.people.length === 3 && sheet.people[0] === 'Ana Ruiz in Messenger', `the People row shows Messenger's recent people, most recent first (${JSON.stringify(sheet.people)})`);
    if (!sheet.people.length) return;
    await pb.click('.wos-share.on [data-shs-target="tg:4402"]'); await pb.waitForTimeout(300);
    const got = await pb.evaluate(async () => { const p = window.__ops?.pending('messenger') || []; return { opened: window.__opened.slice(), n: p.length, kind: p[0]?.kind, target: p[0]?.target, name: p[0]?.name, text: p[0]?.file ? await p[0].file.text() : '' }; });
    ok(got.opened.includes('messenger'), `picking Ben opens Messenger (${JSON.stringify(got.opened)})`);
    ok(got.n === 1 && got.kind === 'file' && got.target === 'tg:4402' && got.name === 'trip-notes.md' && got.text === BODY, `the file waits for Ben's chat, bytes intact (${JSON.stringify({ ...got, text: got.text.length })})`);
    await b.close();
  } finally { server.close(); }
}
(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser);
  } finally { await browser.close(); }
  const broken = process.env.QA_EXPECT === 'broken';
  if (broken) { console.log(fails.length ? `expected failures on this build: ${fails.length}` : 'UNEXPECTED: all checks passed'); process.exit(fails.length ? 0 : 1); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
