// Port of live ab22897; reconcile defaults with per-device views and causal intent basing (#967).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = process.env.WIZARD_DEFAULT_SYNC_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
function client(b, { defaults = {}, colour = null, mix = {}, active = () => true, meta = null } = {}) {
  const win = {}, timers = new Set(), store = new Map(meta ? [['wos.look-sync.v1', JSON.stringify(meta)]] : []);
  vm.runInNewContext(read('web/core/look-sync.js'), { window: win, JSON, Date, Object, Number, Error, Math, setTimeout, clearTimeout });
  const state = { defaults: { ...defaults }, colour, mix: { ...mix }, views: {}, adopts: 0 };
  const exp = {
    get defaultChoices() { return clone(state.defaults); }, get mix() { return clone(state.mix); }, get views() { return clone(state.views); }, state: { tweaks: [] },
    async tweakIds() { return ['qa/view', 'qa/other']; },
    adopt(m, v, d = {}) { state.adopts++; state.mix = clone(m); if (v) state.views = clone(v); Object.assign(state.defaults, d); },
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
  await E.adopt({}, { desktop: 'miguel/ai-apps', phone: '' }, { 'wizard/unified-inbox': true, 'evil/script': true });
  assert.deepEqual(clone(E.views), { desktop: 'miguel/ai-apps', phone: '' });
  assert.ok(active.includes('wizard/unified-inbox')); assert.ok(!active.includes('evil/script'));
  assert.equal(events.length, 1); assert.equal(W.WosSkin.current, 'nebula'); assert.equal(storage.get('wos.myskin.js.ok'), 'qa-local-approval');
  W.WosMySkin = { active: { id: 'qa-owned', base: 'nebula', tweaks: { 'wizard/unified-inbox': false } } };
  assert.deepEqual(clone(E.defaultChoices), {}, 'owned recipe preferences remain with their existing owner');
  await E.adopt({}, undefined, { 'wizard/unified-inbox': true });
  assert.equal(W.WosMySkin.active.tweaks['wizard/unified-inbox'], false, 'no own-skin customization or write');
});

const DEFAULT = 'wizard/unified-inbox';
const opts = { defaults: { [DEFAULT]: true }, meta: { synced: true, version: 'old' } };
const remote = () => ({ version: 1, skin: null, tweaks: { 'qa/other': { on: true, at: 10 } },
  defaults: { [DEFAULT]: { on: true, at: 1000 } }, views: { desktop: { id: 'qa/view', at: 800 }, phone: { id: '', at: 900 } } });
function holdNext(b, method) {
  const req = b.req; let release, began, once = true;
  const started = new Promise(r => { began = r; }), held = new Promise(r => { release = r; });
  b.req = async (url, init = {}) => {
    if (once && (init.method || 'GET') === method) { once = false; began(); await held; }
    return req(url, init);
  };
  return { started, release };
}
const choose = (d, on) => { d.state.defaults[DEFAULT] = on; d.c.defaultChoice(DEFAULT, on); };
async function remoteWrite(b, doc) {
  const r = await b.req('/wizard/v1/pages/wizard-look/look.json'), current = await r.json();
  await b.req('/wizard/v1/pages/wizard-look/look.json', { method: 'PUT', body: JSON.stringify({ version: current.version, text: JSON.stringify(doc) }) });
}

test('old look.json without defaults parses unchanged; malformed defaults are dropped', () => {
  const W = {}; vm.runInNewContext(read('web/core/look-sync.js'), { window: W });
  const old = { version: 1, skin: null, tweaks: {}, views: { phone: { id: '', at: 2 } } };
  assert.deepEqual(clone(W.WosLookSync.parse(old)), old);
  const doc = W.WosLookSync.parse({ ...old, defaults: { [DEFAULT]: { on: false, at: 3 }, bad: { on: true }, 'evil/script': { on: 'yes' } } });
  assert.deepEqual(clone(doc.defaults), { [DEFAULT]: { on: false, at: 3 } });
});

test('default early GET intent is based once above every observed clock and retains views and tweaks', async () => {
  const b = box(remote()), hold = holdNext(b, 'GET'), d = client(b, opts);
  const syncing = d.c.sync(); await hold.started; choose(d, false); hold.release(); await syncing;
  assert.equal(b.doc.defaults[DEFAULT].on, false); assert.ok(b.doc.defaults[DEFAULT].at > 1000);
  assert.deepEqual(b.doc.views, remote().views); assert.deepEqual(b.doc.tweaks, remote().tweaks);
  assert.deepEqual(d.state.views, { desktop: 'qa/view', phone: '' }); assert.equal(d.state.mix['qa/other'], true);
  const count = b.requests.length; await d.c.sync(); assert.equal(b.requests.length, count + 1, 'quiet followup only GETs');
});

