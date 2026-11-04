// Regression source may be redirected to the exact live baseline by the forum acceptance runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperWorkingHarness } from './helpers/helper-working-harness.mjs';
const ROOT = process.env.WIZARD_SYNC_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
const tick = async () => { for (let n = 0; n < 12; n++) await new Promise(r => setImmediate(r)); };
function box(initial = null) {
  let doc = initial, version = 0;
  const requests = [];
  return {
    requests, get doc() { return clone(doc); },
    async req(url, init = {}) {
      assert.equal(url, '/wizard/v1/pages/wizard-look/look.json');
      const method = init.method || 'GET'; requests.push(method);
      const reply = (status, data) => ({ status, ok: status < 300, json: async () => clone(data) });
      if (method === 'GET') return doc ? reply(200, { text: JSON.stringify(doc), version: String(version) }) : reply(404, { error: 'file_not_found', exists: false });
      assert.equal(method, 'PUT'); const body = JSON.parse(init.body);
      if ((body.version ?? null) !== (doc ? String(version) : null)) return reply(409, { current: { text: JSON.stringify(doc), version: String(version), exists: !!doc } });
      doc = JSON.parse(body.text); version++; return reply(200, { version: String(version) });
    },
  };
}
function client(b, { defaults = {}, colour = null, mix = {}, active = () => true } = {}) {
  const win = {}, timers = new Set(), store = new Map();
  vm.runInNewContext(read('web/core/look-sync.js'), { window: win, JSON, Date, Object, Number, Error, Math, setTimeout, clearTimeout });
  const state = { defaults: { ...defaults }, colour, mix: { ...mix }, adopts: 0 };
  const exp = {
    get defaultChoices() { return clone(state.defaults); }, get mix() { return clone(state.mix); }, state: { tweaks: [] },
    async tweakIds() { return ['qa/view', 'qa/other']; },
    adopt(m, d = {}) { state.adopts++; state.mix = clone(m); Object.assign(state.defaults, d); },
  };
  const c = win.WosLookSync.create({ req: b.req, exp, active,
    store: { getItem: k => store.get(k), setItem: (k,v) => store.set(k,v) },
    skin: { get chosen() { return state.colour; }, get current() { return state.colour || 'nebula'; }, has: id => ['nebula', 'obsidian', 'landscapes'].includes(id), set: id => { state.colour = id; } },
    later: (f, ms) => { const t = { f, ms }; timers.add(t); return t; }, cancel: t => timers.delete(t),
  });
  return { c, state, store, timers, async step(ms) { const t = [...timers].find(t => t.ms === ms); assert.ok(t, `timer ${ms} exists`); timers.delete(t); await t.f(); await tick(); } };
}

test('built-in inbox choice converges both ways, upgrades an already-synced device, and never transfers script approval', async () => {
  const b = box({ version: 1, skin: { id: 'obsidian', at: 3 }, tweaks: {} });
  const a = client(b, { defaults: { 'wizard/unified-inbox': true }, colour: 'obsidian' });
  const d = client(b, { defaults: { 'wizard/unified-inbox': false }, colour: 'nebula' });
  a.store.set('wos.myskin.js.ok', 'qa-device-a-only'); d.store.set('wos.myskin.js.ok', 'qa-device-d-only');
  await a.c.sync(); await d.c.sync();
  assert.equal(d.state.defaults['wizard/unified-inbox'], true, 'old disabled desktop adopts shared inbox');
  a.state.defaults['wizard/unified-inbox'] = false; a.c.defaultChoice('wizard/unified-inbox', false);
  await a.c.sync(); await d.c.sync();
  assert.equal(d.state.defaults['wizard/unified-inbox'], false);
  d.state.defaults['wizard/unified-inbox'] = true; d.c.defaultChoice('wizard/unified-inbox', true);
  a.c.skinChoice('landscapes'); await Promise.all([a.c.sync(), d.c.sync()]); await a.c.sync(); await d.c.sync();
  assert.equal(a.state.defaults['wizard/unified-inbox'], true); assert.equal(d.state.colour, 'landscapes');
  assert.equal(a.store.get('wos.myskin.js.ok'), 'qa-device-a-only'); assert.equal(d.store.get('wos.myskin.js.ok'), 'qa-device-d-only');
  assert.ok(!JSON.stringify(b.doc).includes('qa-device')); assert.ok(!JSON.stringify(b.doc).includes('script'));
  const puts = b.requests.filter(m => m === 'PUT').length, adopts = d.state.adopts;
  for (let i = 0; i < 5; i++) await d.c.sync();
  assert.equal(b.requests.filter(m => m === 'PUT').length, puts); assert.equal(d.state.adopts, adopts, 'no reapply storm');
});

