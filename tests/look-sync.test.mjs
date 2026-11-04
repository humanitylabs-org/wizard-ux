// Look sync (core/look-sync.js): skin and tweak choices are one set per owner, shared by every device and app
// (Miguel, 1 Nov 2026: the Mac app, the PWA and his phone must show the same set). Two devices on one fake Agent
// Service Pages file (GET/PUT /wizard/v1/pages/wizard-look/look.json, versioned, a stale save is a 409 with the newer
// text), each with its own localStorage, as AGENTS.md asks of every synced feature: stale device + simultaneous edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { read } from './fixtures/tweaks.mjs';

const PATH = '/wizard/v1/pages/wizard-look/look.json';
const clone = v => JSON.parse(JSON.stringify(v));
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

function load() {
  const window = {};
  vm.runInNewContext(read('web/core/look-sync.js'), { window, JSON, Object, Date, Math, Number, Error, setTimeout, clearTimeout });
  return window.WosLookSync;
}
const L = load();

// The Pages file API as the Agent Service answers it (server/pages.mjs save/read).
function pagesBox(doc = null, { routes = true } = {}) {
  const ver = t => createHash('sha1').update(t).digest('hex');
  const box = { text: doc ? JSON.stringify(doc) : null, puts: 0, gets: 0, down: false, held: 0, waiters: [] };
  box.doc = () => (box.text ? JSON.parse(box.text) : null);
  box.race = n => { box.held = n; };
  box.req = async (url, init = {}) => {
    if (box.down) throw new TypeError('Failed to fetch');
    if (box.held > 0) { box.held--; await new Promise(r => { box.waiters.push(r); if (box.held === 0) box.waiters.splice(0).forEach(f => f()); }); }
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => clone(body) });
    if (!routes) return reply(404, { error: 'not_found' });
    assert.equal(url, PATH);
    const version = box.text == null ? null : ver(box.text);
    if ((init.method || 'GET') === 'GET') { box.gets++; return box.text == null ? reply(404, { error: 'file_not_found', exists: false, version: null }) : reply(200, { exists: true, text: box.text, version }); }
    assert.equal(init.method, 'PUT'); assert.equal(init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(init.body);
    if ((body.version ?? null) !== version) return reply(409, { error: 'stale_version', current: { text: box.text || '', version, exists: box.text != null } });
    box.puts++; box.text = body.text; return reply(200, { version: ver(box.text), changed: true });
  };
  return box;
}

// One device: its own storage, skin and tweak mix (what experience.js and skins.js hold), the real look-sync code.
function device(box, { mix = {}, skin = null, views = [], meta = null, clock, known = null } = {}) {
  const store = new Map(meta ? [['wos.look-sync.v1', JSON.stringify(meta)]] : []);
  const timers = [];
  const d = { mix: { ...mix }, skin, adopted: 0 };
  let sync;
  const exp = {
    get mix() { return clone(d.mix); },
    adopt(m) { d.adopted++; d.mix = { ...m }; },
    get state() { return { busy: false, tweaks: views.map(id => ({ id, view: 'v' })) }; },
    tweakIds: async () => { if (!known) throw new Error('offline'); return known; },
  };
  const S = {
    get chosen() { return d.skin; }, get current() { return d.skin || 'nebula'; },
    has: id => ['nebula', 'obsidian', 'obsidian-light', 'landscapes'].includes(id),
    set(id) { d.skin = id; sync.skinChoice(id); }, // the real WosSkin.set raises wos:skin, which reaches skinChoice
  };
  sync = L.create({ req: box.req, store: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, exp, skin: S,
    now: clock || (() => Date.now()), later: (f, ms) => { const t = { f, ms }; timers.push(t); return t; }, cancel: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } });
  d.sync = sync;
  d.flush = async () => { while (timers.length) { const t = timers.shift(); await t.f(); await tick(); } };
  d.timers = timers;
  // An owner's switch: experience.js writes the mix and raises wos:tweak-choice.
  d.toggle = (id, on) => { if (on) d.mix[id] = true; else delete d.mix[id]; sync.tweakChoice(id, on); };
  d.on = () => Object.keys(d.mix).filter(id => d.mix[id]).sort();
  return d;
}
const on = doc => Object.keys(doc?.tweaks || {}).filter(id => doc.tweaks[id].on).sort();

