// Browser QA: an app's saved settings survive the box turning the browser boundary on (wizard-ux#1426, wizard-os#133).
// Real Chromium, the real core/app-services.js, core/browser-boundary.js and core/app-client.js (the shell page and app
// windows copy tests/qa-browser-boundary-idb-carry.cjs). Before the boundary, an app's page kept its settings in this
// origin's own localStorage (Wizard Music's unfinished recording, `wizard-music.identify.active.v1`). Its sandboxed page
// gets the shell's copy instead, which started empty, so the settings were back at their defaults. Now the shell notes
// which app wrote which key while its window was same-origin and copies a key once to the one app that alone wrote it.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-ls-carry.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOT_BEFORE / QA_SHOT_AFTER=<file.png>: the app window with the boundary off, then on.
//   QA_SHOT_AGAIN=<file.png>: on again after a change made with the boundary off (wizard-ux#1434).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const EXPECT_BROKEN = process.env.QA_EXPECT === 'broken';
const ACTIVE = 'wizard-music.identify.active.v1';
// The app keeps its settings in localStorage the way Wizard Music does and calls ready().
const APP = name => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{margin:0;padding:18px 22px;font:15px system-ui;background:#fbfaf7;color:#1d1b22}h1{font-size:19px;margin:0 0 10px}
.row{margin:8px 0;padding:10px 12px;border-radius:10px;background:#efece4}.bad{background:#fde3e1;color:#8a1c12}b{font-weight:600}</style></head>
<body><h1>${name} <small></small></h1><div id="out"></div><script>
  document.querySelector('h1 small').textContent = self.origin === 'null' ? '(boundary on)' : '(boundary off)';
  // Written while the page starts, before it says hello to the shell (a named write, not setItem).
  if (location.search.includes('early')) localStorage['${name.toLowerCase()}.early'] = 'yes';
  try { WizardApp.ready({ name: '${name}' }); } catch (_) {}
  window.show = () => {
    const a = localStorage.getItem('${ACTIVE}'), v = localStorage.getItem('wizard-music.volume');
    document.getElementById('out').innerHTML = a
      ? '<div class="row">Unfinished recording: <b>' + JSON.parse(a).title + '</b> · tap to pick it up</div><div class="row">Volume: <b>' + (v || 'default') + '</b></div>'
      : '<div class="row bad">No unfinished recording (settings back at their defaults)</div><div class="row">Volume: <b>' + (v || 'default') + '</b></div>';
    const all = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); all[k] = localStorage.getItem(k); }
    return all;
  };
