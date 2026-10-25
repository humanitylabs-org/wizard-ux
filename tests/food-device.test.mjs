// Food on the generic device.automation v1 capability: the device-port client, saved-order storage and the one-time
// migration from the pre-v1 native Food, the backend's port traffic, and the old-APK fallback in web/usuals.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build, FIXTURE } from '../tools/gen-food-voice-fixture.mjs';

const src = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
function load(files, extra = {}) {
  const ctx = Object.assign({ console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Error, Map, Set, RegExp, Object, Array, String, Number }, extra);
  ctx.window = ctx; ctx.globalThis = ctx;
  for (const f of files) vm.runInNewContext(src(f), ctx);
  return ctx;
}
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), dump: () => Object.fromEntries(m) };
}

/** A fake wizardDevicePort that answers like AppsBridge.onDeviceMessage, recording every request. */
function fakePort(handlers, { automation = true } = {}) {
  const calls = [];
  const port = {
    onmessage: null,
    postMessage(raw) {
      const m = JSON.parse(raw); calls.push(m);
      const reply = x => setTimeout(() => port.onmessage({ data: JSON.stringify(Object.assign({ v: 1, id: m.id }, x)) }), 0);
      if (m.v !== 1) return reply({ id: '', ok: false, error: 'invalid request' });
      if (m.method === 'device.capabilities') {
        const caps = { 'device.packages': { v: 1, methods: ['device.packages.list'] } };
        if (automation) caps['device.automation'] = { v: 1, methods: ['status', 'record', 'replay', 'screen', 'cancel', 'outcomes', 'ack', 'shortcuts', 'legacyRecipes'].map(x => 'device.automation.' + x), commit: 'user-tap-on-native-cover-only' };
        return reply({ ok: true, result: { v: 1, capabilities: caps } });
      }
      const h = handlers[m.method];
      if (!h) return reply({ ok: false, error: 'unknown method' });
      try { reply({ ok: true, result: h(m.params || {}) }); } catch (e) { reply({ ok: false, error: e.message }); }
    },
  };
  return { port, calls };
}

test('device-port: versioned envelope, discovery and graceful absence', async () => {
  const { port, calls } = fakePort({ 'device.automation.status': () => ({ mode: 'idle' }) });
  const c = load(['core/device-port.js'], { wizardDevicePort: port });
  const P = c.WizDevicePort;
  assert.equal(P.available(), true);
  assert.equal(await P.has('device.automation', 1, 'record'), true);
  assert.equal(await P.has('device.automation', 1, 'confirm'), false); // no such method, ever
  assert.equal(await P.has('device.automation', 2), false);
  assert.equal((await P.call('device.automation.status', { package: 'x' })).mode, 'idle');
  await assert.rejects(P.call('device.automation.placeOrder'), e => e.code === 'unknown method');
  for (const m of calls) { assert.equal(m.v, 1); assert.equal(typeof m.id, 'string'); assert.ok(m.id.length <= 64); }
  assert.equal(calls.filter(m => m.method === 'device.capabilities').length, 1, 'discovery is cached');

  const none = load(['core/device-port.js']).WizDevicePort;
  assert.equal(none.available(), false);
  assert.equal(await none.has('device.automation'), false);
  await assert.rejects(none.call('device.automation.status'), e => e.code === 'no-port');

  const old = fakePort({}, { automation: false });
  assert.equal(await load(['core/device-port.js'], { wizardDevicePort: old.port }).WizDevicePort.has('device.automation'), false);
});