test('an existing skin without tweaks seeds the box; a fresh install still does not', async () => {
  const box = pagesBox(), first = device(box, { skin: 'obsidian-light' });
  await first.sync.sync(); assert.equal(box.doc().skin.id, 'obsidian-light');
  const second = device(box); await second.sync.sync(); assert.equal(second.skin, 'obsidian-light');
});
test('logical revisions preserve a later edit despite skewed device clocks and a future legacy stamp', async () => {
  const box = pagesBox({ version: 1, skin: { id: 'obsidian', at: 9000000000000 }, tweaks: { 'miguel/swipe-strip': { on: true, at: 9000000000000 } } });
  const slow = device(box, { clock: () => 1 }); await slow.sync.sync();
  slow.toggle('miguel/swipe-strip', false); slow.sync.skinChoice('obsidian-light'); await slow.flush();
  assert.equal(box.doc().tweaks['miguel/swipe-strip'].on, false); assert.equal(box.doc().skin.id, 'obsidian-light');
  const fast = device(box, { clock: () => 19000000000000 }); await fast.sync.sync();
  assert.equal(fast.skin, 'obsidian-light'); assert.deepEqual(fast.on(), []);
});

test('server wins on load: a device wears the box set and skin, without writing', async () => {
  const box = pagesBox({ version: 1, skin: { id: 'obsidian-light', at: 5 }, tweaks: { 'miguel/layout': { on: true, at: 5 }, 'miguel/swipe-strip': { on: true, at: 0 } } });
  const mac = device(box, { mix: { 'miguel/send-and-go': true }, skin: 'nebula', meta: { version: 'old', synced: true } });
  await mac.sync.sync();
  assert.deepEqual(mac.on(), ['miguel/layout', 'miguel/swipe-strip']);
  assert.equal(mac.skin, 'obsidian-light');
  assert.equal(box.puts, 0, 'reading the shared set writes nothing');
  assert.deepEqual(clone(mac.sync.state.pending), { version: 1, skin: null, tweaks: {}, defaults: {} }, 'adopting the skin is not a new choice');
  await mac.sync.sync(); assert.equal(mac.adopted, 1, 'already in sync: nothing re-applied');
});

test('a fresh device with nothing on never overwrites the box, and never seeds an empty one', async () => {
  const doc = { version: 1, skin: { id: 'landscapes', at: 0 }, tweaks: { 'miguel/layout': { on: true, at: 0 } } };
  const box = pagesBox(doc), phone = device(box);
  await phone.sync.sync();
  assert.equal(box.puts, 0); assert.deepEqual(box.doc(), doc);
  assert.deepEqual(phone.on(), ['miguel/layout']); assert.equal(phone.skin, 'landscapes');
  const nothing = pagesBox(), fresh = device(nothing);
  await fresh.sync.sync();
  assert.equal(nothing.puts, 0); assert.equal(nothing.text, null, 'stock device: the box stays empty');
  assert.deepEqual(fresh.on(), []);
});

test('migration: the first device with tweaks on seeds the box; the next device takes that set', async () => {
  const box = pagesBox();
  const pwa = device(box, { mix: { 'miguel/layout': true, 'miguel/swipe-strip': true, 'wizard/x': false }, skin: 'obsidian-light' });
  await pwa.sync.sync();
  assert.equal(box.puts, 1);
  assert.deepEqual(box.doc().tweaks, { 'miguel/layout': { on: true, at: 0 }, 'miguel/swipe-strip': { on: true, at: 0 } }, 'seeds carry at 0');
  assert.deepEqual(box.doc().skin, { id: 'obsidian-light', at: 0 });
  const mac = device(box, { skin: null });
  await mac.sync.sync();
  assert.deepEqual(mac.on(), ['miguel/layout', 'miguel/swipe-strip']); assert.equal(mac.skin, 'obsidian-light');
  assert.equal(box.puts, 1);
});

test('Mac/PWA race: a device syncing first with a few tweaks does not beat the bigger set; real changes stay', async () => {
  const box = pagesBox();
  const mac = device(box, { mix: { 'miguel/layout': true } });
  await mac.sync.sync(); // the Mac happened to load first: its few become seeds
  let t = 1000; const clock = () => ++t;
  mac.toggle('miguel/send-and-go', true); await mac.flush(); // and he switched one more on there (a real change)
  const pwa = device(box, { mix: { 'miguel/layout': true, 'miguel/swipe-strip': true, 'miguel/machines-home': true }, skin: 'obsidian', clock });
  await pwa.sync.sync();
  assert.deepEqual(on(box.doc()), ['miguel/layout', 'miguel/machines-home', 'miguel/send-and-go', 'miguel/swipe-strip']);
  await mac.sync.sync(); assert.deepEqual(mac.on(), on(box.doc()), 'the Mac follows');
  // Once synced, a device never replaces the box set again, bigger or not.
  const before = box.text; await pwa.sync.sync(); assert.equal(box.text, before);
});

