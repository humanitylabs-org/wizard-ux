// Browser QA for the browser owner boundary, slice 44 (wizard-os#133): a sandboxed app's own calls to the shell's photo
// viewer (WizardApp.media.view) and its navigation calls (WizardApp.nav.back / openThread / openContextDraft). Before,
// they answered "no" (or threw) under the boundary, so a tapped photo, Back after a finishing action, a thread and a
// Reply draft did nothing. Real Chromium: a shell page with the boundary on (WizShellBoundary set the way shell-token.js
// does), the real core/browser-boundary.js and core/app-services.js, and app pages in sandboxed frames that load the
// real core/app-client.js. The viewer, Back, the thread and the Chats draft are recorded stand-ins in the shell.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-media-nav.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOTS=<dir>: also save a screenshot of the shell after the taps.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SVG = (fill, word) => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="${fill}"/><text x="10" y="48" font-size="20" fill="#fff">${word}</text></svg>`;
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{font:13px system-ui;margin:6px} button{margin:3px 6px 3px 0}</style></head>
<body><b>Notes</b><br>
<button id="photo">Open photos</button><button id="owner">Owner-route photo</button><button id="back">Done (Back)</button>
<button id="draft">Reply</button><button id="thread">Open thread</button>
<script>
  window.results = {};
  (async () => {
    await WizardApp.ready?.();
    // The page's own photo, made here: a blob: URL of this opaque origin, which the shell can't read by address.
    const c = document.createElement('canvas'); c.width = 120; c.height = 80;
    const g = c.getContext('2d'); g.fillStyle = '#2a9d8f'; g.fillRect(0, 0, 120, 80); g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.fillText('blob', 10, 48);
    window.blobUrl = URL.createObjectURL(await new Promise(r => c.toBlob(r, 'image/png')));
    results.agents = WizardApp.nav.threadAgents; results.drafts = WizardApp.nav.threadDrafts;
    results.ready = true;
  })();
  const run = (k, fn) => { try { results[k] = fn(); } catch (e) { results[k] = 'threw: ' + e.message; } };
  document.getElementById('photo').onclick = () => run('photo', () => WizardApp.media.view([{ url: 'pic.svg', name: 'Lake' }, { url: blobUrl, name: 'Made here' }, { url: 'https://example.com/x.png' }], 1));
  document.getElementById('owner').onclick = () => run('owner', () => WizardApp.media.view([{ url: '/wizard/hermes/api/media/secret.png' }], 0));
  document.getElementById('back').onclick = () => run('back', () => WizardApp.nav.back());
  document.getElementById('draft').onclick = () => run('draft', () => JSON.stringify(WizardApp.nav.openContextDraft({ id: 'note-7', title: 'Shopping', message: 'Milk, eggs' })));
  document.getElementById('thread').onclick = () => run('thread', () => WizardApp.nav.openThread('sid-42', { reply: { key: 'notes:note-7', title: 'Shopping', message: 'Milk' }, agent: 'philosopher', draft: { text: 'About this' } }));
