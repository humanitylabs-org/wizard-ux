import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withLiveParts } from './fixtures/live-parts.mjs';
import { listFixture, sectionKeys } from './fixtures/chats-list-render.mjs'; // live.js parts moved out verbatim (issue 1665)
const live = withLiveParts(fs.readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const chats = withParts(fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
function device(req, initial = {}) {
  const store = new Map(Object.entries(initial)), events = [], handlers = {};
  const ctx = { req, console, Event: class { constructor(type) { this.type = type; } }, setInterval() {},
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    addEventListener: (k, fn) => handlers[k] = fn };
  ctx.window = { dispatchEvent: e => events.push(e.type) }; modelContext(ctx);
  vm.runInContext(live.slice(live.indexOf("  const PREFS_URL ="), live.indexOf('  const sectionTime =')) + '\nthis.api = { pullPrefs, putPrefs };', ctx);
  return { ...ctx.api, store, events, handlers };
}
const tick = () => new Promise(r => setImmediate(r));
// The whole web/live.js on a device whose localStorage holds `saved`; returns its WizLive.
function liveWith(saved) {
  const storage = new Map(Object.entries(saved));
  const c = { console, AbortSignal, AbortController, URL, URLSearchParams, document: { documentElement: { dataset: {} }, readyState: 'loading', hidden: false, addEventListener() {} }, navigator: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    setInterval() {}, setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, dispatchEvent() {}, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    WizConfig: { dayStart: n => n - n % 864e5 }, location: { origin: 'https://box.test', search: '' },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }) };
  c.window = c; modelContext(c); vm.runInContext(live, c);
  return c.WizLive;
}
test('archive, Compact, Newest/Oldest and subject ordering synchronize to a fresh second device', async () => {
  let state = { archiveAfterDays: 7, compact: false, readyOrder: 'newest', subjectOrder: [] };
  const req = async (url, init = {}) => { assert.equal(url, '/wizard/v1/ui-preferences'); if (init.method === 'PUT') state = { ...state, ...JSON.parse(init.body) }; return { ok: true, json: async () => ({ ...state }) }; };
  const a = device(req); await tick();
  await a.putPrefs({ archiveAfterDays: 0, compact: true }); await a.putPrefs({ readyOrder: 'oldest', workingOrder: 'oldest', subjectOrder: ['Work', 'Home'] });
  const b = device(req); await tick();
  assert.equal(b.store.get('wos.chats.archiveAfter.v1'), '0'); assert.equal(b.store.get('wos.chats.compact.v1'), '1');
  assert.equal(b.store.get('wos.chats.readyOrder.v1'), 'oldest'); assert.equal(b.store.get('wos.chats.subjectOrder.v1'), '["Work","Home"]');
  assert.equal(b.store.get('wos.chats.workingOrder.v1'), 'oldest');
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
// The Chats list's preference taps (cut from chats.js) and LIVE's auto-archive setter (the whole live.js), run.
function prefTaps() {
  const lines = chats.split('\n'), puts = [], stored = [], painted = [];
  const compact = lines.find(l => l.includes("if (e.target.closest('[data-chcompact]'))"));
  const rgAt = lines.findIndex(l => l.trim() === "const rg = e.target.closest('[data-rdyorder]');");
  assert.ok(compact && rgAt > 0, 'tap lines');
  const back = chats.slice(chats.indexOf('  function readyBack() {'), chats.indexOf('\n  }', chats.indexOf('  function readyBack() {')) + 4);
  const ctx = { puts, stored, painted, compactOn: () => false, COMPACT_KEY: 'compact', READY_ORDER_KEY: 'ready', READY_ORDERS: ['newest', 'oldest', 'priority'], readyOrder: 'newest',
    nextOrder: (cur, v) => v, localStorage: { setItem: (k, v) => stored.push([k, v]) }, LIVE: { putPrefs: p => puts.push(JSON.parse(JSON.stringify(p))) }, CH: { w1: {} }, W: { w1: { id: 'w1' } }, renderChats: w => painted.push(w.id) };
  vm.createContext(ctx);
  vm.runInContext(`function tap(e) {\n${compact}\n${lines[rgAt]}\n${lines[rgAt + 1]}\n  return false;\n}\n${back}\nthis.tap = tap; this.readyBack = readyBack;`, ctx);
  const ev = (sel, data = {}) => ({ target: { closest: q => (q === sel ? { dataset: data } : null) } });
  return { ctx, ev };
}
test('all list preference actions write through Agent Service, including clearing filters/order moves', async () => {
  const t = prefTaps();
  t.ctx.tap(t.ev('[data-chcompact]'));
  t.ctx.tap(t.ev('[data-rdyorder]', { rdyorder: 'oldest' }));
  t.ctx.readyBack(); // Back on the list puts Ready back to Newest
  assert.deepEqual(t.ctx.puts, [{ compact: true }, { readyOrder: 'oldest' }, { readyOrder: 'newest' }]);
  assert.deepEqual(t.ctx.stored, [['compact', '1'], ['ready', 'oldest'], ['ready', 'newest']], 'and kept on this device');
  assert.deepEqual(t.ctx.painted, ['w1', 'w1', 'w1']);
  // Subject order moves go as one item operation: covered by tests/synced-lists.test.mjs 'Chats never saves a whole Spaces or subject-order list from this device'.
  // The auto-archive age goes to the Agent Service's preferences, never the retired shell file.
  const reqs = [], storage = new Map();
  const c = { console, AbortSignal, AbortController, URL, URLSearchParams, document: { documentElement: { dataset: {} }, readyState: 'loading', hidden: false, addEventListener() {} }, navigator: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    setInterval() {}, setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, dispatchEvent() {}, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    WizConfig: { dayStart: n => n - n % 864e5 }, location: { origin: 'https://box.test', search: '' },
    fetch: async (url, init = {}) => { reqs.push([String(url), init.method || 'GET', init.body || '']); return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }; } };
  c.window = c; modelContext(c); vm.runInContext(live, c);
  c.WizLive.archiveAfterDays = 0; await tick();
  assert.deepEqual(reqs.filter(r => r[1] === 'PUT').map(r => [r[0], JSON.parse(r[2])]), [['/wizard/v1/ui-preferences', { archiveAfterDays: 0 }]]);
  assert.ok(reqs.every(r => !r[0].includes('wizard-os-home/ui-prefs')));
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
  // the whole live.js: By day unless the device chose By status; By day sorts an old chat into Past week, By status
  // keeps everything not archived in Ready
  const now = Date.parse('2026-11-20T12:00:00Z'), old = { id: 'o', status: 'completed', updatedAt: new Date(now - 3 * 864e5).toISOString(), createdAt: new Date(now - 3 * 864e5).toISOString() };
  for (const [saved, layout] of [[null, 'day'], ['status', 'status'], ['other', 'day']]) {
    const L = liveWith(saved === null ? {} : { 'wos.chats.layout.v1': saved });
    assert.equal(L.chatLayout, layout, `saved ${saved}`);
    const g = L.workGroups([{ ...old }], now);
    assert.deepEqual([g.pastWeek.length, g.ready.length], layout === 'day' ? [1, 0] : [0, 1], `${layout}: where an old chat sits`);
  }
  // the Chats list draws the layout's sections (core/chats-listpaint.js renderChatList)
  assert.deepEqual(sectionKeys(listFixture({ status: true }).render()).filter(k => ['yesterday', 'pastWeek'].includes(k)), [], 'By status: no day sections');
  assert.deepEqual(sectionKeys(listFixture().render()).filter(k => ['yesterday', 'pastWeek'].includes(k)), ['yesterday', 'pastWeek'], 'By day keeps them');
  // The Filter sheet's Layout picker and Group by day button showed only with Channels off; Channels are on for
  // everyone since wizard-ux issue 1258, so the sheet draws neither. The saved choice still writes through.
  assert.doesNotMatch(chats, /data-chgroupday|data-chlayout/, 'the Layout and Group by day taps went with the Channels switch (issue 1258)');
});
test('a repainted Chats list shows the saved auto-archive age, not the picker value it was first painted with', () => {
  // WosMorph keeps every form field's live value, so a <select> painted with "1 week" kept saying so after the
  // choice changed on another desk or device (owner: "I change it to Never and it switches back to one week").
  // The morph branch of the list paint, cut from chats.js, run with a morph that keeps the old field value.
  const head = chats.indexOf("    if (c.listRoot === root && root?.classList.contains('ch-list') && window.WosMorph?.morph(root, html)) {");
  const end = chats.indexOf('    } else {\n      const keepSheet = keptSheet(el);', head);
  const arch = { value: '7' }, root = { classList: { contains: c => c === 'ch-list' }, querySelector: q => (q === '[data-archafter]' ? arch : null) };
  const ctx = { c: { listRoot: root, q: '' }, root, html: '<div></div>', feed: false, place: null, el: { querySelector: () => null }, readyOrder: 'newest',
    window: { WosMorph: { morph: () => true }, WizChatsListModel: { activitySortOf: () => 'newest' } }, LIVE: { archiveAfterDays: 0 }, w: { id: 'w1' },
    clearReading() {}, restoreListPlace: () => true, anchorListPlace() {} };
  vm.runInNewContext(chats.slice(head, end) + '    }', ctx);
  assert.equal(arch.value, '0', 'the saved age (Never), not the value the picker was first painted with');
  ctx.LIVE.archiveAfterDays = 30; vm.runInNewContext(chats.slice(head, end) + '    }', ctx);
  assert.equal(arch.value, '30');
});