test('retired tweak ids an old device still stores are never seeded and never make a set look bigger', async () => {
  const known = ['miguel/layout', 'miguel/swipe-strip', 'miguel/send-and-go', 'miguel/model-pills'];
  const box = pagesBox();
  const phone = device(box, { known, mix: { 'miguel/layout': true, 'miguel/orb-switch': true, 'miguel/home-bars': true, 'miguel/hidden-pin': true } });
  await phone.sync.sync();
  assert.deepEqual(on(box.doc()), ['miguel/layout'], 'only live tweaks are seeded');
  const pwa = device(box, { known, mix: { 'miguel/layout': true, 'miguel/swipe-strip': true, 'miguel/send-and-go': true } });
  await pwa.sync.sync();
  assert.deepEqual(on(box.doc()), ['miguel/layout', 'miguel/send-and-go', 'miguel/swipe-strip']);
  // A box seeded by an older shell with retired ids: those do not count against the bigger set either.
  const old = pagesBox({ version: 1, skin: null, tweaks: Object.fromEntries(['miguel/layout', 'miguel/orb-switch', 'miguel/home-bars', 'miguel/hidden-pin'].map(id => [id, { on: true, at: 0 }])) });
  const pwa2 = device(old, { known, mix: { 'miguel/layout': true, 'miguel/swipe-strip': true } });
  await pwa2.sync.sync();
  assert.deepEqual(on(old.doc()), ['miguel/layout', 'miguel/swipe-strip']);
});

test('retired ids on the box never cause a re-apply loop: settle() after each apply is quiet once worn', async () => {
  // 1 Nov 2026: the box set still had miguel/orb-switch, home-bars, hidden-pin on; every apply raised wos:experience,
  // settle() compared them with the live-only device set, never matched, and re-applied every tweak ~13 times a second.
  const known = ['miguel/layout', 'miguel/swipe-strip', 'miguel/apps-home', 'miguel/orb-shell'];
  const box = pagesBox({ version: 1, skin: null, tweaks: Object.fromEntries(['miguel/layout', 'miguel/apps-home', 'miguel/orb-switch', 'miguel/home-bars', 'miguel/hidden-pin'].map(id => [id, { on: true, at: 0 }])) });
  const mac = device(box, { known, views: ['miguel/orb-shell', 'miguel/apps-home'], meta: { version: null, synced: true } });
  await mac.sync.sync();
  assert.deepEqual(mac.on(), ['miguel/apps-home', 'miguel/layout'], 'only live ids are worn');
  const n = mac.adopted;
  for (let i = 0; i < 5; i++) mac.sync.settle(); // what each finished apply() triggers
  assert.equal(mac.adopted, n, 'no re-apply once the live set is worn');
  await mac.sync.sync(); assert.equal(mac.adopted, n, 'a later sync re-applies nothing either');
  assert.equal(box.puts, 0);
});

test('a change writes the box once (debounced) and other devices pick it up on their next load', async () => {
  const box = pagesBox({ version: 1, skin: null, tweaks: { 'miguel/layout': { on: true, at: 0 } } });
  const pwa = device(box), mac = device(box);
  await pwa.sync.sync(); await mac.sync.sync(); assert.equal(box.puts, 0);
  pwa.toggle('miguel/swipe-strip', true); pwa.toggle('miguel/layout', false);
  assert.equal(pwa.timers.length, 1, 'two quick switches: one pending save');
  await pwa.flush();
  assert.equal(box.puts, 1, 'one write');
  assert.deepEqual(on(box.doc()), ['miguel/swipe-strip']);
  await mac.sync.sync();
  assert.deepEqual(mac.on(), ['miguel/swipe-strip']);
  pwa.sync.skinChoice('obsidian-light'); await pwa.flush();
  assert.equal(box.puts, 2); await mac.sync.sync(); assert.equal(mac.skin, 'obsidian-light');
});

