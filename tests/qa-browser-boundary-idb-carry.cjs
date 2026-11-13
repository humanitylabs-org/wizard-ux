// Browser QA: an app's offline data survives the box turning the browser boundary on (wizard-os#133, slice 57).
// Real Chromium, the real core/app-services.js, core/browser-boundary.js and core/app-client.js (the shell page and app
// windows copy tests/qa-browser-boundary-idb.cjs). Before the boundary, an app's page kept its databases in this
// origin's own IndexedDB (Wizard Music's offline clips, with whether the owner already tapped Send). Its sandboxed page
// can't open those, so after the switch the shell's copy started empty: a clip waiting offline came back from the
// recorder's copy as "Not sent · tap to review". Now the shell notes which app opened which database while its window
// was same-origin and copies a database over once to the one app that alone opened it.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-idb-carry.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOT_BEFORE / QA_SHOT_AFTER=<file.png>: the app window with the boundary off, then on.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const EXPECT_BROKEN = process.env.QA_EXPECT === 'broken';
// The app keeps clips offline the way Wizard Music does (src/music/identify.ts db/localStore) and calls ready().
const APP = name => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{margin:0;padding:18px 22px;font:15px system-ui;background:#fbfaf7;color:#1d1b22}h1{font-size:19px;margin:0 0 10px}
.row{margin:8px 0;padding:10px 12px;border-radius:10px;background:#efece4}.bad{background:#fde3e1;color:#8a1c12}b{font-weight:600}</style></head>
<body><h1>${name} <small></small></h1><div id="out"><div class="row">Opening offline clips…</div></div><script>
  document.querySelector('h1 small').textContent = self.origin === 'null' ? '(boundary on)' : '(boundary off)';
  try { WizardApp.ready({ name: '${name}' }); } catch (_) {}
  function db(name = 'trackhunt-offline-v1') {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1)
      r.onupgradeneeded = () => { r.result.createObjectStore('captures', { keyPath: 'id' }) }
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
  }
  async function localStore(op, value, name) {
    const d = await db(name)
    return new Promise((resolve, reject) => {
      const tx = d.transaction('captures', op === 'all' ? 'readonly' : 'readwrite'), store = tx.objectStore('captures')
      let rows = []
      if (op === 'all') { const q = store.getAll(); q.onsuccess = () => { rows = q.result } }
      else if (op === 'put') store.put(value)
      else store.delete(value)
      tx.oncomplete = () => { d.close(); resolve(rows) }; tx.onerror = () => { d.close(); reject(tx.error) }; tx.onabort = tx.onerror
    })
  }
  window.localStore = localStore;
  window.show = async () => {
    try {
      const rows = await localStore('all');
      const items = await Promise.all(rows.map(async r => '<div class="row">' + r.note + ' · <b>' + (r.sendRequested ? 'Sending when online' : 'Not sent · tap to review') + '</b> (' + (await r.blob.text()).length + ' bytes)</div>'));
      document.getElementById('out').innerHTML = (items.join('') || '<div class="row bad">No offline clips</div>') + '<div class="row">Saved offline: <b>' + rows.length + ' clips</b></div>';
      return rows.length;
    } catch (e) {
      document.getElementById('out').innerHTML = '<div class="row bad">Couldn\\u2019t open offline clips (' + e.name + ').</div>';
      return e.name;
    }
  };
</script></body></html>`;
const SHELL = on => `<!doctype html><html><head><meta charset="utf-8">
${on ? "<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>" : "<script>localStorage.removeItem('wos.browser-boundary.v1');</script>"}
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>const APPS = [{ id: 'music', kind: 'wizard', url: '/music/', name: 'Music' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } }; window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{margin:0;background:#16121f;padding:14px}.win{margin:0 0 10px;border-radius:12px;overflow:hidden;width:440px;background:#fff}
.wbar{height:28px;background:#2b2440;color:#fff;font:13px system-ui;display:flex;align-items:center;padding:0 10px}iframe{width:440px;height:190px;border:0;display:block}</style></head>
<body><div id="desk"></div><script>
  const B = window.WizBrowserBoundary;
  window.openWin = (id, key) => {
    const url = '/' + id + '/', w = document.createElement('div'); w.className = 'win'; w.id = 'w-' + key;
    w.innerHTML = '<header class="wbar">' + id + '</header><iframe class="appframe" ' + (B ? B.frameAttributes(url, id) : '') + ' src="' + url + '"></iframe>';
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
  const page = await browser.newPage({ viewport: { width: 470, height: 250 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  const frameOf = async key => (await page.$('#w-' + key + ' iframe')).contentFrame();
  const open = async (id, key) => { await page.evaluate(([i, k]) => openWin(i, k), [id, key]); await page.waitForTimeout(500); return frameOf(key); };
  const caught = e => 'threw ' + String(e?.message || e).split('\n')[0];

  // 1. Boundary off (today): Music saves a clip the owner already sent while offline, one kept for review, and a
  // to-do list with a key generator and an index. Another app opens a database Music uses too, and the shell's own
  // recorder database by name.
  await page.goto(base + '/');
  const m = await open('music', 'm');
  ok(await m.evaluate(() => self.origin) !== 'null', 'with the boundary off the app page is same-origin');
  await m.evaluate(async () => {
    await localStore('put', { id: 'c1', note: 'Cafe song', sendRequested: true, blob: new Blob(['x'.repeat(1200)], { type: 'audio/webm' }) });
    await localStore('put', { id: 'c2', note: 'Car radio', sendRequested: false, blob: new Blob(['y'.repeat(800)], { type: 'audio/webm' }) });
    await localStore('put', { id: 's1', note: 'shared' }, 'shared-db');
    await new Promise((y, n) => {
      const r = indexedDB.open('tasks', 3);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true }); s.createIndex('by_due', 'due'); };
      r.onsuccess = () => { const d = r.result, tx = d.transaction('tasks', 'readwrite'); tx.objectStore('tasks').put({ t: 'milk', due: 2 }); tx.objectStore('tasks').put({ t: 'bank', due: 1 }); tx.oncomplete = () => { d.close(); y(); }; tx.onerror = () => n(tx.error); };
      r.onerror = () => n(r.error);
    });
    return show();
  });
  if (process.env.QA_SHOT_BEFORE) await page.screenshot({ path: process.env.QA_SHOT_BEFORE });
  const o = await open('other', 'o');
  await o.evaluate(async () => {
    await localStore('put', { id: 'o1', note: 'other' }, 'shared-db');
    await localStore('all', undefined, 'wizard-app-capture-v1').catch(() => {});
  });

  // 2. The box turns the boundary on. Music's sandboxed page opens its offline clips.
  await page.goto(base + '/on');
  const m2 = await open('music', 'm');
  ok(await m2.evaluate(() => self.origin) === 'null', 'with the boundary on the app page is opaque');
  const clips = await m2.evaluate(async () => {
    const rows = await localStore('all'); await show();
    return Promise.all(rows.map(async r => ({ id: r.id, send: r.sendRequested, type: r.blob?.type, n: (await r.blob?.text())?.length })));
  }).catch(caught);
  if (process.env.QA_SHOT_AFTER) { await page.waitForTimeout(100); await page.screenshot({ path: process.env.QA_SHOT_AFTER }); }
  ok(Array.isArray(clips) && clips.length === 2 && clips[0].id === 'c1' && clips[0].send === true && clips[0].type === 'audio/webm' && clips[0].n === 1200 && clips[1].id === 'c2' && clips[1].send === false,
    'Music still has both clips, audio and Send choice included: ' + JSON.stringify(clips));
  const tasks = await m2.evaluate(async () => {
    const p = r => new Promise((y, n) => { r.onsuccess = () => y(r.result); r.onerror = () => n(r.error); });
    const r = indexedDB.open('tasks'); let upgraded = false; r.onupgradeneeded = () => { upgraded = true; };
    const d = await p(r), tx = d.transaction('tasks', 'readwrite'), s = tx.objectStore('tasks');
    const key = await p(s.put({ t: 'call', due: 3 }));
    const byDue = (await p(s.index('by_due').getAll())).map(x => x.t).join();
    d.close(); return { v: d.version, upgraded, key, byDue };
  }).catch(caught);
  ok(tasks?.v === 3 && tasks.upgraded === false && tasks.key === 3 && tasks.byDue === 'bank,milk,call', 'its to-do list keeps version, index and key numbering: ' + JSON.stringify(tasks));
  const shared = await m2.evaluate(async () => (await localStore('all', undefined, 'shared-db')).length).catch(caught);
  ok(shared === 0, 'a database two apps opened goes to neither: ' + shared);
  const o2 = await open('other', 'o');
  const otherSees = await o2.evaluate(async () => ({ music: (await localStore('all')).length, capture: (await localStore('all', undefined, 'wizard-app-capture-v1')).length, shared: (await localStore('all', undefined, 'shared-db')).length })).catch(caught);
  ok(otherSees?.music === 0 && otherSees.capture === 0 && otherSees.shared === 0, "another app gets none of Music's data, nor the shell's recorder database: " + JSON.stringify(otherSees));

  // 3. Copied once: a clip Music deletes now stays deleted after a reload.
  await m2.evaluate(() => localStore('delete', 'c2')).catch(caught);
  await page.evaluate(() => { document.querySelector('#w-m iframe').src = '/music/?r=1'; });
  await page.waitForTimeout(700);
  const m3 = await frameOf('m');
  const after = await m3.evaluate(async () => (await localStore('all')).map(r => r.id).join()).catch(caught);
  ok(after === 'c1', 'a clip deleted after the copy stays deleted: ' + after);

  ok(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close(); server.close();
  if (EXPECT_BROKEN) { console.log(fails.length ? `As expected, ${fails.length} check(s) fail here.` : 'Expected failures, but everything passed.'); process.exit(fails.length ? 0 : 1); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