test('store: saved orders persist, and native usuals migrate once without being deleted', () => {
  const c = load(['food/rules.js', 'food/store.js']);
  const storage = memStorage();
  const S = c.WosFoodStore.create(storage, c.WosFoodRules, { now: () => 1000, rand: () => 0.5 });
  const legacy = [{ id: 'u-abc', name: 'Kra pao', pkg: 'com.grabtaxi.passenger', steps: [{ type: 'tap', label: 'Krua Thai Kitchen', id: '', near: '', x: 0.5, y: 0.2 }, { type: 'tap', label: 'Add', near: 'Kra pao' }],
    basket: '1× Kra pao', place: 'Krua Thai Kitchen', lastTotal: '฿90', lastRunAt: 5, lastResult: 'ready', needsName: false, createdAt: 3, script: 'ignored' }];
  assert.equal(S.migrate(legacy), 1);
  assert.equal(S.migrate(legacy.concat([{ id: 'u-new', name: 'Later' }])), 0, 'migrates once');
  const r = S.get('u-abc');
  assert.equal(r.name, 'Kra pao'); assert.equal(r.lastTotal, '฿90'); assert.equal(r.createdAt, 3);
  assert.equal(r.script, 'tap Krua Thai Kitchen\ntap Add @ Kra pao');
  assert.deepEqual(Object.keys(r.steps[0]).sort(), ['id', 'label', 'near', 'type']); // screen positions are not carried
  assert.equal(S.migrated(), 'native-usuals');
  const n = S.put({ name: 'Lunch', steps: [] });
  assert.match(n.id, /^u-/); assert.equal(n.createdAt, 1000);
  assert.equal(S.uniqueName('Lunch'), 'Lunch 2');
  S.remove('u-abc');
  assert.equal(S.all().length, 1);
  const p = S.pend({ name: 'Dinner' });
  assert.equal(S.pending(p).name, 'Dinner'); S.unpend(p); assert.equal(S.pending(p), null);
  // Survives a reload, and a corrupt value starts empty instead of throwing.
  assert.equal(c.WosFoodStore.create(storage, c.WosFoodRules).all().length, 1);
  assert.equal(c.WosFoodStore.create(memStorage({ 'wos.food.v1': '{' }), c.WosFoodRules).all().length, 0);
});

function harness(handlers = {}, init = {}) {
  const c = load(['core/device-port.js', 'food/rules.js', 'food/store.js', 'food/backend.js']);
  const state = { outbox: init.outbox || [], legacy: init.legacy || [], shortcuts: null, mode: 'idle', ref: '' };
  const { port, calls } = fakePort(Object.assign({
    'device.automation.status': p => ({ v: 1, mode: state.mode, ref: state.ref, step: 0, steps: 0, outbox: state.outbox.length, log: [],
      target: { package: p.package, allowed: true, installed: true, blocker: init.blocker || '' } }),
    'device.automation.legacyRecipes': () => ({ recipes: state.legacy }),
    'device.automation.outcomes': () => ({ outcomes: state.outbox }),
    'device.automation.ack': p => { const n = state.outbox.length; state.outbox = state.outbox.filter(o => !p.ids.includes(o.id)); return { removed: n - state.outbox.length }; },
    'device.automation.shortcuts': p => { state.shortcuts = p.table; return { count: p.table.entries.length }; },
    'device.automation.record': p => { if (init.blocker) throw Error(init.blocker); state.mode = 'recording'; state.ref = p.ref; return { started: true }; },
    'device.automation.replay': p => { if (p.steps.some(s => c.WosFoodRules.isCommit(s.label))) throw Error('commit-step'); state.mode = 'replaying'; state.ref = p.ref; return { started: true }; },
    'device.automation.cancel': () => { state.mode = 'idle'; return { mode: 'idle' }; },
  }, handlers), {});
  const P = c.WizDevicePort.create(() => port);
  const storage = memStorage();
  const store = c.WosFoodStore.create(storage, c.WosFoodRules);
  const B = c.WosFoodBackend.automation({ port: P, store, rules: c.WosFoodRules, stripAddress: t => t.replace(/^(?:(?:hey|ok|okay)\s+)?wizard[,.!]?\s+/i, '') });
  return { c, B, store, state, calls, storage };
}
const method = (calls, m) => calls.filter(x => x.method === m);

