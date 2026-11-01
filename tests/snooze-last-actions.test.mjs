import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fixture } from './fixtures/tweaks.mjs';
const boom = readFileSync(new URL('../web/core/scheduled-reminders.js', import.meta.url), 'utf8');
function someday({ archived = false, restoreOK = true, deferOK = true } = {}) {
  const calls = [], events = [], s = { id: 's', archived };
  const L = { session: () => s, restore: async () => { calls.push('restore'); return restoreOK; }, defer: async () => { calls.push('defer'); return deferOK; } };
  const c = vm.createContext({ live: () => L, close: () => calls.push('close'), window: { dispatchEvent: e => events.push(e) }, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o.detail; } } });
  vm.runInContext(boom.slice(boom.indexOf('  async function someday('), boom.indexOf('  // A timed Snooze also takes')), c);
  return { run: opts => c.someday({ sessionId: 's', ...opts }), calls, events };
}

test('stock Someday (picker) never restores an archived thread', async () => {
  const f = someday({ archived: true }); await f.run(); assert.deepEqual(f.calls, ['defer', 'close']); assert.equal(f.events[0].type, 'wos:snooze-someday');
});
test('one-tap Snooze (restore) restores an archived thread before deferring; success only after persistence', async () => {
  const f = someday({ archived: true }); await f.run({ restore: true }); assert.deepEqual(f.calls, ['restore', 'defer', 'close']); assert.equal(f.events.length, 1);
  const awake = someday(); await awake.run({ restore: true }); assert.deepEqual(awake.calls, ['defer', 'close']);
  const blocked = someday({ archived: true, restoreOK: false }); await assert.rejects(blocked.run({ restore: true }), /kept where it was/); assert.deepEqual(blocked.calls, ['restore']); assert.equal(blocked.events.length, 0);
  const partial = someday({ archived: true, deferOK: false }); await assert.rejects(partial.run({ restore: true }), /restored to Ready/); assert.equal(partial.events.length, 0);
  const fail = someday({ deferOK: false }); await assert.rejects(fail.run({ restore: true }), /kept where it was/); assert.equal(fail.events.length, 0);
});

test('nav.snoozeOrder: trusted nav only, last only, host-owned and released on teardown', async () => {
  const f = fixture(); let api;
  assert.equal(f.host.snoozeOrder, 'default');
  f.host._test.setImporter(async () => ({ default: a => { api = a; return () => {}; } }));
  await f.host.loadTweaks(['miguel/snooze-someday'], f.slots);
  assert.throws(() => api.nav.snoozeOrder('last'), /Trusted navigation/); assert.equal(f.host.snoozeOrder, 'default');
  await f.host.loadTweaks(['miguel/snooze-someday'], f.slots, { teamAuthors: ['miguel'] });
  assert.throws(() => api.nav.snoozeOrder('first'), /Unknown order/); assert.equal(f.host.snoozeOrder, 'default');
  api.nav.snoozeOrder('last'); api.nav.snoozeOrder('last'); assert.equal(f.host.snoozeOrder, 'last');
  const stale = api; await f.clear(); assert.equal(f.host.snoozeOrder, 'default');
  assert.throws(() => stale.nav.snoozeOrder('last'), /Trusted navigation/); assert.equal(f.host.snoozeOrder, 'default');
});
test('normal skin lists keep the renderer snoozed tail, without reversed-list CSS overrides', () => {
  const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const source = read('web/core/chats.js');
  const start = source.indexOf('  function readyBody(');
  const end = source.indexOf('  /* Notifications listed in Ready', start);
  assert.ok(start >= 0 && end > start, 'production Ready renderer found');
  const ctx = vm.createContext({
    snoozeLast: () => true, deferredOf: s => !!s.deferred,
    readyOrder: 'newest', READY_ORDERS: [], READY_ORDER_LABEL: {},
    noteByTime: () => 0,
    withNotes: (rows, notes, rowFn) => rows.map(rowFn).join('')
  });
  vm.runInContext(source.slice(start, end), ctx);
  const html = ctx.readyBody([{ id: 'later', deferred: true }, { id: 'awake' }], s => `<row>${s.id}</row>`);
  assert.ok(html.indexOf('<row>awake</row>') < html.indexOf('<row>later</row>'), 'production renderer emits awake rows first');
  const tweak = read('web/tweaks/miguel/snooze-someday/tweak.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(tweak, /\border\s*:/, 'obsolete order overrides would invert the rendered snoozed tail');
  assert.doesNotMatch(tweak, /data-skin/, 'tweak behavior must not depend on palette');
  for (const skin of ['obsidian', 'landscapes']) {
    assert.doesNotMatch(read(`web/skins/${skin}/skin.css`), /flex-direction\s*:\s*column-reverse/, `${skin} uses the renderer order`);
  }
});

test('the shipped tweak turns snoozeOrder last on and one-tap Snooze restores (no picker)', async () => {
  const f = fixture(); const seen = [];
  f.ctx.window.WosBoomerang = { someday: async opts => { seen.push(opts); } };
  await f.mount('miguel/snooze-someday'); assert.equal(f.host.snoozeOrder, 'last');
  assert.equal(f.host.action('snooze', { sessionId: 's1' }), true); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [{ sessionId: 's1', restore: true }]);
  await f.clear(); assert.equal(f.host.snoozeOrder, 'default'); assert.equal(f.host.action('snooze', { sessionId: 's1' }), false);
});
