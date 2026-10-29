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
  for (const field of ['compact: on', 'readyOrder']) assert.ok(chats.includes(`LIVE.putPrefs?.({ ${field} })`));
  assert.ok(chats.includes("LIVE.prefOps([{ op: 'front', key: 'subjectOrder', items: keys }]);")); // tests/synced-lists.test.mjs
  assert.match(live, /putPrefs\(\{ archiveAfterDays: d \}\)/);
  assert.doesNotMatch(live, /wizard-os-home\/ui-prefs/);
});
test('a service without shared preferences (404) keeps choices on this device without an error toast or polling', async () => {
  let calls = 0; const d = device(async () => { calls++; return { ok: false, status: 404 }; }); await tick();
  await d.putPrefs({ chatLayout: 'status' }); await d.pullPrefs();
  assert.equal(d.events.includes('wos:prefs-error'), false); assert.equal(calls, 1);
});
test('chat-list layout: By day is the default and keeps Yesterday / Past week; By status is the opt-in', async () => {
  let state = {}; const req = async (u, i = {}) => { if (i.method === 'PUT') state = { ...state, ...JSON.parse(i.body) }; return { ok: true, json: async () => state }; };
  const a = device(req); await tick(); await a.putPrefs({ chatLayout: 'status' });
  const b = device(req); await tick(); assert.equal(b.store.get('wos.chats.layout.v1'), 'status');
  assert.match(live, /localStorage\.getItem\(LAYOUT_KEY\) === 'status' \? 'status' : 'day'/);
  assert.match(live, /else if \(chatLayout\(\) === 'status'\) g\.ready\.push\(s\);[^\n]*\n\s*else if \(!isFinite\(t\) \|\| t < yB\) g\.pastWeek\.push\(s\);/);
  assert.match(chats, /\(byStatus\(\) \? SECTIONS_STATUS : SECTIONS_DAY\)\.map/);
  assert.match(chats, /data-chlayout=/);
});
test('a repainted Chats list shows the saved auto-archive age, not the picker value it was first painted with', () => {
  // WosMorph keeps every form field's live value, so a <select> painted with "1 week" kept saying so after the
  // choice changed on another desk or device (owner: "I change it to Never and it switches back to one week").
  const morphBranch = chats.slice(chats.indexOf('window.WosMorph?.morph(root, html)'), chats.indexOf('const keepSheet = keptSheet(el);'));
  assert.match(morphBranch, /querySelector\('\[data-archafter\]'\)/);
  assert.match(morphBranch, /\.value = String\(LIVE\.archiveAfterDays\)/);
});
