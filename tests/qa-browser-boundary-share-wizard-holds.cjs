// Browser QA for the browser owner boundary, slice 18 (wizard-os#133): a sandboxed app shares to Wizard
// (WizardApp.share.wizard) and holds shell updates (WizardApp.update.hold) over the boundary channel. Real Chromium: a
// shell page with the boundary on (WizShellBoundary set the way shell-token.js does), the real core/browser-boundary.js
// and core/app-services.js, and app pages in sandboxed frames that load the real core/app-client.js. The shell's Send
// to <agent> sheet (WizShareWizard) is a recorded stand-in: the owner's Send is a call from the test.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-share-wizard-holds.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><button id="wiz">Send to Wizard</button><button id="hold">Hold</button><button id="free">Release</button><script>
  window.results = {}; let h = null;
  (async () => {
    await WizardApp.ready?.();
    // No tap: a page alone can't open the shell's Send to sheet.
    try { results.untapped = await WizardApp.share.wizard({ text: 'sneaky' }); } catch (e) { results.untapped = 'error:' + (e.code || e.message); }
    results.ready = true;
  })();
  document.getElementById('wiz').onclick = async () => {
    try { results.wiz = await WizardApp.share.wizard({ text: 'Buy milk', title: 'Note', files: [new File(['1234'], 'list.txt', { type: 'text/plain' })] }); }
    catch (e) { results.wiz = 'error:' + (e.code || e.message); }
  };
  document.getElementById('hold').onclick = () => { h = WizardApp.update.hold('Unsaved note'); results.held = true; };
  document.getElementById('free').onclick = () => { h?.release(); results.freed = true; };
</script></body></html>`;
// Not the installed app it claims to be (outside that app's path): same calls, with a real tap.
const EVIL = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><button id="wiz">Send</button><script>window.results = {};
  (async () => { await WizardApp.ready?.(); WizardApp.update.hold('forever'); results.ready = true; })();
  document.getElementById('wiz').onclick = async () => { try { results.wiz = await WizardApp.share.wizard({ text: 'pwn' }); } catch (e) { results.wiz = 'error'; } };
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>window.sheets = [];
  const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } };
  // The shell's Send to <agent> sheet: it shows what the app sent; the owner's Send (sheets[i].send()) sends only if the
  // shell still trusts the window.
  window.WizShareWizard = { valid: d => { if (!d?.files?.length && !d?.text?.trim()) throw new Error('Nothing to share'); return d; },
    wizard: (d, authorize) => new Promise(resolve => sheets.push({  text: d.text, title: d.title, files: (d.files || []).map(f => f.name + ':' + f.size),
      send() { const ok = authorize(); resolve(ok ? 'sent' : 'unsupported'); return ok; } })) };</script>
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
  window.holds = () => WizAppServices.inspect().map(x => x.appId + ':' + x.holds.join('|'));
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
  const shellUntil = async (fn, ms = 4000) => { for (let t = 0; t < ms; t += 100) { const r = await page.evaluate(fn).catch(() => null); if (r) return r; await page.waitForTimeout(100); } return null; };
  // The shell loads the Notes window again; resolves once the new document answered on its new channel.
  const reload = () => page.evaluate(() => new Promise(r => { const f = document.querySelector('iframe'); f.addEventListener('wizard:boundary-ready', r, { once: true }); f.src = f.src; }));
  await until('/notes/', () => results.ready);
  await until('/evil/', () => results.ready);
  ok(await frameOf('/notes/').evaluate(() => self.origin) === 'null', 'the app page is opaque');
  const r1 = await frameOf('/notes/').evaluate(() => results.untapped);
  ok(/^error:/.test(String(r1)) && (await page.evaluate(() => sheets.length)) === 0, 'without a tap the Send to sheet does not open: ' + JSON.stringify(r1));
  // A real tap opens the shell's own sheet with the app's text and file; the owner's Send sends it.
  await frameOf('/notes/').click('#wiz');
  const sheet = await shellUntil(() => sheets[0]);
  ok(sheet && sheet.text === 'Buy milk' && sheet.title === 'Note' && sheet.files[0] === 'list.txt:4', 'a real tap opens the shell\'s Send to sheet with the app\'s text and file: ' + JSON.stringify(sheet));
  const whileOpen = await page.evaluate(() => holds());
  ok(whileOpen.includes('notes:Share to Wizard') && await page.evaluate(() => WizAppServices.update.busy()), 'a shell update waits while the sheet is open: ' + JSON.stringify(whileOpen));
  await page.evaluate(() => sheets[0]?.send());
  const wiz = await until('/notes/', () => results.wiz);
  ok(wiz === 'sent', 'the app learns only the outcome: ' + JSON.stringify(wiz));
  // Update holds: the app's unsaved work makes the shell wait; releasing ends it; a reload of the window ends it too.
  await frameOf('/notes/').click('#hold');
  const held = await shellUntil(() => holds().includes('notes:Unsaved note') && holds());
  ok(!!held && await page.evaluate(() => WizAppServices.update.busy()), 'a sandboxed app\'s hold makes a shell update wait: ' + JSON.stringify(held));
  await frameOf('/notes/').click('#free');
  const freed = await shellUntil(() => holds().includes('notes:') && holds());
  ok(!!freed, 'releasing it lets the update go: ' + JSON.stringify(freed));
  await frameOf('/notes/').click('#hold');
  await shellUntil(() => holds().includes('notes:Unsaved note'));
  // The owner moves on to the shell (the new document asks for a sheet on load; without a tap in it, it gets none).
  await page.click('#shellbtn');
  await reload();
  const afterReload = await page.evaluate(() => holds());
  ok(afterReload.includes('notes:'), 'a new document in the window ends the old one\'s holds: ' + JSON.stringify(afterReload));
  // A Send that the owner taps after the window loaded another document does nothing.
  await frameOf('/notes/').click('#wiz');
  await shellUntil(() => sheets[1]);
  // The owner moves on to the shell (the new document asks for a sheet on load; without a tap in it, it gets none).
  await page.click('#shellbtn');
  await reload();
  const kept = await page.evaluate(() => holds());
  ok(kept.includes('notes:Share to Wizard'), 'the open sheet still holds updates after the window reloaded: ' + JSON.stringify(kept));
  const late = await page.evaluate(() => sheets[1]?.send());
  ok(late === false, 'Send after the window loaded another document does not send');
  // The page that is not its window's installed app: no hold, no sheet, even with a real tap.
  await frameOf('/evil/').click('#wiz');
  const evil = await until('/evil/', () => results.wiz);
  const evilHolds = await page.evaluate(() => holds());
  ok(evil === 'error' && (await page.evaluate(() => sheets.length)) === 2 && evilHolds.includes('other:'), 'a page outside its app\'s path can\'t open the sheet or hold updates: ' + JSON.stringify({ evil, evilHolds }));
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
