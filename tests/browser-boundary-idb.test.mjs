// wizard-os#133 slice 39: a sandboxed app's IndexedDB is kept by the shell (idb.load, idb.commit, idb.drop, idb.list)
// through the app kit's stand-in (core/app-client.js). Real Chromium proof (opaque frame, the real shell services and the
// shell's own IndexedDB, Music's offline-clip code): tests/qa-browser-boundary-idb.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CLIENT = fs.readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8');
const BLOCK = CLIENT.slice(CLIENT.indexOf('  /* IndexedDB under the boundary'), CLIENT.indexOf('  /* document.cookie under the boundary'));
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

// The browser's own key order for the keys these tests use (numbers < strings < arrays); anything else is not a key.
const rank = k => (typeof k === 'number' && !Number.isNaN(k) ? 1 : typeof k === 'string' ? 3 : Array.isArray(k) ? 5 : 0);
function cmp(a, b) {
  const ra = rank(a), rb = rank(b);
  if (!ra || !rb) throw new DOMException('not a valid key', 'DataError');
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (ra === 5) { for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmp(a[i], b[i]); if (c) return c; } return a.length === b.length ? 0 : a.length < b.length ? -1 : 1; }
  return a === b ? 0 : a < b ? -1 : 1;
}
class KeyRange {
  constructor(lower, upper, lo = false, uo = false) { Object.assign(this, { lower, upper, lowerOpen: lo, upperOpen: uo }); }
  static only(k) { return new KeyRange(k, k); }
  static bound(l, u, lo, uo) { return new KeyRange(l, u, lo, uo); }
  static lowerBound(l, o) { return new KeyRange(l, undefined, o); }
  static upperBound(u, o) { return new KeyRange(undefined, u, false, o); }
  includes(k) {
    if (this.lower !== undefined) { const c = cmp(k, this.lower); if (c < 0 || (c === 0 && this.lowerOpen)) return false; }
    if (this.upper !== undefined) { const c = cmp(k, this.upper); if (c > 0 || (c === 0 && this.upperOpen)) return false; }
    return true;
  }
}
// A fake shell: one app's databases as browser-boundary.js appIdb keeps them, answering the stand-in's requests.
function shell() {
  const dbs = new Map(), calls = [];
  const s = { dbs, calls, full: false, hold: null };
  s.request = async (method, args) => {
    calls.push({ method, args: structuredClone(args) });
    if (s.hold) await s.hold;
    if (method === 'idb.load') { const d = dbs.get(args.name); return { idb: d ? structuredClone({ version: d.version, rev: d.rev, stores: [...d.stores].map(([n, x]) => [n, { keyPath: x.keyPath, autoIncrement: x.autoIncrement, next: x.next, indexes: x.indexes }]), rows: [...d.stores].map(([n, x]) => [n, x.rows]) }) : null }; }
    if (method === 'idb.list') return { idb: [...dbs].map(([name, d]) => ({ name, version: d.version })) };
    if (method === 'idb.drop') { dbs.delete(args.name); return true; }
    if (method === 'idb.commit') {
      if (s.full) return false;
      const d = structuredClone(dbs.get(args.name) || { version: 0, rev: 0, stores: new Map() });
      if (d.rev !== args.base) return 'stale';
      d.rev++;
      for (const op of args.ops) {
        const x = d.stores.get(op.s);
        if (op.o === 'version') d.version = op.v;
        else if (op.o === 'store') d.stores.set(op.s, { keyPath: op.keyPath, autoIncrement: op.autoIncrement, next: 1, indexes: [], rows: [] });
        else if (op.o === 'unstore') d.stores.delete(op.s);
        else if (op.o === 'index') x.indexes.push([op.i, { keyPath: op.keyPath, unique: op.unique, multiEntry: op.multiEntry }]);
        else if (op.o === 'next') x.next = op.n;
        else if (op.o === 'put') { x.rows = x.rows.filter(([k]) => cmp(k, op.k) !== 0); x.rows.push([op.k, op.v]); x.rows.sort((a, b) => cmp(a[0], b[0])); }
        else if (op.o === 'del') x.rows = x.rows.filter(([k]) => cmp(k, op.k) !== 0);
        else if (op.o === 'clear') x.rows = [];
      }
      dbs.set(args.name, d);
      return { idb: { rev: d.rev } };
    }
    throw new Error('unexpected ' + method);
  };
  return s;
}
// The IndexedDB block on its own, in an opaque page whose own IndexedDB refuses to open.
function load({ noChannel = false, fake = shell() } = {}) {
  const real = { cmp, open() { throw new DOMException('denied', 'SecurityError'); } };
  const g = { opaque: true, indexedDB: real, IDBKeyRange: KeyRange, structuredClone, EventTarget, Event, DOMException, setTimeout, clearTimeout, Promise, Object, Array, Map, Set, WeakMap, Symbol, Number, String, Math, TypeError, Error, JSON,
    boundaryClient: async () => (noChannel ? null : { ready: true, request: (m, a) => fake.request(m, a) }) };
  g.window = g;
  vm.createContext(g);
  vm.runInContext(`${BLOCK}\nwindow.__notice = n => idbNotice(n);`, g);
  return { g, fake, idb: g.indexedDB };
}
const req = r => new Promise((y, n) => { r.onsuccess = () => y(r.result); r.onerror = () => n(r.error); });
const end = tx => new Promise(y => { tx.oncomplete = () => y('complete'); tx.onabort = () => y('abort ' + (tx.error ? tx.error.name : null)); });
async function openNotes(idb, version = 1) {
  const r = idb.open('notes', version);
  r.onupgradeneeded = () => { const s = r.result.createObjectStore('notes', { keyPath: 'id' }); s.createIndex('by_slug', 'slug', { unique: true }); };
  return req(r);
}