test('open desktop refreshes colour and view without focus, and hidden/stopped controllers issue no periodic reads', async () => {
  const b = box({ version: 1, skin: { id: 'obsidian', at: 4 }, tweaks: {} });
  let visible = true;
  const phone = client(b), desktop = client(b, { active: () => visible });
  await phone.c.sync(); await desktop.c.sync(); desktop.c.start(); desktop.c.start();
  assert.equal([...desktop.timers].filter(t => t.ms === 30000).length, 1, 'one refresh loop');
  phone.c.skinChoice('landscapes'); phone.c.tweakChoice('qa/view', true); await phone.c.sync();
  await desktop.step(30000);
  assert.equal(desktop.state.colour, 'landscapes'); assert.equal(desktop.state.mix['qa/view'], true);
  visible = false; const reads = b.requests.length; await desktop.step(30000); assert.equal(b.requests.length, reads);
  desktop.c.stop(); assert.equal(desktop.timers.size, 0);
});

test('shell bootstrap waits for local preset migration before seeding the shared look', async () => {
  const b = box(), events = new Map(), timers = new Set(), storage = new Map();
  const E = { state: { busy: false, error: '', tweaks: [] }, mix: {}, defaultChoices: {},
    tweakIds: async () => ['qa/view'], adopt(m) { this.mix = clone(m); } };
  const W = { WosExperience: E, WosSkin: { chosen: 'obsidian', current: 'obsidian', list: [{ id: 'obsidian' }], set() {} },
    fetch: b.req, addEventListener: (k,f) => events.set(k,f) };
  vm.runInNewContext(read('web/core/look-sync.js'), { window: W, fetch: b.req,
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    document: { hidden: false, addEventListener() {} }, AbortSignal, JSON, Date, Object, Math, Number, Error,
    setTimeout: (f,ms) => { const t = {f,ms}; timers.add(t); return t; }, clearTimeout: t => timers.delete(t) });
  await tick(); assert.equal(b.requests.length, 0, 'no premature empty seed');
  E.mix = { 'qa/view': true }; E.state.tweaks = [{ id: 'qa/view', view: 'apps' }];
  events.get('wos:experience')(); await tick();
  assert.equal(b.doc.tweaks['qa/view'].on, true, 'migrated skin/view survives');
  W.WosLookSync.current.stop();
});