test('backend: first start migrates native usuals, registers the voice table, and the list shows them', async () => {
  const h = harness({}, { legacy: [{ id: 'u-1', name: 'Kra pao', steps: [{ type: 'tap', label: 'Krua Thai Kitchen' }, { type: 'tap', label: 'Add', near: 'Kra pao' }] }] });
  const snap = await h.B.init();
  assert.deepEqual(snap.list.map(r => r.name), ['Kra pao']);
  assert.equal(snap.blocker, '');
  const t = h.state.shortcuts;
  assert.ok(t.entries.length > 3);
  assert.equal(t.actions['u-1'].op, 'replay');
  assert.equal(t.actions['u-1'].package, 'com.grabtaxi.passenger');
  assert.equal(t.actions['+new'].op, 'record');
  assert.equal(h.B.match('order my usual kra pao'), 'u-1');
  assert.equal(h.B.match('Hey Wizard order food'), '+new');
  await h.B.init();
  assert.equal(method(h.calls, 'device.automation.legacyRecipes').length, 1, 'migration asks native once');
});

test('backend: a replay sends web\'s words and steps; commit taps never leave web; Place order is not a method', async () => {
  const h = harness();
  await h.B.init();
  const r = h.store.put({ name: 'Kra pao', pkg: 'com.grabtaxi.passenger', steps: [{ type: 'tap', label: 'Krua Thai Kitchen', id: '', near: '' }, { type: 'tap', label: 'Place order', id: '', near: '' }] });
  assert.equal(await h.B.run(r.id), '');
  const sent = method(h.calls, 'device.automation.replay').pop().params;
  assert.deepEqual(sent.steps.map(s => s.label), ['Krua Thai Kitchen']);
  assert.equal(sent.words.confirmButton, 'Place order · {total}');
  assert.equal(sent.ref, r.id);
  assert.ok(sent.ambiguous.includes('add'));
  assert.ok(!h.calls.some(m => /confirm|commit|place/i.test(m.method)), 'no web path presses the commit button');
});

test('backend: a native refusal comes back as a blocker the window shows', async () => {
  const h = harness({}, { blocker: 'accessibility' });
  const snap = await h.B.init();
  assert.equal(snap.blocker, 'accessibility');
  assert.equal(await h.B.teach(''), 'accessibility');
  const g = harness({}, { blocker: 'not-installed' });
  assert.equal(await g.B.teach('Lunch'), 'grab');
  assert.equal(Object.keys(JSON.parse(g.storage.getItem('wos.food.v1') || '{"pending":{}}').pending || {}).length, 0, 'a refused teach leaves no pending name');
});

test('backend: finished recordings and runs are collected, stored, then acknowledged', async () => {
  const h = harness();
  await h.B.init();
  assert.equal(await h.B.teach('Dinner'), '');
  const ref = h.state.ref;
  assert.ok(h.store.pending(ref));
  const ev = [{ t: 1, screen: 'menu' }, { t: 2, step: { type: 'tap', label: 'Add', id: '', near: 'Pad thai' } }, { t: 3, step: { type: 'tap', label: 'View basket', id: '', near: '' } }];
  h.state.outbox.push({ id: 'o-11111111', kind: 'recording', ref, package: 'com.grabtaxi.passenger', at: 50, events: ev, committed: false, checkout: null, total: '฿120' });
  h.state.outbox.push({ id: 'o-22222222', kind: 'recording', ref: '+new', package: 'com.grabtaxi.passenger', at: 60, events: ev, committed: true, checkout: ['1× Pad thai', 'Total ฿120'], total: '฿120' });
  await h.B.collect();
  const list = h.store.all();
  assert.deepEqual(list.map(r => r.name), ['Dinner', 'Pad thai']);
  assert.equal(list[0].needsName, false); assert.equal(list[1].needsName, true);
  assert.equal(list[1].lastResult, 'ordered');
  assert.equal(list[0].basket, '1× Pad thai');
  assert.equal(h.state.outbox.length, 0, 'acknowledged');
  assert.equal(h.store.pending(ref), null);
  // A lost ack replays the same outcome: same id, so no duplicate order.
  h.state.outbox.push({ id: 'o-22222222', kind: 'recording', ref: '+new', at: 60, events: ev, committed: true, checkout: null, total: '' });
  await h.B.collect();
  assert.equal(h.store.all().length, 2);
  // A run outcome updates the saved order's last line.
  h.state.outbox.push({ id: 'o-33333333', kind: 'run', ref: list[0].id, at: 70, result: 'failed', code: 'not-found', detail: 'Pad thai' });
  await h.B.collect();
  assert.equal(h.store.get(list[0].id).lastResult, 'failed: Couldn\u2019t find “Pad thai”'.replace('\u2019', "'"));
  assert.ok(h.state.shortcuts.actions[list[1].id], 'new orders reach the native voice table');
});