test('IndexedDB stand-in: replaces the refused one; an upgrade and a put go to the shell as one commit, complete after it is written', async () => {
  const { g, fake, idb } = load();
  assert.notEqual(idb.open, undefined); assert.equal(typeof g.IDBRequest, 'function');
  const db = await openNotes(idb);
  assert.equal(db.version, 1); assert.deepEqual([...db.objectStoreNames], ['notes']);
  const upgrade = fake.calls.find(c => c.method === 'idb.commit');
  assert.deepEqual(upgrade.args.ops.map(o => o.o), ['version', 'store', 'index']);
  let release; fake.hold = new Promise(r => { release = r; });
  const tx = db.transaction('notes', 'readwrite'), log = [];
  tx.oncomplete = () => log.push('complete');
  tx.objectStore('notes').put({ id: 'n1', slug: 'figs', text: 'Buy figs' });
  await tick(30);
  assert.deepEqual(log, [], 'complete waits until the shell has written the change');
  const commit = fake.calls.filter(c => c.method === 'idb.commit').at(-1);
  assert.deepEqual(commit.args, { name: 'notes', base: 1, ops: [{ o: 'put', s: 'notes', k: 'n1', v: { id: 'n1', slug: 'figs', text: 'Buy figs' } }] });
  fake.hold = null; release();
  await tick(30);
  assert.deepEqual(log, ['complete']);
  assert.equal(fake.dbs.get('notes').stores.get('notes').rows.length, 1);
});

test('IndexedDB stand-in: a change the shell cannot keep aborts with QuotaExceededError and is undone in the page', async () => {
  const { fake, idb } = load();
  const db = await openNotes(idb);
  fake.full = true;
  let tx = db.transaction('notes', 'readwrite');
  tx.objectStore('notes').put({ id: 'n1', slug: 'figs' });
  assert.equal(await end(tx), 'abort QuotaExceededError');
  tx = db.transaction('notes');
  assert.equal(await req(tx.objectStore('notes').get('n1')), undefined, 'nothing of it stays');
});

test('IndexedDB stand-in: a failed request aborts its transaction and undoes its earlier changes; the error reaches the transaction', async () => {
  const { fake, idb } = load();
  const db = await openNotes(idb);
  let tx = db.transaction('notes', 'readwrite');
  tx.objectStore('notes').put({ id: 'n1', slug: 'figs' });
  assert.equal(await end(tx), 'complete');
  const before = fake.calls.length;
  tx = db.transaction('notes', 'readwrite');
  const s = tx.objectStore('notes'), errs = [];
  tx.onerror = () => errs.push('tx');
  s.put({ id: 'n2', slug: 'dates' });
  const dup = s.add({ id: 'n3', slug: 'figs' });
  assert.equal(await req(dup).catch(e => e.name), 'ConstraintError');
  assert.equal(await end(tx), 'abort ConstraintError');
  assert.deepEqual(errs, ['tx']);
  assert.equal(fake.calls.slice(before).filter(c => c.method === 'idb.commit').length, 0, 'nothing went to the shell');
  tx = db.transaction('notes');
  assert.deepEqual([...(await req(tx.objectStore('notes').getAllKeys()))], ['n1']);
});

test('IndexedDB stand-in: another window\'s change makes the page read the database again before its next transaction', async () => {
  const fake = shell();
  const a = load({ fake }), b = load({ fake });
  const dbA = await openNotes(a.idb), dbB = await openNotes(b.idb);
  assert.deepEqual(await req(dbB.transaction('notes').objectStore('notes').getAll()), []);
  const tx = dbA.transaction('notes', 'readwrite');
  tx.objectStore('notes').put({ id: 'n9', slug: 'train' });
  assert.equal(await end(tx), 'complete');
  b.g.__notice('notes');
  assert.deepEqual((await req(dbB.transaction('notes').objectStore('notes').getAll())).map(x => x.id), ['n9']);
  b.g.__notice('other-db'); // a database this page never opened: nothing to read
  assert.equal(fake.calls.filter(c => c.method === 'idb.load' && c.args.name === 'other-db').length, 0);
});

test('IndexedDB stand-in: a commit made on a copy another window has changed since is refused, aborts, and the page reads again', async () => {
  const fake = shell();
  const a = load({ fake }), b = load({ fake });
  const dbA = await openNotes(a.idb), dbB = await openNotes(b.idb);
  let tx = dbA.transaction('notes', 'readwrite');
  tx.objectStore('notes').put({ id: 'n1', slug: 'figs' });
  assert.equal(await end(tx), 'complete');
  // B never heard about it (no notice yet): its change would have been made without seeing n1.
  tx = dbB.transaction('notes', 'readwrite');
  tx.objectStore('notes').put({ id: 'n2', slug: 'figs' });
  assert.equal(await end(tx), 'abort UnknownError');
  assert.deepEqual(fake.dbs.get('notes').stores.get('notes').rows.map(([k]) => k), ['n1'], 'the unique slug was not written twice');
  assert.deepEqual((await req(dbB.transaction('notes').objectStore('notes').getAll())).map(x => x.id), ['n1'], 'B read the database again');
  tx = dbB.transaction('notes', 'readwrite');
  tx.objectStore('notes').put({ id: 'n2', slug: 'dates' });
  assert.equal(await end(tx), 'complete', 'and its next change goes through');
});

test('IndexedDB stand-in: outside a Wizard window (no shell channel) open fails with an error event, never a throw', async () => {
  const { idb } = load({ noChannel: true });
  const r = idb.open('notes', 1);
  const e = await req(r).catch(x => x);
  assert.equal(e.name, 'UnknownError');
});