</script></body></html>`;
const SHELL = on => `<!doctype html><html><head><meta charset="utf-8">
${on ? "<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>" : "<script>localStorage.removeItem('wos.browser-boundary.v1');</script>"}
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>const APPS = [{ id: 'music', kind: 'wizard', url: '/music/', name: 'Music' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } }; window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{margin:0;background:#16121f;padding:14px}.win{margin:0 0 10px;border-radius:12px;overflow:hidden;width:440px;background:#fff}
.wbar{height:28px;background:#2b2440;color:#fff;font:13px system-ui;display:flex;align-items:center;padding:0 10px}iframe{width:440px;height:170px;border:0;display:block}</style></head>
<body><div id="desk"></div><script>
  const B = window.WizBrowserBoundary;
  window.openWin = (id, key, q = '') => {
    const url = '/' + id + '/', w = document.createElement('div'); w.className = 'win'; w.id = 'w-' + key;
    w.innerHTML = '<header class="wbar">' + id + '</header><iframe class="appframe" ' + (B ? B.frameAttributes(url, id) : '') + ' src="' + url + q + '"></iframe>';
    document.getElementById('desk').appendChild(w);
    WizAppServices.attach(w.querySelector('iframe'), { appId: id, path: url, isVisible: () => true });
    return w.id;
  };
</script></body></html>`;
const html = (res, body) => { res.setHeader('content-type', 'text/html'); res.end(body); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') return html(res, SHELL(false));
  if (u.pathname === '/on') return html(res, SHELL(true));
  if (u.pathname === '/music/') return html(res, APP('Music'));
  if (u.pathname === '/other/') return html(res, APP('Other'));
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
  const page = await browser.newPage({ viewport: { width: 470, height: 230 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  const frameOf = async key => (await page.$('#w-' + key + ' iframe')).contentFrame();
  const open = async (id, key, q) => { await page.evaluate(([i, k, s]) => openWin(i, k, s), [id, key, q]); await page.waitForTimeout(500); return frameOf(key); };
  const caught = e => 'threw ' + String(e?.message || e).split('\n')[0];

  // 1. Boundary off (today): Music saves an unfinished recording (setItem) and a volume (a named write), and writes a
  // key two apps use and one of the shell's own keys; Other saves its own setting and the shared key. Then the shell
  // writes its own key (a value the app must never get).
  await page.goto(base + '/');
  const m = await open('music', 'm', '?early=1');
  ok(await m.evaluate(() => self.origin) !== 'null', 'with the boundary off the app page is same-origin');
  await m.evaluate(a => {
    localStorage.setItem(a, JSON.stringify({ title: 'Cafe song', at: 1 }));
    localStorage['wizard-music.volume'] = '7';
    localStorage.setItem('shared.k', 'from music');
    localStorage.setItem('wos.theme', 'from music');
    localStorage.setItem('gone.k', 'x');
    show();
  }, ACTIVE);
  await page.waitForTimeout(200);
  if (process.env.QA_SHOT_BEFORE) await page.screenshot({ path: process.env.QA_SHOT_BEFORE });
  const o = await open('other', 'o');
  await o.evaluate(() => { localStorage.setItem('other.k', 'mine'); localStorage.setItem('shared.k', 'from other'); });
  await page.evaluate(() => localStorage.setItem('wos.theme', 'the shell\u2019s'));
  await page.waitForTimeout(200);
  await m.evaluate(() => localStorage.removeItem('gone.k'));

  // 2. The box turns the boundary on. Music's sandboxed page reads its settings.
  await page.goto(base + '/on');
  const m2 = await open('music', 'm');
  ok(await m2.evaluate(() => self.origin) === 'null', 'with the boundary on the app page is opaque');
  const seen = await m2.evaluate(() => show()).catch(caught);
  await page.waitForTimeout(100);
  if (process.env.QA_SHOT_AFTER) await page.screenshot({ path: process.env.QA_SHOT_AFTER });
  ok(seen?.[ACTIVE] && JSON.parse(seen[ACTIVE]).title === 'Cafe song', 'Music still has its unfinished recording: ' + JSON.stringify(seen));
  ok(seen?.['wizard-music.volume'] === '7', 'and its volume, saved with a named write: ' + seen?.['wizard-music.volume']);
  ok(seen?.['music.early'] === 'yes', 'and a setting written before the page said hello: ' + seen?.['music.early']);
  ok(seen && !('shared.k' in seen) && !('other.k' in seen), 'a key two apps wrote goes to neither, another app\u2019s key never comes along');
  ok(seen && !Object.keys(seen).some(k => /^wos/i.test(k) || /^wux\./.test(k)), 'none of the shell\u2019s own keys come along, even one the app page wrote: ' + Object.keys(seen || {}).join());
  ok(seen && !('gone.k' in seen), 'a key the app removed before the switch stays gone');
  const o2 = await open('other', 'o');
  const otherSees = await o2.evaluate(() => show()).catch(caught);
  ok(otherSees && otherSees['other.k'] === 'mine' && Object.keys(otherSees).length === 1, 'Other gets only its own setting: ' + JSON.stringify(otherSees));

  // 3. Copied once: a setting Music removes now stays removed after a reload; a new value is its own.
  await m2.evaluate(() => { localStorage.removeItem('wizard-music.volume'); localStorage.setItem('wizard-music.identify.active.v1', JSON.stringify({ title: 'Car radio', at: 2 })); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelector('#w-m iframe').src = '/music/?r=1'; });
  await page.waitForTimeout(700);
  await page.goto(base + '/on');
  const m3 = await open('music', 'm');
  const after = await m3.evaluate(() => show()).catch(caught);
  ok(after && !('wizard-music.volume' in after) && JSON.parse(after[ACTIVE] || '{}').title === 'Car radio', 'a setting removed after the copy stays removed, a newer value wins: ' + JSON.stringify(after));

  // 4. The old keys are left as they were: the boundary off again shows the old values.
  await page.goto(base + '/');
  const m4 = await open('music', 'm');
  const old = await m4.evaluate(a => [JSON.parse(localStorage.getItem(a)).title, localStorage.getItem('wizard-music.volume'), localStorage.getItem('wos.theme')], ACTIVE).catch(caught);
  ok(Array.isArray(old) && old[0] === 'Cafe song' && old[1] === '7' && old[2] === 'the shell\u2019s', 'the old settings are untouched: ' + JSON.stringify(old));

  // 5. Off -> change -> on (wizard-ux#1434): with the boundary off Music saves a new recording (setItem), a volume (a
  // named write) and removes a copied setting; turned on again, its sandboxed page sees those newer values.
  await m4.evaluate(a => {
    localStorage.setItem(a, JSON.stringify({ title: 'Train song', at: 3 }));
    localStorage['wizard-music.volume'] = '5';
    localStorage.removeItem('music.early');
  }, ACTIVE);
  await page.waitForTimeout(300);
  await page.goto(base + '/on');
  const m5 = await open('music', 'm');
  const again = await m5.evaluate(() => show()).catch(caught);
  await page.waitForTimeout(100);
  if (process.env.QA_SHOT_AGAIN) await page.screenshot({ path: process.env.QA_SHOT_AGAIN });
  ok(again && JSON.parse(again[ACTIVE] || '{}').title === 'Train song', 'a value set while the boundary was off comes along on the next turn-on: ' + JSON.stringify(again));
  ok(again?.['wizard-music.volume'] === '5', 'so does a named write made while off: ' + again?.['wizard-music.volume']);
  ok(again && !('music.early' in again), 'and a removal made while off');

  ok(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close(); server.close();
  if (EXPECT_BROKEN) { console.log(fails.length ? `As expected, ${fails.length} check(s) fail here.` : 'Expected failures, but everything passed.'); process.exit(fails.length ? 0 : 1); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