</script></body></html>`;
// Not the installed app it claims to be (outside that app's path): the same calls, with a real tap.
const EVIL = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><button id="all">All</button><script>window.results = {};
  (async () => { await WizardApp.ready?.(); results.ready = true; })();
  document.getElementById('all').onclick = () => { try { WizardApp.media.view([{ url: '/notes/pic.svg' }], 0); WizardApp.nav.back(); WizardApp.nav.openThread('sid-evil'); WizardApp.nav.openContextDraft({ id: 'x', title: 'x', message: 'x' }); } catch (_) {} results.tapped = true; };
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>window.viewed = []; window.backs = []; window.drafts = []; window.threads = [];
  const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } };
  window.WizLauncher = { hasHostedThread: id => id === 'notes' || id === 'other' };
  window.WosAgents = { get: id => (id === 'philosopher' ? { status: 'running' } : null), isOther: id => id !== 'hermes' };
  // The shell's media viewer: shows what it was given, and reads each photo the way the real viewer's <img> does.
  window.WosChat = { reply: { clean: r => (r && typeof r.key === 'string' ? { key: r.key, title: String(r.title || ''), message: String(r.message || '') } : null) },
    viewer: { open: (items, i) => {
      const v = { items: items.map(x => ({ url: x.url, name: x.name, kind: x.kind })), i, loaded: [] }; viewed.push(v);
      const box = document.getElementById('viewer'); box.replaceChildren();
      for (const [n, x] of items.entries()) { const img = new Image(); img.src = x.url; img.title = x.name; if (n === i) img.className = 'cur';
        img.onload = () => v.loaded.push({ n, w: img.naturalWidth }); img.onerror = () => v.loaded.push({ n, error: true }); box.append(img); }
      return true; } } };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{font:13px system-ui;margin:8px;background:#120c24;color:#eee} iframe{width:640px;height:70px;border:1px solid #554;background:#fff}
 #viewer img{height:80px;margin:4px;border:2px solid transparent} #viewer img.cur{border-color:#f4d35e} #log{white-space:pre-wrap;font:12px ui-monospace,monospace;margin-top:6px}</style></head>
<body><div class="win" id="w1"><header class="wbar"><span>Notes</span></header>
<iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<div class="win" id="w2"><header class="wbar"><span>Other</span></header>
<iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/evil/" style="height:34px"></iframe></div>
<div>Photo viewer:</div><div id="viewer"></div><div id="log"></div>
<script>
  const [a, b] = document.querySelectorAll('iframe');
  const hooks = id => ({ isVisible: () => true,
    back: () => { backs.push(id); return true; },
    openContextDraft: (key, item) => { drafts.push({ id, key, item }); return Object.freeze({ kind: 'unsent-draft', id: 'new:1', sent: false }); },
    openThread: (sid, o) => { threads.push({ id, sid, o }); return true; } });
  WizAppServices.attach(a, { appId: 'notes', path: '/notes/', ...hooks('notes') });
  WizAppServices.attach(b, { appId: 'other', path: '/other/', ...hooks('other') });
  setInterval(() => { document.getElementById('log').textContent = 'Back steps: ' + JSON.stringify(backs) + '\\nChats drafts: ' + JSON.stringify(drafts.map(d => d.key)) + '\\nThreads: ' + JSON.stringify(threads.map(t => t.sid + (t.o.agent ? ' with ' + t.o.agent : ''))); }, 100);
</script></body></html>`;
const hits = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  hits.push(u.pathname);
  const send = (type, body) => { res.setHeader('content-type', type); res.end(body); };
  if (u.pathname === '/') return send('text/html', SHELL);
  if (u.pathname === '/notes/') return send('text/html', APP);
  if (u.pathname === '/notes/pic.svg') return send('image/svg+xml', SVG('#e76f51', 'Lake'));
  if (u.pathname === '/evil/') return send('text/html', EVIL);
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) return send('text/javascript', fs.readFileSync(file));
  }
  res.statusCode = 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 680, height: 330 } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.fulfill({ status: 404, body: '' }));
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  if (process.env.QA_DEBUG) page.on('console', m => console.log('console:', m.text()));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const frameOf = p => page.frames().find(fr => new URL(fr.url()).pathname === p);
  const until = async (p, fn, ms = 6000) => { for (let t = 0; t < ms; t += 100) { const f = frameOf(p); const r = f ? await f.evaluate(fn).catch(() => null) : null; if (r) return r; await page.waitForTimeout(100); } return null; };
  const shell = () => page.evaluate(() => ({ viewed: JSON.parse(JSON.stringify(viewed)), backs: [...backs], drafts: JSON.parse(JSON.stringify(drafts)), threads: JSON.parse(JSON.stringify(threads)) }));
  const app = () => frameOf('/notes/').evaluate(() => ({ ...results }));
  const settle = () => page.waitForTimeout(600);
  await until('/notes/', () => results.ready);
  await until('/evil/', () => results.ready);
  ok(await frameOf('/notes/').evaluate(() => self.origin) === 'null', 'the app page is opaque');
  let r = await app();
  ok(r.agents === true && r.drafts === true, 'the app sees thread agents and drafts offered: ' + JSON.stringify({ agents: r.agents, drafts: r.drafts }));
  await frameOf('/notes/').click('#photo'); await settle();
  let s = await shell(); r = await app();
  const v = s.viewed[0];
  ok(r.photo === true && !!v && v.items.length === 2 && v.items[0].url === base + '/notes/pic.svg' && v.items[0].name === 'Lake',
    'a tapped photo opens in the shell viewer, with only this host\'s photos: ' + JSON.stringify({ photo: r.photo, v }));
  ok(!!v && v.i === 1 && /^blob:http:\/\/127\.0\.0\.1:\d+\//.test(v.items[1].url) && v.items[1].name === 'Made here',
    'the page\'s own blob: photo opens as the shell\'s own, and stays the one tapped: ' + JSON.stringify(v && v.items[1]));
  ok(!!v && v.loaded.length === 2 && v.loaded.every(x => x.w === 120), 'the viewer can show both photos: ' + JSON.stringify(v && v.loaded));
  await frameOf('/notes/').click('#owner'); await settle();
  s = await shell(); r = await app();
  ok(s.viewed.length === 1, 'a photo on an owner route is never opened: ' + JSON.stringify({ owner: r.owner, n: s.viewed.length }));
  await frameOf('/notes/').click('#draft'); await settle();
  s = await shell(); r = await app();
  ok(/"kind":"unsent-draft"/.test(r.draft || '') && /"sent":false/.test(r.draft || '') && s.drafts.length === 1 && s.drafts[0].key === 'notes:note-7' && s.drafts[0].item.title === 'Shopping',
    'Reply opens a main Chats draft keyed to the app, nothing sent: ' + JSON.stringify({ draft: r.draft, drafts: s.drafts }));
  await frameOf('/notes/').click('#thread'); await settle();
  s = await shell(); r = await app();
  ok(r.thread === true && s.threads.length === 1 && s.threads[0].sid === 'sid-42' && s.threads[0].o.agent === 'philosopher' && s.threads[0].o.reply?.key === 'notes:note-7' && s.threads[0].o.draft?.text === 'About this',
    'openThread opens the thread with its agent, reply item and draft: ' + JSON.stringify({ thread: r.thread, threads: s.threads }));
  await frameOf('/notes/').click('#back'); await settle();
  s = await shell(); r = await app();
  ok(r.back === true && s.backs.length === 1 && s.backs[0] === 'notes', 'Back after a finishing action takes the window\'s own Back step: ' + JSON.stringify({ back: r.back, backs: s.backs }));
  // A page outside its app's path (not the app it claims to be) gets none of them, even with a tap.
  await frameOf('/evil/').click('#all'); await settle();
  s = await shell();
  ok(s.viewed.length === 1 && s.backs.length === 1 && s.drafts.length === 1 && s.threads.length === 1, 'a page that is not its window\'s app opens nothing: ' + JSON.stringify({ v: s.viewed.length, b: s.backs, d: s.drafts.length, t: s.threads.length }));
  ok(!hits.some(p => p.startsWith('/wizard/')), 'no owner route was ever requested: ' + JSON.stringify(hits.filter(p => p.startsWith('/wizard/'))));
  ok(errors.length === 0, 'no page errors: ' + JSON.stringify(errors));
  if (process.env.QA_SHOTS) { fs.mkdirSync(process.env.QA_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.QA_SHOTS, (process.env.QA_EXPECT === 'broken' ? 'before' : 'after') + '-media-nav.png') }); }
  await browser.close(); server.close();
  const broken = process.env.QA_EXPECT === 'broken';
  console.log(fails.length ? `${fails.length} check(s) failed` : 'all checks passed');
  if (broken) { if (!fails.length) { console.log('expected failures on this build, got none'); process.exit(1); } process.exit(0); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
