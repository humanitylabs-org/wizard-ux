import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const live = fs.readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chats = fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
function device(req, initial = {}) {
  const store = new Map(Object.entries(initial)), events = [], handlers = {};
  const ctx = { req, console, Event: class { constructor(type) { this.type = type; } }, setInterval() {},
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    addEventListener: (k, fn) => handlers[k] = fn };
  ctx.window = { dispatchEvent: e => events.push(e.type) }; vm.createContext(ctx);
  vm.runInContext(live.slice(live.indexOf("  const PREFS_URL ="), live.indexOf('  const sectionTime =')) + '\nthis.api = { pullPrefs, putPrefs };', ctx);
  return { ...ctx.api, store, events, handlers };
}
const tick = () => new Promise(r => setImmediate(r));
test('archive, Compact, Newest/Oldest and subject ordering synchronize to a fresh second device', async () => {
  let state = { archiveAfterDays: 7, compact: false, readyOrder: 'newest', subjectOrder: [] };
  const req = async (url, init = {}) => { assert.equal(url, '/wizard/v1/ui-preferences'); if (init.method === 'PUT') state = { ...state, ...JSON.parse(init.body) }; return { ok: true, json: async () => ({ ...state }) }; };
  const a = device(req); await tick();
  await a.putPrefs({ archiveAfterDays: 0, compact: true }); await a.putPrefs({ readyOrder: 'oldest', subjectOrder: ['Work', 'Home'] });
  const b = device(req); await tick();
  assert.equal(b.store.get('wos.chats.archiveAfter.v1'), '0'); assert.equal(b.store.get('wos.chats.compact.v1'), '1');
  assert.equal(b.store.get('wos.chats.readyOrder.v1'), 'oldest'); assert.equal(b.store.get('wos.chats.subjectOrder.v1'), '["Work","Home"]');
  assert.ok(b.events.includes('wos:prefs'));
});
test('old or unavailable service preserves local choices; failed writes are not silently called saved', async () => {
  const d = device(async () => { throw new Error('offline'); }, { 'wos.chats.readyOrder.v1': 'priority' }); await tick();
  assert.equal(d.store.get('wos.chats.readyOrder.v1'), 'priority'); await d.putPrefs({ compact: true }); assert.ok(d.events.includes('wos:prefs-error'));
});
test('an old in-flight GET cannot overwrite a newer local choice', async () => {
  let finish; const d = device(async (_u, i = {}) => i.method === 'PUT' ? { ok: true } : new Promise(r => { finish = r; }));
  await d.putPrefs({ readyOrder: 'oldest' }); finish({ ok: true, json: async () => ({ readyOrder: 'newest' }) }); await tick();
  assert.equal(d.store.has('wos.chats.readyOrder.v1'), false);
});
test('all list preference actions write through Agent Service, including clearing filters/order moves', () => {
  for (const field of ['compact: on', 'readyOrder', 'subjectOrder: next.slice(0, 60)']) assert.ok(chats.includes(`LIVE.putPrefs?.({ ${field} })`));
  assert.match(live, /putPrefs\(\{ archiveAfterDays: d \}\)/);
  assert.doesNotMatch(live, /wizard-os-home\/ui-prefs/);
});
