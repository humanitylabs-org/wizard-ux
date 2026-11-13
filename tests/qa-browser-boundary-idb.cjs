// Browser QA for a sandboxed app's IndexedDB and cookies (wizard-os#133, slice 39; saved settings: slice 34,
// tests/qa-browser-boundary-storage.cjs; the shell page and app windows copy tests/qa-browser-boundary-xhr.cjs).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js and core/app-services.js; app
// windows made the way app.js / desktop.js make them, whose pages load the real core/app-client.js. The browser
// refuses IndexedDB and document.cookie to an opaque page (both throw SecurityError), so an app that keeps offline data
// there (Wizard Music's offline clips, Files' video frames) broke. With the app kit the app's IndexedDB works and
// persists in the shell, per installed app, across reloads and windows, with indexes, cursors, ranges and the space limit.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-idb.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
//   QA_SHOT=<file.png>: a screenshot of the app window after it saved and listed its offline clips.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
// The app keeps recorded clips offline the way Wizard Music does (src/music/identify.ts db/localStore, verbatim logic).
const APP = name => `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{margin:0;padding:18px 22px;font:15px system-ui;background:#fbfaf7;color:#1d1b22}h1{font-size:19px;margin:0 0 10px}
.row{margin:8px 0;padding:10px 12px;border-radius:10px;background:#efece4}.bad{background:#fde3e1;color:#8a1c12}b{font-weight:600}</style></head>
<body><h1>${name}</h1><div id="out"><div class="row">Opening offline clips…</div></div><script>
  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('trackhunt-offline-v1', 1)
      r.onupgradeneeded = () => { r.result.createObjectStore('captures', { keyPath: 'id' }) }
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
    })
  }
  async function localStore(op, value) {
    const d = await db()
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
      const items = await Promise.all(rows.map(async r => '<div class="row">' + r.note + ' <b>' + (await r.blob.text()).length + ' bytes</b></div>'));
      document.getElementById('out').innerHTML = items.join('') + '<div class="row">Saved offline: <b>' + rows.length + ' clips</b></div>';
      return rows.length;
    } catch (e) {
      document.getElementById('out').innerHTML = '<div class="row bad">Couldn\\u2019t open offline clips (' + e.name + ': ' + e.message + ').</div>';
      return e.name;
    }
  };
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>const APPS = [{ id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes' }, { id: 'other', kind: 'wizard', url: '/other/', name: 'Other' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } }; window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services.js"></script>
<style>body{margin:0;background:#16121f;padding:14px}.win{margin:0 0 10px;border-radius:12px;overflow:hidden;width:440px;background:#fff}
.wbar{height:28px;background:#2b2440;color:#fff;font:13px system-ui;display:flex;align-items:center;padding:0 10px}iframe{width:440px;height:170px;border:0;display:block}</style></head>
<body><div id="desk"></div><script>
  const B = window.WizBrowserBoundary;
  window.openWin = (id, url, path, key) => {
    const w = document.createElement('div'); w.className = 'win'; w.id = 'w-' + (key || id);
    w.innerHTML = '<header class="wbar">' + id + '</header><iframe class="appframe" ' + B.frameAttributes(url, id) + ' src="' + url + '"></iframe>';
    document.getElementById('desk').appendChild(w);
    WizAppServices.attach(w.querySelector('iframe'), { appId: id, path, isVisible: () => true });
    return w.id;
  };
</script></body></html>`;
const html = (res, body) => { res.setHeader('content-type', 'text/html'); res.end(body); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') return html(res, SHELL);
  if (u.pathname === '/notes/') return html(res, APP('Music'));
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
  await page.goto(base + '/');
  const frameOf = async key => (await page.$('#w-' + key + ' iframe')).contentFrame();
  const open = async (id, key) => { await page.evaluate(([i, k]) => openWin(i, '/' + i + '/', '/' + i + '/', k), [id, key]); await page.waitForTimeout(400); return frameOf(key); };
  const f = await open('notes', 'a');
  ok(await f.evaluate(() => self.origin) === 'null', 'the app page is opaque');
  // 1. Music's own offline-clip code: open with an upgrade, put two clips with their audio (Blobs), list them.
  const saved = await f.evaluate(async () => {
    try {
      await localStore('put', { id: 'c1', note: 'Morning walk', blob: new Blob(['x'.repeat(1200)], { type: 'audio/webm' }), client_ts: new Date(0).toISOString() });
      await localStore('put', { id: 'c2', note: 'Cafe', blob: new Blob(['y'.repeat(800)], { type: 'audio/webm' }) });
      return await show();
    } catch (e) { await show(); return e.name + ': ' + e.message; }
  });
  ok(saved === 2, 'the app saves two clips with their audio and lists them: ' + JSON.stringify(saved));
  if (SHOT) { await page.waitForTimeout(100); await page.screenshot({ path: SHOT }); }
  // 2. A reload of the window keeps them (the shell holds them), and no second upgrade runs.
  await page.evaluate(() => { const fr = document.querySelector('#w-a iframe'); fr.src = '/notes/?r=1'; });
  await page.waitForTimeout(700);
  const f2 = await frameOf('a');
  const again = await f2.evaluate(async () => {
    try {
      const rows = await localStore('all'); const r = indexedDB.open('trackhunt-offline-v1'); let upgraded = false;
      r.onupgradeneeded = () => { upgraded = true; };
      const d = await new Promise((y, n) => { r.onsuccess = () => y(r.result); r.onerror = () => n(r.error); });
      const v = d.version; d.close();
      return { ids: rows.map(x => x.id), type: rows[0]?.blob?.type, text: (await rows[0]?.blob?.text())?.length, v, upgraded, dbs: await indexedDB.databases() };
    } catch (e) { return e.name + ': ' + e.message; }
  });
  ok(again?.ids?.join() === 'c1,c2' && again.type === 'audio/webm' && again.text === 1200 && again.v === 1 && !again.upgraded && again.dbs?.length === 1 && again.dbs[0].name === 'trackhunt-offline-v1',
    'after a reload the clips are still there, audio and all, at version 1 with no new upgrade: ' + JSON.stringify(again));
  // 3. A second window of the same app sees what the first one writes (it reads the database again).
  const g = await open('notes', 'b');
  const caught = e => 'threw ' + String(e?.message || e).split('\n')[0];
  await g.evaluate(() => localStore('all')).catch(caught);
  await f2.evaluate(() => localStore('put', { id: 'c3', note: 'Train', blob: new Blob(['z']) })).catch(caught);
  await page.waitForTimeout(300);
  const seenB = await g.evaluate(async () => (await localStore('all')).map(x => x.id).join()).catch(caught);
  ok(seenB === 'c1,c2,c3', 'another window of the app sees the new clip: ' + seenB);
  // 4. Another app on this box has its own databases: it can't see these.
  const o = await open('other', 'o');
  const other = await o.evaluate(async () => { try { return { dbs: await indexedDB.databases(), rows: (await localStore('all')).length }; } catch (e) { return e.name; } });
  ok(other?.rows === 0 && other.dbs.length === 0, 'another app sees none of them: ' + JSON.stringify(other));
  // 5. The rest of the API: autoIncrement, indexes (unique), key ranges, cursors both ways, count, delete by range,
  // a failed request that aborts its transaction (and nothing of it stays), instanceof checks.
  const api = await f2.evaluate(async () => {
    const p = r => new Promise((y, n) => { r.onsuccess = () => y(r.result); r.onerror = () => n(r.error); });
    const done = tx => new Promise((y, n) => { tx.oncomplete = () => y('complete'); tx.onabort = () => n(tx.error); });
    const out = {};
    const r = indexedDB.open('tasks', 2);
    r.onupgradeneeded = e => {
      out.upgrade = [e.oldVersion, e.newVersion];
      const s = r.result.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
      s.createIndex('by_due', 'due'); s.createIndex('by_slug', 'slug', { unique: true }); s.createIndex('by_tag', 'tags', { multiEntry: true });
    };
    const d = await p(r);
    out.inst = [r instanceof IDBOpenDBRequest, r instanceof IDBRequest, d instanceof IDBDatabase, typeof IDBKeyRange.bound, d.objectStoreNames.contains('tasks')];
    let tx = d.transaction('tasks', 'readwrite'); let s = tx.objectStore('tasks');
    out.keys = await Promise.all([p(s.add({ slug: 'a', due: 3, tags: ['home', 'x'] })), p(s.add({ slug: 'b', due: 1, tags: ['work'] })), p(s.add({ slug: 'c', due: 2, tags: ['home'] })), p(s.put({ id: 10, slug: 'd', due: 5, tags: [] }))]);
    out.tx1 = await done(tx);
    tx = d.transaction('tasks', 'readwrite'); s = tx.objectStore('tasks');
    s.put({ slug: 'e', due: 9 });
    const dup = s.add({ slug: 'a', due: 7 });
    out.dup = await p(dup).then(() => 'added', e => e.name);
    out.tx2 = await done(tx).catch(e => 'abort ' + (e && e.name));
    tx = d.transaction('tasks'); s = tx.objectStore('tasks'); const ix = s.index('by_due');
    out.count = await p(s.count());
    out.byDue = (await p(ix.getAll(IDBKeyRange.bound(2, 5)))).map(x => x.slug).join();
    out.home = (await p(s.index('by_tag').getAll('home'))).map(x => x.slug).join();
    out.slug = (await p(s.index('by_slug').get('c'))).id;
    out.prev = await new Promise(y => { const seen = []; const c = ix.openCursor(null, 'prev'); c.onsuccess = () => { const k = c.result; if (!k) return y(seen.join()); seen.push(k.key + ':' + k.value.slug); k.continue(); }; });
    out.keysOnly = await new Promise(y => { const seen = []; const c = s.openKeyCursor(IDBKeyRange.lowerBound(2, true)); c.onsuccess = () => { const k = c.result; if (!k) return y(seen.join()); seen.push(k.key); k.continue(); }; });
    await done(tx);
    tx = d.transaction('tasks', 'readwrite'); s = tx.objectStore('tasks');
    await new Promise(y => { const c = s.openCursor(); c.onsuccess = () => { const k = c.result; if (!k) return y(); if (k.value.slug === 'b') k.update({ ...k.value, due: 8 }); if (k.value.slug === 'c') k.delete(); k.continue(); }; });
    s.delete(IDBKeyRange.lowerBound(10));
    await done(tx);
    tx = d.transaction('tasks'); s = tx.objectStore('tasks');
    out.after = (await p(s.getAll())).map(x => x.slug + x.due).join();
    out.next = await p(s.getAllKeys());
    d.close();
    return out;
  }).catch(e => ({ error: caught(e) }));
  ok(api.upgrade?.join() === '0,2' && api.inst?.every(Boolean) && api.keys?.join() === '1,2,3,10' && api.tx1 === 'complete', 'autoIncrement keys and the classes look like the real ones: ' + JSON.stringify(api.error || [api.upgrade, api.inst, api.keys]));
  ok(api.dup === 'ConstraintError' && api.tx2 === 'abort ConstraintError' && api.count === 4, 'a unique index refuses a duplicate and its whole transaction is undone: ' + JSON.stringify([api.dup, api.tx2, api.count]));
  ok(api.byDue === 'c,a,d' && api.home === 'a,c' && api.slug === 3 && api.prev === '5:d,3:a,2:c,1:b' && api.keysOnly === '3,10', 'index ranges, multiEntry, cursors both ways: ' + JSON.stringify([api.byDue, api.home, api.slug, api.prev, api.keysOnly]));
  ok(api.after === 'a3,b8' && api.next?.join() === '1,2', 'cursor update/delete and delete by range: ' + JSON.stringify([api.after, api.next]));
  // 5b. An upgrade whose handler throws is not kept: the open fails, and the next open upgrades again from scratch.
  const mig = await f2.evaluate(async () => {
    const first = await new Promise(y => { const r = indexedDB.open('mig', 1); r.onupgradeneeded = () => { r.result.createObjectStore('half'); throw new Error('migration failed'); }; r.onsuccess = () => y('opened'); r.onerror = () => y(r.error.name); });
    let old = null;
    const d = await new Promise(y => { const r = indexedDB.open('mig', 1); r.onupgradeneeded = e => { old = e.oldVersion; r.result.createObjectStore('whole'); }; r.onsuccess = () => y(r.result); r.onerror = () => y(null); });
    const out = { first, old, stores: d ? [...d.objectStoreNames].join() : null }; d?.close();
    await new Promise(y => { const r = indexedDB.deleteDatabase('mig'); r.onsuccess = r.onerror = y; });
    return out;
  }).catch(e => ({ error: caught(e) }));
  ok(mig.first === 'AbortError' && mig.old === 0 && mig.stores === 'whole', 'an upgrade that throws is undone and runs again on the next open: ' + JSON.stringify(mig));
  // 6. Over the app's space (64 MB): the transaction aborts with QuotaExceededError and nothing of it is kept.
  const quota = await f2.evaluate(async () => {
    const d = await new Promise((y, n) => { const r = indexedDB.open('trackhunt-offline-v1'); r.onsuccess = () => y(r.result); r.onerror = () => n(r.error); });
    const tx = d.transaction('captures', 'readwrite');
    tx.objectStore('captures').put({ id: 'huge', note: 'Too long', blob: new Blob([new Uint8Array(66 * 1024 * 1024)]) });
    const end = await new Promise(y => { tx.oncomplete = () => y('complete'); tx.onabort = () => y('abort ' + tx.error?.name); });
    d.close();
    return { end, ids: (await localStore('all')).map(x => x.id).join() };
  }).catch(e => ({ error: caught(e) }));
  ok(quota.end === 'abort QuotaExceededError' && quota.ids === 'c1,c2,c3', 'over the space limit the change is refused and nothing of it stays: ' + JSON.stringify(quota));
  // 7. The shell keeps them under the window's installed app id: the shell's own database has them as notes'.
  const shell = await page.evaluate(() => new Promise(y => { const r = indexedDB.open('wos-app-idb-v1'); r.onsuccess = () => { try { const q = r.result.transaction('dbs').objectStore('dbs').getAllKeys(); q.onsuccess = () => y(q.result.map(k => k.join('/'))); } catch (e) { y(e.name); } }; r.onerror = () => y(null); }));
  ok(Array.isArray(shell) && shell.join() === 'notes/tasks,notes/trackhunt-offline-v1,other/trackhunt-offline-v1', 'the shell keeps each app\'s databases under its installed app id: ' + JSON.stringify(shell));
  // 8. deleteDatabase removes one; cookies the page sets it can read back, and nothing throws.
  const gone = await f2.evaluate(async () => {
    await new Promise((y, n) => { const r = indexedDB.deleteDatabase('tasks'); r.onsuccess = y; r.onerror = () => n(r.error); });
    return { dbs: (await indexedDB.databases()).map(x => x.name).join() };
  }).catch(e => ({ error: caught(e) }));
  gone.cookie = await f2.evaluate(() => {
    try { document.cookie = 'theme=dark; path=/'; document.cookie = 'tmp=1'; document.cookie = 'tmp=; max-age=0'; return document.cookie; } catch (e) { return e.name; }
  });
  ok(gone.dbs === 'trackhunt-offline-v1', 'deleteDatabase removes it: ' + (gone.error || gone.dbs));
  ok(gone.cookie === 'theme=dark', 'the page reads back the cookies it set, without an error: ' + JSON.stringify(gone.cookie));
  ok(!errors.filter(e => !e.includes('migration failed')).length, 'no page errors: ' + JSON.stringify(errors));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
