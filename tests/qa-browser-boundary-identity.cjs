// Browser QA for the browser owner boundary, slice 22 (wizard-os#133): a sandboxed app uses Wizard ID again.
// Real Chromium: a shell page with the boundary on (WizShellBoundary set the way shell-token.js does), the real
// core/browser-boundary.js and core/app-services.js, and app pages in sandboxed frames that load the real
// core/app-client.js and call WizardApp.identity.*.
// The phone's device envelope (core/bridge.js -> Android DeviceBridge, whose own approval sheet asks the owner) is a
// stand-in that records what the shell asked it.
//  - info / sign / nip44_encrypt / nip44_decrypt reach the phone with the catalog's name for the app (never the name
//    the page gives), and the app gets back only the public info, the signed event or the NIP-44 result.
//  - A refused approval reaches the app as { denied: true }.
//  - An app the catalog did not install from apps.json (an owner link) is refused, and the phone is never asked.
//  - A page outside its window's app path gets nothing, and the phone is never asked.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-identity.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
const APP = who => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{font:14px system-ui;margin:8px}</style></head>
<body><p id="t">${who}</p><script>
  window.out = {};
  const say = s => { document.getElementById('t').textContent = '${who}: ' + s; };
  const code = e => 'error:' + ((e && e.code) || String(e && e.message));
  window.run = async () => {
    await WizardApp.ready();
    try { out.info = await WizardApp.identity.info(); } catch (e) { out.info = code(e); }
    try { out.sign = await WizardApp.identity.sign({ kind: 1, tags: [], content: 'hello from ${who}', requester: 'Your bank' }); } catch (e) { out.sign = code(e); }
    try { out.denied = await WizardApp.identity.sign({ kind: 1, tags: [], content: 'deny me' }); } catch (e) { out.denied = code(e); }
    try { out.enc = await WizardApp.identity.nip44_encrypt({ pubkey: 'c'.repeat(64), plaintext: 'secret note' }); } catch (e) { out.enc = code(e); }
    try { out.dec = await WizardApp.identity.nip44_decrypt({ pubkey: 'c'.repeat(64), ciphertext: out.enc && out.enc.ciphertext }); } catch (e) { out.dec = code(e); }
    say('signed ' + (out.sign && out.sign.sig ? 'yes' : JSON.stringify(out.sign)) + ', opened ' + JSON.stringify(out.dec && out.dec.plaintext));
    return out;
  };
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>
  const APPS = [{ id: 'notes', kind: 'wizard', source: 'apps.json', url: '/notes/', name: 'Notes' },
    { id: 'linked', kind: 'wizard', source: 'link', url: '/linked/', name: 'Linked' },
    { id: 'other', kind: 'wizard', source: 'apps.json', url: '/other/', name: 'Other' }];
  window.shellLog = [];
  const hex = (c, n) => c.repeat(n);
  // The phone's device envelope: answers like Android DeviceBridge after the owner approves on its own sheet.
  window.wizardDevicePort = { postMessage() {} };
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} }, bridge: { call: async (method, params) => {
    shellLog.push([method, params.requester]);
    if (method === 'identity.info') return { npub: 'npub1owner', pubkey: hex('b', 64), name: 'Owner', backed_up: true, secretKey: 'never' };
    if (method === 'identity.sign') {
      if (params.event.content === 'deny me') return { denied: true };
      return { id: hex('a', 64), pubkey: hex('b', 64), created_at: 1700000000, kind: params.event.kind, tags: params.event.tags, content: params.event.content, sig: hex('d', 128), requester: params.requester };
    }
    if (method === 'identity.nip44_encrypt') return { ciphertext: 'AQ' + btoa(params.plaintext), conversationKey: 'never' };
    if (method === 'identity.nip44_decrypt') return { plaintext: atob(String(params.ciphertext).slice(2)) };
    throw new Error('unknown method');
  } } };
  window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{font:14px system-ui}iframe{width:440px;height:40px;border:1px solid #888;display:block}</style></head>
<body><div class="win" id="w1"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<div class="win" id="w2"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/linked/"></iframe></div>
<div class="win" id="w3"><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/evil/"></iframe></div>
<script>
  const [a, b, c] = document.querySelectorAll('iframe');
  WizAppServices.attach(a, { appId: 'notes', path: '/notes/', isVisible: () => true, isFront: () => true });
  WizAppServices.attach(b, { appId: 'linked', path: '/linked/', isVisible: () => true, isFront: () => true });
  // The third window claims to be "other" but its frame shows a page outside that app's path.
  WizAppServices.attach(c, { appId: 'other', path: '/other/', isVisible: () => true, isFront: () => true });
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = body => { res.setHeader('content-type', 'text/html'); res.end(body); };
  if (u.pathname === '/') return html(SHELL);
  if (u.pathname === '/notes/') return html(APP('Notes'));
  if (u.pathname === '/linked/') return html(APP('Linked'));
  if (u.pathname === '/evil/') return html(APP('Evil'));
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
  const page = await browser.newPage({ viewport: { width: 470, height: 150 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const frameOf = p => page.frames().find(fr => fr.url().endsWith(p));
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(f => WizBrowserBoundary.ready(f)), null, { timeout: 6000 }).catch(() => {});
  const origin = await frameOf('/notes/').evaluate(() => self.origin);
  ok(origin === 'null', 'the app page is opaque (origin ' + origin + ')');
  if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-before.png') });
  const out = await frameOf('/notes/').evaluate(() => run()).catch(e => ({ error: String(e) }));
  const log = () => page.evaluate(() => JSON.parse(JSON.stringify(shellLog)));
  let l = await log();
  ok(JSON.stringify(out.info) === JSON.stringify({ npub: 'npub1owner', pubkey: 'b'.repeat(64), name: 'Owner', backed_up: true }), 'identity.info: only the owner\'s public info crosses: ' + JSON.stringify(out.info));
  ok(out.sign && out.sign.sig === 'd'.repeat(128) && out.sign.content === 'hello from Notes' && !('requester' in out.sign), 'identity.sign: the app gets its signed event, nothing else: ' + JSON.stringify(out.sign));
  ok(JSON.stringify(out.denied) === '{"denied":true}', 'a refused approval reaches the app as denied: ' + JSON.stringify(out.denied));
  ok(out.enc && typeof out.enc.ciphertext === 'string' && Object.keys(out.enc).length === 1, 'nip44_encrypt: only the ciphertext crosses: ' + JSON.stringify(out.enc));
  ok(out.dec && out.dec.plaintext === 'secret note', 'nip44_decrypt opens it again: ' + JSON.stringify(out.dec));
  ok(l.length === 5 && l.every(x => x[1] === 'Notes'), 'every call reached the phone with the catalog\'s name for the app (never "Your bank"): ' + JSON.stringify(l));
  if (SHOT) await page.screenshot({ path: SHOT });
  // An app installed some other way than apps.json (an owner link) is refused; the phone is never asked.
  const linked = await frameOf('/linked/').evaluate(() => run()).catch(e => ({ error: String(e) }));
  l = await log();
  ok(String(linked.info).startsWith('error:') && String(linked.sign).startsWith('error:') && l.length === 5, 'an app not installed from apps.json gets no Wizard ID: ' + JSON.stringify({ info: linked.info, sign: linked.sign, phone: l.length }));
  // The page outside its window's app path gets nothing, and the phone is never asked for it.
  const evil = await frameOf('/evil/').evaluate(() => run()).catch(e => ({ error: String(e) }));
  l = await log();
  ok(String(evil.info).startsWith('error:') && String(evil.sign).startsWith('error:') && String(evil.enc).startsWith('error:') && l.length === 5,
    'a page outside its app\'s path can\'t reach Wizard ID: ' + JSON.stringify({ info: evil.info, sign: evil.sign, phone: l.length }));
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