test('simultaneous edits on two devices keep both; a stale device never undoes a newer change', async () => {
  const box = pagesBox({ version: 1, skin: null, tweaks: { 'miguel/layout': { on: true, at: 0 } } });
  let t = 100; const clock = () => ++t;
  const a = device(box, { clock }), b = device(box, { clock });
  await a.sync.sync(); await b.sync.sync();
  a.toggle('miguel/swipe-strip', true); b.toggle('miguel/send-and-go', true);
  box.race(2); // both read before either writes
  await Promise.all([a.flush(), b.flush()]);
  assert.deepEqual(on(box.doc()), ['miguel/layout', 'miguel/send-and-go', 'miguel/swipe-strip']);
  await a.sync.sync(); assert.deepEqual(a.on(), on(box.doc()));
  // Stale: B goes offline and switches layout off; A later switches it on again. B's older change loses.
  box.down = true; b.toggle('miguel/layout', false); await b.timers.shift().f(); b.timers.length = 0; assert.deepEqual(b.on(), ['miguel/send-and-go', 'miguel/swipe-strip']);
  box.down = false; a.toggle('miguel/layout', true); await a.flush();
  await b.sync.sync();
  assert.ok(on(box.doc()).includes('miguel/layout'), 'the newer change stays');
  assert.ok(b.on().includes('miguel/layout'), 'the stale device follows the box');
});

test('views stay exclusive after sync: the newest Orb/Apps choice wins, on the box and on every device', async () => {
  const views = ['miguel/orb-shell', 'miguel/apps-home'];
  const box = pagesBox({ version: 1, skin: null, tweaks: { 'miguel/orb-shell': { on: true, at: 5 }, 'miguel/apps-home': { on: true, at: 9 } } });
  const a = device(box, { views });
  await a.sync.sync();
  assert.deepEqual(a.on(), ['miguel/apps-home']);
  // Simultaneous: A wears Orb, B wears Apps a moment later (each toggle writes both views, as WosExperience.toggle does).
  let t = 100; const clock = () => ++t;
  const b = device(box, { views, clock }), c = device(box, { views, clock });
  await b.sync.sync(); await c.sync.sync();
  b.toggle('miguel/orb-shell', true); b.toggle('miguel/apps-home', false);
  c.toggle('miguel/apps-home', true); c.toggle('miguel/orb-shell', false);
  box.race(2); await Promise.all([b.flush(), c.flush()]);
  const both = on(box.doc()).filter(id => views.includes(id));
  assert.equal(both.length, 1, 'never both on the box');
  await b.sync.sync(); await c.sync.sync();
  assert.deepEqual(b.on(), c.on()); assert.equal(b.on().filter(id => views.includes(id)).length, 1);
});

test('a box copy with two views on is fixed on the box (newest stays), so switching the view off means Desks everywhere', async () => {
  const box = pagesBox({ version: 1, skin: null, tweaks: { 'miguel/orb-shell': { on: true, at: 1 }, 'miguel/apps-home': { on: true, at: 2 }, 'miguel/layout': { on: true, at: 0 } } });
  // Views are known only once the tweaks have loaded: the first sync wears what is stored, settle() fixes it after.
  const known = [], a = device(box, { views: known }), b = device(box, { views: known });
  await a.sync.sync(); await b.sync.sync();
  assert.deepEqual(a.on(), ['miguel/apps-home', 'miguel/layout', 'miguel/orb-shell'], 'before the tweaks load: as stored');
  known.push('miguel/orb-shell', 'miguel/apps-home');
  a.sync.settle(); await a.flush();
  assert.equal(box.doc().tweaks['miguel/orb-shell'].on, false, 'the box keeps only the newest view');
  assert.equal(box.puts, 1, 'one write fixes it');
  assert.deepEqual(a.on(), ['miguel/apps-home', 'miguel/layout']);
  await b.sync.sync(); assert.deepEqual(b.on(), ['miguel/apps-home', 'miguel/layout']);
  a.toggle('miguel/apps-home', false); await a.flush();
  await b.sync.sync(); assert.deepEqual(b.on(), ['miguel/layout'], 'off = Desks on the other device too');
});