test('persisted default intent survives reload; defaults and both view choices seed a missing file', async () => {
  const b = box(remote()), d = client(b, { ...opts, meta: { synced: true, pending: { defaults: { [DEFAULT]: { on: false, at: 1 } } } } });
  await d.c.sync(); assert.equal(b.doc.defaults[DEFAULT].on, false); assert.ok(b.doc.defaults[DEFAULT].at > 1000);
  const empty = box(), fresh = client(empty, { defaults: { [DEFAULT]: false } });
  fresh.state.views = { desktop: 'qa/view', phone: '' }; await fresh.c.sync();
  assert.deepEqual(empty.doc.defaults, { [DEFAULT]: { on: false, at: 0 } });
  assert.deepEqual(empty.doc.views, { desktop: { id: 'qa/view', at: 0 }, phone: { id: '', at: 0 } });
});

test('default switch during successful PUT stays visible and pending instead of adopting old ACK', async () => {
  const b = box(remote()), hold = holdNext(b, 'PUT'), d = client(b, opts); await d.c.sync();
  choose(d, false); const syncing = d.c.sync(); await hold.started; choose(d, true); hold.release(); await syncing;
  assert.equal(d.state.defaults[DEFAULT], true); assert.equal(d.c.state.pending.defaults[DEFAULT].on, true);
  await d.c.sync(); assert.equal(b.doc.defaults[DEFAULT].on, true); assert.equal(d.state.defaults[DEFAULT], true);
});

for (const newIntent of [false, true]) test(`default 409 respects causal ordering (new intent during PUT=${newIntent})`, async () => {
  const b = box(remote()), hold = holdNext(b, 'PUT'), d = client(b, opts); await d.c.sync();
  choose(d, false); const syncing = d.c.sync(); await hold.started;
  const changed = remote(); changed.defaults[DEFAULT] = { on: true, at: 2000 }; changed.views.phone = { id: 'qa/view', at: 2001 };
  await remoteWrite(b, changed);
  if (newIntent) choose(d, false);
  hold.release(); await syncing;
  assert.equal(b.doc.defaults[DEFAULT].on, !newIntent); assert.equal(d.state.defaults[DEFAULT], !newIntent);
  if (newIntent) assert.ok(b.doc.defaults[DEFAULT].at > 2001);
  else assert.equal(b.doc.defaults[DEFAULT].at, 2000, 'sent intent must not be restamped on conflict');
  assert.deepEqual(b.doc.views, changed.views);
});

test('a sleeping stale device edits other look fields without erasing the newer built-in default', async () => {
  const b = box(remote()), desktop = client(b, opts), phone = client(b, opts);
  await desktop.c.sync(); await phone.c.sync();
  choose(desktop, false); await desktop.c.sync();
  const changedAt = b.doc.defaults[DEFAULT].at;
  assert.equal(phone.state.defaults[DEFAULT], true, 'sleeping phone still has the stale enabled choice');
  phone.state.views.phone = 'qa/view'; phone.c.viewChoice('phone', 'qa/view');
  phone.state.mix['qa/view'] = true; phone.c.tweakChoice('qa/view', true);
  phone.state.colour = 'obsidian'; phone.c.skinChoice('obsidian');
  await phone.c.sync(); await desktop.c.sync();
  assert.deepEqual(b.doc.defaults[DEFAULT], { on: false, at: changedAt }, 'stale defaults are not republished as owner intent');
  assert.equal(b.doc.skin.id, 'obsidian'); assert.equal(b.doc.tweaks['qa/view'].on, true);
  assert.equal(b.doc.views.phone.id, 'qa/view'); assert.equal(b.doc.views.desktop.id, 'qa/view');
  for (const d of [desktop, phone]) { assert.equal(d.state.defaults[DEFAULT], false); assert.equal(d.state.colour, 'obsidian'); assert.equal(d.state.views.phone, 'qa/view'); assert.equal(d.state.mix['qa/view'], true); }
});

test('simultaneous independent default, per-device view and tweak edits all converge', async () => {
  const b = box(remote()), a = client(b, opts), d = client(b, opts); await a.c.sync(); await d.c.sync();
  choose(a, false); d.state.views.phone = 'qa/view'; d.c.viewChoice('phone', 'qa/view');
  d.state.mix['qa/view'] = true; d.c.tweakChoice('qa/view', true);
  await Promise.all([a.c.sync(), d.c.sync()]); await a.c.sync(); await d.c.sync();
  assert.equal(b.doc.defaults[DEFAULT].on, false); assert.equal(b.doc.views.phone.id, 'qa/view'); assert.equal(b.doc.tweaks['qa/view'].on, true);
  assert.equal(b.doc.views.desktop.id, 'qa/view');
  for (const x of [a,d]) { assert.equal(x.state.defaults[DEFAULT], false); assert.deepEqual(x.state.views, { desktop: 'qa/view', phone: 'qa/view' }); assert.equal(x.state.mix['qa/view'], true); }
});