test('backend: re-teach replaces the old order only when the new recording lands', async () => {
  const h = harness();
  await h.B.init();
  const old = h.store.put({ name: 'Kra pao', steps: [{ type: 'tap', label: 'X', id: '', near: '' }] });
  await h.B.teach('Kra pao', old.id);
  assert.ok(h.store.get(old.id), 'kept while recording');
  h.state.outbox.push({ id: 'o-44444444', kind: 'recording', ref: h.state.ref, at: 5, events: [{ t: 1, step: { type: 'tap', label: 'Krua', id: '', near: '' } }], committed: false });
  await h.B.collect();
  assert.equal(h.store.get(old.id), null);
  assert.deepEqual(h.store.all().map(r => r.name), ['Kra pao']);
  // A cancelled recording changes nothing.
  const keep = h.store.all()[0];
  await h.B.teach('Kra pao', keep.id);
  h.state.outbox.push({ id: 'o-55555555', kind: 'recording', ref: h.state.ref, at: 6, cancelled: true, events: [] });
  await h.B.collect();
  assert.ok(h.store.get(keep.id));
});

test('voice-table fixture for the Android parity test is current', () => {
  assert.deepEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')), JSON.parse(JSON.stringify(build())), 'run: node tools/gen-food-voice-fixture.mjs');
});

/* ---------------- the Food window picks its backend ---------------- */
function windowWith({ port, legacy, pinned } = {}) {
  const storage = memStorage(pinned ? { 'wos.food.backend': 'native' } : {});
  const extra = { localStorage: storage, setInterval: () => 0, document: { hidden: false, activeElement: null }, WizConfig: { stripAddress: t => t.replace(/^(?:hey )?wizard,? /i, '') }, confirm: () => true };
  if (port) extra.wizardDevicePort = port;
  if (legacy) extra.WizardOSNative = legacy;
  return load(['core/device-port.js', 'food/rules.js', 'food/store.js', 'food/backend.js', 'usuals.js'], extra);
}
const tick = () => new Promise(r => setTimeout(r, 20));

test('usuals.js: new APK uses device.automation v1; old APK keeps the native usuals bridge', async () => {
  const legacyCalls = [];
  const legacy = { usuals: () => JSON.stringify({ list: [{ id: 'u-old', name: 'Old', steps: [] }], blocker: '', state: {} }), usualsMatch: t => (legacyCalls.push(t), 'u-old'), usualsRun: id => (legacyCalls.push('run:' + id), '') };
  const { port } = fakePort({ 'device.automation.status': () => ({ mode: 'idle', outbox: 0, target: { blocker: '' } }), 'device.automation.legacyRecipes': () => ({ recipes: [] }),
    'device.automation.outcomes': () => ({ outcomes: [] }), 'device.automation.shortcuts': () => ({ count: 1 }) });
  const v1 = windowWith({ port, legacy });
  await tick(); await tick();
  assert.equal(v1.WosUsuals.backend(), 'automation-v1');
  assert.equal(v1.WosUsuals.match('order food'), '+new');
  assert.equal(legacyCalls.length, 0, 'v1 never calls the old bridge');

  const old = windowWith({ legacy, port: fakePort({}, { automation: false }).port });
  await tick(); await tick();
  assert.equal(old.WosUsuals.backend(), 'native-usuals');
  assert.equal(old.WosUsuals.match('order my usual old'), 'u-old');
  old.WosUsuals.run('u-old'); await tick();
  assert.ok(legacyCalls.includes('run:u-old'));

  const pinned = windowWith({ legacy, port, pinned: true });
  await tick(); await tick();
  assert.equal(pinned.WosUsuals.backend(), 'native-usuals', 'wos.food.backend=native pins the old path');

  const browser = windowWith({});
  await tick();
  assert.equal(browser.WosUsuals.available(), false);
  assert.equal(browser.WosUsuals.spell('order food'), 'new');
  assert.equal(browser.WosUsuals.spell('food'), 'open');
});
