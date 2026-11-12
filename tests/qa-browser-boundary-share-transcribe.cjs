// Browser QA for the browser owner boundary, slice 17 (wizard-os#133): a sandboxed app shares out (WizardApp.share.text,
// WizardApp.share.file) and transcribes (WizardApp.voice.transcribe) over the boundary channel. Real Chromium: a shell
// page with the boundary on (WizShellBoundary set the way shell-token.js does), the real core/browser-boundary.js and
// core/app-services.js, and app pages in sandboxed frames that load the real core/app-client.js. The shell's share
// sheet (WosChat) and the box's transcriber (WizConfig.transcribe) are recorded stand-ins.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-share-transcribe.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><button id="share">Share</button><button id="file">Share file</button><script>
  window.results = {};
  const note = () => ({ text: 'Buy milk', title: 'Note', url: 'note/7' });
  (async () => {
    await WizardApp.ready?.();
    // No tap: a page alone can't open the shell's share sheet.
    results.untapped = await WizardApp.share.text(note());
    try { results.heard = await WizardApp.voice.transcribe(new Blob(['abcde'], { type: 'audio/webm' }), { language: 'en' }); } catch (e) { results.heard = 'error:' + e.message; }
    results.ready = true;
  })();
  document.getElementById('share').onclick = async () => { results.tapped = await WizardApp.share.text(note()); };
  document.getElementById('file').onclick = async () => { results.file = await WizardApp.share.file(new File(['12345678'], 'list.txt', { type: 'text/plain' }), { title: 'List' }); };
  // Asks later, after the owner tapped somewhere else in the shell.
  window.later = () => setTimeout(async () => { results.later = await WizardApp.share.text({ text: 'sneaky' }); }, 400);
  window.burst = async n => { const out = []; for (let i = 0; i < n; i++) { try { await WizardApp.voice.transcribe(new Blob(['x'], { type: 'audio/webm' })); out.push('ok'); } catch (e) { out.push(e.message); } } return out; };
</script></body></html>`;
// Not the installed app it claims to be (outside that app's path): same calls, with a real tap.
const EVIL = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><button id="share">Share</button><script>window.results = {};
  (async () => { await WizardApp.ready?.();
    try { results.heard = await WizardApp.voice.transcribe(new Blob(['abc'], { type: 'audio/webm' })); } catch (e) { results.heard = 'error'; }
    results.ready = true; })();
  document.getElementById('share').onclick = async () => { results.tapped = await WizardApp.share.text({ text: 'pwn' }); };
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>window.counts = {}; window.shared = []; window.heard = [];
  const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount: (k, n) => { counts[k] = n; } } };
  // The shell's share sheet: the owner picks a target there; here it records what it was asked to show.
  window.WosChat = { sharePayload: async p => { shared.push({ kind: 'text', ...p }); return 'shared'; },
    shareFile: async (f, o) => { shared.push({ kind: 'file', name: f.name, size: f.size, title: o?.title, direct: o?.direct }); return 'shared'; } };
  window.WizConfig = { stripAddress: s => s, ready: Promise.resolve(), voicePrompt: () => '',
    transcribe: async (file, o) => { heard.push({ size: file.size, language: o.language }); return { text: 'heard ' + file.size }; } };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>iframe{width:400px;height:80px;border:0}</style></head>
<body><button id="shellbtn">Shell button</button><div class="win" id="w1"><header class="wbar"><span>Notes</span></header>
<iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<div class="win" id="w2"><header class="wbar"><span>Other</span></header>
<iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/evil/"></iframe></div>
<script>
  const [a, b] = document.querySelectorAll('iframe');
  WizAppServices.attach(a, { appId: 'notes', path: '/notes/', isVisible: () => true });
  WizAppServices.attach(b, { appId: 'other', path: '/other/', isVisible: () => true });
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = body => { res.setHeader('content-type', 'text/html'); res.end(body); };
  if (u.pathname === '/') return html(SHELL);
  if (u.pathname === '/notes/') return html(APP);
  if (u.pathname === '/evil/') return html(EVIL);
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
  const page = await browser.newPage({ viewport: { width: 460, height: 360 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const frameOf = p => page.frames().find(fr => fr.url().endsWith(p));
  const until = async (p, fn, ms = 6000) => { for (let t = 0; t < ms; t += 100) { const r = await frameOf(p).evaluate(fn).catch(() => null); if (r) return r; await page.waitForTimeout(100); } return null; };
  await until('/notes/', () => results.ready);
  await until('/evil/', () => results.ready);
  ok(await frameOf('/notes/').evaluate(() => self.origin) === 'null', 'the app page is opaque');
  const r1 = await frameOf('/notes/').evaluate(() => results);
  const sh1 = await page.evaluate(() => shared);
  ok(r1.untapped === 'unsupported' && sh1.length === 0, 'without a tap the share sheet does not open: ' + JSON.stringify({ r: r1.untapped, shared: sh1 }));
  ok(r1.heard && r1.heard.text === 'heard 5', 'the app gets its transcript from the box\'s transcriber: ' + JSON.stringify(r1.heard));
  // A real tap in the app opens the shell's share sheet with the app's text; a relative link resolves inside the app.
  await frameOf('/notes/').click('#share');
  const tapped = await until('/notes/', () => results.tapped);
  const sh2 = await page.evaluate(() => shared);
  ok(tapped === 'shared' && sh2.length === 1 && sh2[0].text === 'Buy milk' && sh2[0].url === base + '/notes/note/7' && !('direct' in sh2[0]),
    'a real tap opens the shell\'s share sheet (never direct) with the app\'s text: ' + JSON.stringify({ tapped, shared: sh2 }));
  await frameOf('/notes/').click('#file');
  const file = await until('/notes/', () => results.file);
  const sh3 = await page.evaluate(() => shared.at(-1));
  ok(file === 'shared' && sh3.kind === 'file' && sh3.size === 8 && sh3.name === 'list.txt' && sh3.title === 'List' && sh3.direct === false,
    'a file share opens the shell\'s sheet with the app\'s file: ' + JSON.stringify({ file, sh3 }));
  // A tap elsewhere in the shell activates the shell too; the app asking right then still gets nothing.
  await frameOf('/notes/').evaluate(() => later());
  await page.click('#shellbtn');
  const later = await until('/notes/', () => results.later);
  const shLater = await page.evaluate(() => shared.length);
  ok(later === 'unsupported' && shLater === 2, 'a tap outside the app window does not let the app open the share sheet: ' + JSON.stringify({ later, shared: shLater }));
  // The page that is not its window's installed app gets nothing, even with a real tap.
  const evilHeard = await frameOf('/evil/').evaluate(() => results.heard);
  await frameOf('/evil/').click('#share');
  const evilShare = await until('/evil/', () => results.tapped);
  const sh4 = await page.evaluate(() => shared.length);
  ok(evilHeard === 'error' && evilShare === 'unsupported' && sh4 === 2, 'a page outside its app\'s path can\'t share or transcribe: ' + JSON.stringify({ evilHeard, evilShare, shared: sh4 }));
  // Budget: 30 files in 10 minutes per app (one was used above).
  const burst = await frameOf('/notes/').evaluate(() => burst(31));
  const okCount = burst.filter(x => x === 'ok').length;
  ok(okCount === 29 && /budget/.test(burst.at(-1)), 'the per-app transcription budget stops a burst: ' + okCount + ' ok, last ' + JSON.stringify(burst.at(-1)));
  const heardCount = await page.evaluate(() => heard.length);
  ok(heardCount === 30, 'the transcriber ran only within the budget: ' + heardCount);
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