test('offline or failing box: the device keeps its own set, retries, and sends its change when the box is back', async () => {
  const box = pagesBox({ version: 1, skin: null, tweaks: { 'miguel/layout': { on: true, at: 0 } } });
  const mac = device(box, { mix: { 'miguel/layout': true } });
  await mac.sync.sync();
  box.down = true;
  mac.toggle('miguel/swipe-strip', true);
  await mac.timers.shift().f(); await tick();
  assert.equal(mac.sync.state.last, 'offline');
  assert.deepEqual(mac.on(), ['miguel/layout', 'miguel/swipe-strip'], 'nothing reverted while offline');
  assert.equal(mac.timers.length, 1, 'a retry is scheduled'); assert.ok(mac.timers[0].ms >= 2000);
  box.down = false; await mac.flush();
  assert.equal(mac.sync.state.last, 'ok');
  assert.deepEqual(on(box.doc()), ['miguel/layout', 'miguel/swipe-strip']);
  // A box without Pages (older Agent Service) or a non-owner: this device only, quietly, no retry loop.
  const old = pagesBox(null, { routes: false }), p = device(old, { mix: { 'miguel/layout': true } });
  await p.sync.sync(); assert.equal(p.sync.state.off, true); assert.equal(p.timers.length, 0);
  p.toggle('miguel/swipe-strip', true); assert.equal(p.timers.length, 0); assert.deepEqual(p.on(), ['miguel/layout', 'miguel/swipe-strip']);
});

test('a malformed box file never breaks the shell: unknown fields and bad ids are dropped', () => {
  assert.equal(L.parse('not json'), null);
  assert.equal(L.parse({ version: 2 }), null);
  assert.deepEqual(clone(L.parse(JSON.stringify({ version: 1, skin: { id: '../x' }, tweaks: { 'miguel/layout': { on: true, at: 3 }, bad: { on: true }, 'a/b': { on: 'yes' } }, extra: 1 }))),
    { version: 1, skin: null, tweaks: { 'miguel/layout': { on: true, at: 3 } }, defaults: {} });
});

// The real experience.js: an owner's switch raises wos:tweak-choice; adopting the shared set writes the cached mix
// (first-frame paint on the next load) and raises nothing, so it is never echoed back as a new choice.
test('experience.js: switches raise wos:tweak-choice, adopt() wears the shared set and caches it', async () => {
  const events = []; let active = [];
  const storage = new Map([['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix: {}, defaultsMigrated: true, machinesHomeMoved: true })]]);
  const window = { WosSkin: { current: 'nebula', families: [], familyOf: () => 'wizard' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, layout: 'classic', setLayout() {}, loadTweaks: async ids => { active = ids; } },
    addEventListener() {}, dispatchEvent: e => { if (e.type === 'wos:tweak-choice') events.push(e.detail); } };
  vm.runInNewContext(read('web/core/experience.js'), { window, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, CustomEvent, URL, AbortSignal,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  const E = window.WosExperience; await E.refresh();
  await E.toggle('miguel/no-desk-close');
  assert.deepEqual(clone(events), [{ id: 'miguel/no-desk-close', on: true }]);
  assert.ok(active.includes('miguel/no-desk-close'));
  await E.adopt({ 'miguel/send-and-go': true });
  assert.equal(events.length, 1, 'adopting raises no choice');
  const onOf = m => Object.keys(m).filter(id => m[id] === true);
  assert.deepEqual(onOf(clone(E.mix)), ['miguel/send-and-go']);
  assert.deepEqual(onOf(JSON.parse(storage.get('wos.skin-tweaks.v1')).mix), ['miguel/send-and-go'], 'cached for the next first frame');
  assert.ok(active.includes('miguel/send-and-go') && !active.includes('miguel/no-desk-close'));
});

// Live QA found it: a fresh device (Mac app) adopting Miguel's set ran its one-time machines-home migration and
// showed a tweak the shared set doesn't have. The adopted set is complete: every catalog tweak is on or off.
test('experience.js: a fresh device adopting the shared set never adds its own one-time migrations to it', async () => {
  let active = [];
  const storage = new Map();
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, layout: 'classic', setLayout() {}, loadTweaks: async ids => { active = ids; } },
    addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, CustomEvent, URL, AbortSignal,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  const E = window.WosExperience;
  await E.adopt({ 'miguel/no-desk-close': true, 'miguel/send-and-go': true });
  assert.deepEqual([...active].sort(), ['miguel/no-desk-close', 'miguel/send-and-go', ...JSON.parse(read('web/tweaks/catalog.json')).defaults].sort());
  assert.ok(!active.includes('miguel/machines-home'), 'no migration adds to the shared set');
});

test('both shells load look sync after experience.js; it lives in the owner\'s Files via the Pages file API', () => {
  for (const f of ['web/index.html', 'web/desktop.html'])
    assert.match(read(f), /<script defer src="core\/experience\.js"><\/script>\n  <script defer src="core\/look-sync\.js"><\/script>/, f);
  assert.equal(L.PATH, PATH);
  assert.doesNotMatch(read('web/core/look-sync.js'), /\/wizard\/v1\/skins|ui-preferences/, 'no other store, no skin folder writes');
});