test('real experience emits built-in choice and adopts it without echoing or changing colour or approval', async () => {
  const events = [], storage = new Map([['wos.myskin.js.ok', 'qa-local-approval']]); let active = [];
  const W = { WosSkin: { current: 'nebula', families: [], familyOf: () => 'wizard' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, layout: 'classic', setLayout() {}, loadTweaks: async ids => { active = ids; } },
    addEventListener() {}, dispatchEvent: e => { if (e.type === 'wos:tweak-choice') events.push(e.detail); } };
  vm.runInNewContext(read('web/core/experience.js'), { window: W, document: { baseURI: 'https://wizard-qa.invalid/wizard-os-home/', addEventListener() {} },
    Event, CustomEvent: class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } }, URL, AbortSignal, localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    fetch: async u => ({ ok: true, json: async () => JSON.parse(read('web/' + u.pathname.split('/wizard-os-home/')[1])) }) });
  const E = W.WosExperience; await E.refresh(); await E.toggle('wizard/unified-inbox');
  assert.deepEqual(clone(events), [{ id: 'wizard/unified-inbox', on: false, scope: 'default' }]);
  await E.adopt({}, { 'wizard/unified-inbox': true, 'evil/script': true });
  assert.ok(active.includes('wizard/unified-inbox')); assert.ok(!active.includes('evil/script'));
  assert.equal(events.length, 1); assert.equal(W.WosSkin.current, 'nebula'); assert.equal(storage.get('wos.myskin.js.ok'), 'qa-local-approval');
  W.WosMySkin = { active: { id: 'qa-owned', base: 'nebula', tweaks: { 'wizard/unified-inbox': false } } };
  assert.deepEqual(clone(E.defaultChoices), {}, 'owned recipe preferences remain with their existing owner');
  await E.adopt({}, { 'wizard/unified-inbox': true });
  assert.equal(W.WosMySkin.active.tweaks['wizard/unified-inbox'], false, 'no own-skin customization or write');
});

test('actual phone and desktop adapters retain every nonhidden chat across all day/error groups, without writes', () => {
  const h = helperWorkingHarness({ source: read('web/live.js'), row: { id: 'qa-placeholder' }, detail: {} });
  // live.js boot reads preferences before any projection: do not count that as projection I/O.
  const initialCalls = clone(h.calls);
  assert.deepEqual(initialCalls, [{ url: '/wizard/v1/ui-preferences', method: 'GET' }], 'only the known boot read precedes projection');
  const now = Date.now(), DAY = 864e5;
  const row = (id, age, extras = {}) => h.api.normalize({ id, title: id === 'qa-main-sync' ? 'Main sync' : id === 'qa-meeting' ? 'Meeting summaries' : id,
    agent: 'qa-arbitrary-main', updated_at: new Date(now - age).toISOString(), message_count: 2, ...extras });
  h.L.sessions = [row('qa-main-sync', DAY + 1000), row('qa-meeting', 3 * DAY), row('qa-error', 1000, { status: 'failed' }),
    row('qa-ready', 1000), row('qa-working', 1000, { status: 'running' }), row('qa-archive', 1000, { archived: true }), row('qa-hidden', 1000, { hidden: true })];
  h.L.ok = true;
  const unifiedRows = [...h.L.sessions, row('qa-unified-notification', 1000)];
  h.L.unified = () => unifiedRows;
  assert.ok(h.L.workGroups(undefined, now).ready.some(s => s.id === 'qa-unified-notification'), 'preserve unified notification inventory and legacy time argument');
  const day = h.L.workGroups(); assert.ok(day.yesterday.length + day.pastWeek.length > 0, 'real day groups exercised');
  assert.equal(day.errors.length, 1, 'real error group exercised'); assert.equal(day.working.length, 1, 'real working group exercised');
  const expected = unifiedRows.filter(s => !s.hidden).map(s => s.id).sort();
  for (const file of ['web/app.js', 'web/desktop/desktop.js']) {
    const src = read(file), start = src.indexOf('    sessionList: () => {'), end = src.indexOf('    sessionAct:', start);
    const c = { LIVE: h.L, window: {}, CHATS: { stiKind: () => '', threadActions: () => [] }, Date, Number };
    vm.runInNewContext('this.adapter = { ' + src.slice(start,end) + ' };', c);
    const groups = c.adapter.sessionList(), ids = Object.values(groups).flat().map(r => r.id).sort();
    assert.deepEqual(clone(ids), expected, `${file}: exact inventory, no duplicate rows`);
    assert.ok(groups.ready.some(r => r.id === 'qa-main-sync')); assert.ok(groups.ready.some(r => r.id === 'qa-meeting'));
  }
  assert.deepEqual(clone(h.calls), initialCalls, 'inventory projection adds zero agent/backend calls');
});
