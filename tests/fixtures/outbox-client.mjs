// The real web/outbox.js in node:vm over an in-memory IndexedDB; every network call fails and is recorded.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../web/outbox.js', import.meta.url), 'utf8');
export function client(rows = new Map(), broken = false) {
  const calls = [], timers = new Set();
  const indexedDB = { open() {
    const r = {};
    queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        if (broken) throw new Error('storage unavailable');
        const tx = { objectStore() { return {
          getAll() { return { result: [...rows.values()].map(x => structuredClone(x)) }; },
          put(value) { rows.set(value.id, structuredClone(value)); return {}; }, delete(id) { rows.delete(id); return {}; }
        }; } }; setImmediate(() => tx.oncomplete?.()); return tx;
      } }; r.onsuccess();
    }); return r;
  } };
  const c = { console, Blob, AbortController, AbortSignal, indexedDB,
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() { if (broken) throw new Error('quota'); } },
    addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    fetch: async (...args) => { calls.push(args); throw new Error('network forbidden'); },
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route },
  }; c.window = c; vm.runInNewContext(source, c);
  return { api: c.WosOutbox, calls, close() { for (const t of timers) clearTimeout(t); } };
}
