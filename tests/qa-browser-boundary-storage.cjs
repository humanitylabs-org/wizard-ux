// Browser QA for a sandboxed app's own saved settings (wizard-os#133, slice 34).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js and core/app-services.js; app
// windows made the way app.js / desktop.js make them (frameAttributes(url, appId) in the markup), whose pages load the
// real core/app-client.js. The browser refuses localStorage to an opaque page; with the app kit's stand-in the app
// reads and writes it as before, keeps it across a reload in the window and a new window, and only for its own app id.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-storage.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOT=<file.png>: a screenshot of the reopened app window.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
// The app reads its saved settings while it loads, before anything else (the usual way apps do it).
const APP = name => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{margin:0;padding:18px 22px;font:15px system-ui;background:#fbfaf7;color:#1d1b22}h1{font-size:19px;margin:0 0 10px}
.row{margin:8px 0;padding:10px 12px;border-radius:10px;background:#efece4}.bad{background:#fde3e1;color:#8a1c12}b{font-weight:600}</style></head>
<body><h1>${name}</h1><div id="out"></div><script>
  window.atLoad = {};
  try { atLoad.draft = localStorage.getItem('notes.draft'); atLoad.mode = localStorage.mode ?? null; atLoad.tab = sessionStorage.getItem('tab'); atLoad.keys = Object.keys(localStorage).sort(); }
  catch (e) { atLoad.error = e.name; }
  window.events = 0; addEventListener('storage', () => { events++; show(); });
  function show() {
    let draft = null, err = atLoad.error; try { draft = localStorage.getItem('notes.draft'); } catch (e) { err = e.name; }
    document.getElementById('out').innerHTML = err ? '<div class="row bad">Saved settings don\\u2019t work in this window (' + err + ').</div>'
      : '<div class="row">Draft kept from last time: <b>' + (draft ?? 'none') + '</b></div><div class="row">Theme: <b>' + (localStorage.mode ?? 'default') + '</b></div>';
  }
  show();
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } }; window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{margin:0;background:#16121f;padding:14px}.win{margin:0 0 10px;border-radius:12px;overflow:hidden;width:440px;background:#fff}
.wbar{height:28px;background:#2b2440;color:#fff;font:13px system-ui;display:flex;align-items:center;padding:0 10px}iframe{width:440px;height:150px;border:0;display:block}</style></head>
<body><div id="desk"></div><script>
  const B = window.WizBrowserBoundary;
  // A window the way app.js / desktop.js render it: the frame's attributes are in the markup.
  window.openWin = (id, url, path, opts = {}) => {
    const attrs = opts.plain ? 'sandbox="' + B.sandbox + '"' : B.frameAttributes(url, id);
    const w = document.createElement('div'); w.className = 'win'; w.id = 'w-' + id + (opts.tag || '');
    w.innerHTML = '<header class="wbar">' + id + '</header><iframe class="appframe" ' + attrs + ' src="' + url + '"></iframe>';
    document.getElementById('desk').appendChild(w);
    const f = w.querySelector('iframe'); w.detach = WizAppServices.attach(f, { appId: id, path, isVisible: () => true });
    return w.id;
  };
  window.closeWin = wid => { const w = document.getElementById(wid); w.detach(); w.remove(); };
  window.saved = id => localStorage.getItem('wos.app-storage.v1.' + id);
</script></body></html>`;
const AWAY = '<!doctype html><script>window.seen = window.name;</script><p>another site</p>';
const html = (res, body) => { res.setHeader('content-type', 'text/html'); res.end(body); };
let awayHits = 0;
const away = http.createServer((req, res) => { awayHits++; html(res, AWAY); });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') return html(res, SHELL);
  if (u.pathname === '/notes/') return html(res, APP('Notes'));
  if (u.pathname === '/other/') return html(res, APP('Other'));
  if (u.pathname === '/evil/') return html(res, APP('Evil'));
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  await new Promise(r => away.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`, awayUrl = `http://localhost:${away.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 470, height: 230 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const win = async wid => { const h = await page.$('#' + wid + ' iframe'); return h ? h.contentFrame() : null; };
  const until = async (fn, ms = 4000) => { for (let i = 0; i < ms / 50; i++) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(50); } return false; };
  // 1. A first window: nothing saved yet. The page uses its storage like a same-origin app.
  const w1 = await page.evaluate(() => openWin('notes', '/notes/', '/notes/'));
  await page.waitForTimeout(300);
  let f = await win(w1);
  const origin = await f.evaluate(() => self.origin);
  ok(origin === 'null', 'the app page is opaque (origin ' + origin + ')');
  const first = await f.evaluate(() => atLoad);
  ok(!first.error && first.draft === null, 'the app reads its saved settings without an error: ' + JSON.stringify(first));
  const wrote = await f.evaluate(() => { try { localStorage.setItem('notes.draft', 'Buy figs'); localStorage.mode = 'dark'; sessionStorage.setItem('tab', '2'); localStorage.setItem('gone', 'x'); localStorage.removeItem('gone');
    return { draft: localStorage.getItem('notes.draft'), mode: localStorage.getItem('mode'), len: localStorage.length, key0: localStorage.key(0), keys: Object.keys(localStorage) }; } catch (e) { return { error: e.name }; } });
  ok(wrote.draft === 'Buy figs' && wrote.mode === 'dark' && wrote.len === 2 && wrote.key0 === 'notes.draft' && JSON.stringify(wrote.keys) === '["notes.draft","mode"]', 'setItem, named access, key(), length and removeItem work: ' + JSON.stringify(wrote));
  await until(() => page.evaluate(() => !!saved('notes')));
  const kept = JSON.parse(await page.evaluate(() => saved('notes')) || 'null');
  ok(kept && kept['notes.draft'] === 'Buy figs' && kept.mode === 'dark' && !('gone' in kept) && !('tab' in kept), 'the shell keeps the app\'s localStorage under its own app id (sessionStorage stays in the window): ' + JSON.stringify(kept));
  // 2. A reload inside the window keeps both, already while the page loads.
  await f.evaluate(() => location.reload());
  await page.waitForTimeout(400); f = await win(w1);
  const reloaded = await f.evaluate(() => atLoad);
  ok(reloaded.draft === 'Buy figs' && reloaded.mode === 'dark' && reloaded.tab === '2', 'after a reload in the window the page reads them while it loads: ' + JSON.stringify(reloaded));
  // 3. Close the window and open the app again: a new window starts with them (sessionStorage starts empty).
  await page.evaluate(wid => closeWin(wid), w1);
  const w2 = await page.evaluate(() => openWin('notes', '/notes/', '/notes/', { tag: '2' }));
  await page.waitForTimeout(400); f = await win(w2);
  const reopened = await f.evaluate(() => atLoad);
  ok(reopened.draft === 'Buy figs' && reopened.mode === 'dark' && reopened.tab === null, 'a new window of the app reads them while it loads: ' + JSON.stringify(reopened));
  if (SHOT) await page.screenshot({ path: SHOT });
  // 4. A window made without them (no name in the markup) asks once and hears a storage event.
  const w3 = await page.evaluate(() => openWin('notes', '/notes/', '/notes/', { tag: '3', plain: true }));
  const f3 = await win(w3);
  const late = await until(() => f3.evaluate(() => events > 0 && localStorage.getItem('notes.draft') === 'Buy figs'));
  ok(late, 'a window that started without them gets them from the shell, with a storage event');
  // 5. Another app's window sees none of them, and a page outside its app's path cannot save for that app.
  const w4 = await page.evaluate(() => openWin('other', '/other/', '/other/'));
  await page.waitForTimeout(300);
  const other = await (await win(w4)).evaluate(() => atLoad);
  ok(other.draft === null && JSON.stringify(other.keys) === '[]', 'another app\'s window has its own, empty settings: ' + JSON.stringify(other));
  const w5 = await page.evaluate(() => openWin('other', '/evil/', '/other/', { tag: 'evil' }));
  await page.waitForTimeout(300);
  await (await win(w5)).evaluate(() => { try { localStorage.setItem('pwn', '1'); } catch (_) {} });
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => saved('other')) === null, 'a page outside its app\'s path saves nothing for that app');
  // 6. Full: one app's settings are capped like the browser's own (QuotaExceededError, nothing kept).
  f = await win(w2);
  const quota = await f.evaluate(() => { try { localStorage.setItem('big', 'x'.repeat(600 * 1024)); return 'stored'; } catch (e) { try { return e.name + ':' + localStorage.getItem('big'); } catch (e2) { return e2.name; } } });
  ok(quota === 'QuotaExceededError:null', 'a too large value throws QuotaExceededError and is not kept: ' + quota);
  // 7. clear() reaches the shell.
  await f.evaluate(() => localStorage.clear()).catch(() => {});
  ok(await until(() => page.evaluate(() => saved('notes') === null)), 'clear() empties the shell\'s copy');
  await f.evaluate(() => { localStorage.setItem('notes.draft', 'Buy figs'); }).catch(() => {});
  await until(() => page.evaluate(() => !!saved('notes')));
  // 7b. A link to another page of the app itself keeps them while the next page loads.
  await f.evaluate(() => { const a = document.createElement('a'); a.href = '/notes/?page=2'; a.id = 'inapp'; a.textContent = 'next page'; document.body.append(a); });
  await f.click('#inapp'); await page.waitForTimeout(400); f = await win(w2);
  const next = await f.evaluate(() => ({ url: location.search, ...atLoad }));
  ok(next.url === '?page=2' && next.draft === 'Buy figs', 'a link to another page of the app keeps them while it loads: ' + JSON.stringify(next));
  // 8. A link in the page (say, in a note) to another site: since slice 43 it goes to the shell's link rules
  // (link.open) and never takes the window there, so that site never loads in it and cannot read the settings from
  // the window's name; the app keeps them.
  await f.evaluate(u => { const a = document.createElement('a'); a.href = u; a.textContent = 'a link in a note'; document.body.append(a); }, awayUrl);
  await f.click('a');
  await page.waitForTimeout(600);
  const there = await (await win(w2)).evaluate(() => ({ seen: window.seen, url: location.pathname + location.search, draft: localStorage.getItem('notes.draft') })).catch(e => ({ error: e.message }));
  ok(awayHits === 0 && there.seen === undefined && there.url === '/notes/?page=2' && there.draft === 'Buy figs', 'another site never loads in the window, so it does not get them: ' + JSON.stringify({ awayHits, there }));
  // 9. Another app on this host never reads them: a link to its path goes to the shell (link.open) and the window
  // stays; before the shell's hello names the app path, such a link clears the name. Its page drops a name that is not
  // for its own path (here: the window is sent there by script, which a link would have cleared).
  const w6 = await page.evaluate(() => openWin('notes', '/notes/', '/notes/', { tag: '6' }));
  await page.waitForTimeout(300); let f6 = await win(w6);
  await f6.evaluate(() => { const a = document.createElement('a'); a.href = '/other/?via=link'; a.textContent = 'other app'; document.body.append(a); });
  await f6.click('a'); await page.waitForTimeout(400); f6 = await win(w6);
  const viaLink = await f6.evaluate(() => ({ url: location.pathname + location.search, name: window.name, keys: atLoad.keys }));
  ok(viaLink.url === '/notes/' && viaLink.keys.includes('notes.draft'), 'a link to another app on this host never takes the window (and its settings) there: ' + JSON.stringify(viaLink));
  const w7 = await page.evaluate(() => openWin('notes', '/notes/', '/notes/', { tag: '7' }));
  await page.waitForTimeout(300); let f7 = await win(w7);
  await f7.evaluate(() => { location.href = '/other/?via=script'; });
  await page.waitForTimeout(400); f7 = await win(w7);
  const viaScript = await f7.evaluate(() => ({ url: location.pathname + location.search, name: window.name, keys: atLoad.keys, draft: atLoad.draft }));
  ok(viaScript.url === '/other/?via=script' && viaScript.name === '' && viaScript.draft === null, 'another app\'s page drops a name that is not for its own path: ' + JSON.stringify(viaScript));
  // 10. A change the shell cannot keep (all apps' settings full) is undone in the page, with a storage event.
  const w8 = await page.evaluate(() => openWin('notes', '/notes/', '/notes/', { tag: '8' }));
  await page.waitForTimeout(400); const f8 = await win(w8);
  await page.evaluate(() => localStorage.setItem('wos.app-storage.v1.filler', JSON.stringify({ k: 'y'.repeat(1530 * 1024) })));
  await f8.evaluate(() => { window.events = 0; try { localStorage.setItem('fill', 'z'.repeat(60 * 1024)); } catch (_) {} });
  const undone = await until(() => f8.evaluate(() => events > 0 && localStorage.getItem('fill') === null && localStorage.getItem('notes.draft') === 'Buy figs'));
  ok(undone && !JSON.parse(await page.evaluate(() => saved('notes')) || '{}').fill, 'a change the shell could not keep is undone in the page (storage event), the rest stays');
  await page.evaluate(() => localStorage.removeItem('wos.app-storage.v1.filler'));
  ok(!errors.length, 'no shell page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close(); away.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
