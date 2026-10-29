// WizOffline client (web/core/offline-kit.js) against an in-memory IndexedDB, CacheStorage and fetch:
// session expiry keeps edits pending, permanent failures are recoverable, a stale snapshot never overwrites
// an accepted edit, falsy JSON answers are results, clear() wipes the replica, offline warm checks data.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/offline-kit.js', import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 40; i++) await tick(); };

function fakeIDB() {
  const dbs = new Map(), clone = v => v === undefined ? undefined : structuredClone(v);
  function transaction(db, name) {
    const t = {}, st = db.stores.get(name); let pending = 0;
    const done = () => setTimeout(() => { if (pending === 0) t.oncomplete?.(); });
    const op = fn => { pending++; const r = {}; setTimeout(() => { r.result = fn(); pending--; r.onsuccess?.(); done(); }); return r; };
    t.objectStore = () => ({
      getAll: () => op(() => [...st.data.entries()].sort((a, b) => a[0] > b[0] ? 1 : -1).map(([, v]) => clone(v))),
      get: k => op(() => clone(st.data.get(k))),
      put: (v, k) => op(() => { const key = k !== undefined ? k : v[st.opts.keyPath]; st.data.set(key, clone(v)); return key; }),
      add: v => op(() => { const key = st.next++; st.data.set(key, clone({ ...v, [st.opts.keyPath]: key })); return key; }),
      delete: k => op(() => { st.data.delete(k); }),
    });
    return t;
  }
  return {
    dbs,
    open(name) {
      const req = {};
      setTimeout(() => {
        let db = dbs.get(name); const fresh = !db;
        if (!db) { db = { stores: new Map() }; dbs.set(name, db); }
        req.result = { createObjectStore: (n, opts = {}) => db.stores.set(n, { opts, data: new Map(), next: 1 }), transaction: n => transaction(db, n), close() {} };
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    deleteDatabase(name) { const req = {}; setTimeout(() => { dbs.delete(name); req.onsuccess?.(); }); return req; },
  };
}

function boot({ server, online = true, worker = true } = {}) {
  const net = { online, calls: [] }, stores = new Map(), indexedDB = fakeIDB();
  const caches = {
    keys: async () => [...stores.keys()], delete: async k => stores.delete(k),
    open: async n => { if (!stores.has(n)) stores.set(n, new Map()); const m = stores.get(n); return { put: async (u, r) => m.set(String(u), r), match: async u => m.get(String(u)) }; },
  };
  const fetch = async (url, init = {}) => {
    if (!net.online) throw new TypeError('offline');
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined };
    net.calls.push(call);
    return server(call);
  };
  const navigator = { get onLine() { return net.online; },
    ...(worker ? { serviceWorker: { register: async () => ({ update: async () => {} }), ready: Promise.resolve(), controller: {}, addEventListener() {} } } : {}) };
  const ctx = vm.createContext({ location: { href: 'https://box.test/wisdom/' }, navigator, indexedDB, caches, fetch, URL, AbortSignal, crypto: globalThis.crypto,
    structuredClone, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, addEventListener() {}, document: { hidden: false, addEventListener() {} }, Promise, Error, Object, Array, Set, JSON, Math, Date });
  vm.runInContext(source, ctx);
  const kit = ctx.WizOffline.create({
    prefix: 'reader-', base: 'https://box.test/wisdom/', data: ['api/library'], writes: ['api/note'], assetURLs: () => [],
    project: (s, i) => ({ notes: [...(s?.notes || []), i.body.text] }),
    reconcile: (s, r) => ({ notes: [...(s?.notes || []), r?.text ?? 'null-result'] }),
    queuedResult: () => ({ queued: true }),
  });
  return { kit, net, stores, indexedDB };
}
const json = (v, status = 200) => ({ status, ok: status >= 200 && status < 300, redirected: false, json: async () => v });
const html = (status = 200) => ({ status, ok: status >= 200 && status < 300, redirected: false, json: async () => { throw new SyntaxError('Unexpected token <'); } });

test('an expired session keeps offline edits pending, then replays them after sign-in', async () => {
  let mode = 'login';
  const b = boot({ online: false, server: ({ method, body }) => method !== 'POST' ? json({ notes: [] }) : mode === 'login' ? html() : mode === '401' ? json({ error: 'unauthorized' }, 401) : json({ text: body.text }) });
  await settle();
  assert.deepEqual(await b.kit.request('api/note', { text: 'one' }), { queued: true });
  await b.kit.request('api/note', { text: 'two' });
  b.net.online = true; await b.kit.flush();
  let s = await b.kit.status(); assert.equal(s.pending, 2); assert.equal(s.failed.length, 0); assert.match(s.error, /Sign in to sync/);
  mode = '401'; await b.kit.flush();
  s = await b.kit.status(); assert.equal(s.pending, 2); assert.equal(s.failed.length, 0);
  mode = 'ok'; await b.kit.flush();
  s = await b.kit.status(); assert.equal(s.pending, 0); assert.equal(s.error, '', 'a successful replay clears the sync error');
  assert.deepEqual(b.net.calls.filter(c => c.method === 'POST' && c.url.endsWith('api/note')).slice(-2).map(c => c.body.text), ['one', 'two']);
  assert.deepEqual((await b.kit.projected()).notes, ['one', 'two']);
});

test('a permanent JSON rejection is kept and recoverable with retry() or discard()', async () => {
  let reject = true;
  const b = boot({ server: ({ method, body }) => method !== 'POST' ? json({}) : reject ? json({ error: 'too long' }, 422) : json({ text: body.text }) });
  await settle();
  await assert.rejects(b.kit.request('api/note', { text: 'bad' }), /too long/);
  let s = await b.kit.status(); assert.equal(s.failed.length, 1);
  reject = false; assert.equal(await b.kit.retry(s.failed[0].seq), true);
  s = await b.kit.status(); assert.equal(s.failed.length, 0); assert.equal(s.pending, 0);
  reject = true; await assert.rejects(b.kit.request('api/note', { text: 'worse' }), /too long/);
  s = await b.kit.status(); assert.equal(await b.kit.discard(s.failed[0].seq), true);
  assert.equal((await b.kit.status()).failed.length, 0);
});

test('a snapshot fetched before an accepted edit never overwrites it', async () => {
  let release; const held = new Promise(r => { release = r; });
  const b = boot({ server: ({ method, body }) => method === 'POST' ? json({ text: body.text }) : held.then(() => json({ notes: ['old'] })) });
  await settle();
  const reading = b.kit.request('api/library');
  await settle();
  assert.deepEqual(await b.kit.request('api/note', { text: 'NEW' }), { text: 'NEW' });
  release(); const state = await reading;
  assert.deepEqual(state.notes, ['NEW']); assert.deepEqual((await b.kit.projected()).notes, ['NEW']);
  // A snapshot with no write across it is saved as usual.
  const b2 = boot({ server: () => json({ notes: ['fresh'] }) }); await settle();
  assert.deepEqual((await b2.kit.request('api/library')).notes, ['fresh']);
});

test('a falsy JSON answer is the result, not "still queued"', async () => {
  const b = boot({ server: ({ method }) => method === 'POST' ? json(null) : json({}) });
  await settle();
  assert.equal(await b.kit.request('api/note', { text: 'x' }), null);
  assert.equal((await b.kit.status()).pending, 0);
});

test('clear() wipes the outbox/snapshot database and every app cache, nothing else', async () => {
  const b = boot({ online: false, server: () => json({}) });
  await settle();
  await b.kit.request('api/note', { text: 'private' });
  b.stores.set('reader-data-v1', new Map([['x', 1]])); b.stores.set('reader-shell-A', new Map()); b.stores.set('other-data-v1', new Map());
  assert.ok(b.indexedDB.dbs.has('reader-offline-v1'));
  await b.kit.clear(); await settle();
  assert.ok(!b.indexedDB.dbs.has('reader-offline-v1'));
  assert.deepEqual([...b.stores.keys()], ['other-data-v1']);
});

test('offline warm() does not report ready while a configured snapshot was never saved', async () => {
  const b = boot({ online: false, worker: true, server: () => json({}) });
  await settle();
  await b.kit.warm({ notes: [] });
  assert.equal((await b.kit.status()).ready, false);
  (await b.stores.get('reader-data-v1') || b.stores.set('reader-data-v1', new Map()).get('reader-data-v1')).set('https://box.test/wisdom/api/library', {});
  await b.kit.warm({ notes: [] });
  assert.equal((await b.kit.status()).ready, true);
});
