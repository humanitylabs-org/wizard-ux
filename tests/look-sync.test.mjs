// Look sync (core/look-sync.js): skin and tweak choices are one set per owner, shared by every device and app
// (Miguel, 1 Nov 2026: the Mac app, the PWA and his phone must show the same set). Two devices on one fake Agent
// Service Pages file (GET/PUT /wizard/v1/pages/wizard-look/look.json, versioned, a stale save is a 409 with the newer
// text), each with its own localStorage, as AGENTS.md asks of every synced feature: stale device + simultaneous edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { read } from './fixtures/tweaks.mjs';
import lookFixture from '../tools/qa-look-file-fixture.cjs';

const PATH = '/wizard/v1/pages/wizard-look/look.json';
const clone = v => JSON.parse(JSON.stringify(v));
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

function load() {
  const window = {};
  vm.runInNewContext(read('web/core/look-sync.js'), { window, JSON, Object, Date, Math, Number, Error, setTimeout, clearTimeout });
  return window.WosLookSync;
}
const L = load();

test('desktop custom backdrop syncs across devices independently of skin and phone view', async () => {
  const doc={version:1,skin:{id:'nebula',at:9},tweaks:{'miguel/layout':{on:true,at:9}},views:{phone:{id:'',at:9}}};
  const box=pagesBox(doc), a=device(box), b=device(box);
  await a.sync.sync(); await b.sync.sync();
  a.pickBackdrop({id:'custom',wide:'wide-id',tall:'tall-id'}); await a.flush(); await b.sync.sync();
  assert.deepEqual(b.backdrop,{id:'custom',wide:'wide-id',tall:'tall-id'});
  assert.deepEqual(box.doc().skin,doc.skin); assert.deepEqual(box.doc().tweaks,doc.tweaks); assert.deepEqual(box.doc().views,doc.views);
  const fresh=device(box); await fresh.sync.sync(); assert.deepEqual(fresh.backdrop,b.backdrop);
  // An idle stale-device edit loses to a newer remote revision, like every other Look field.
  a.pickBackdrop({id:'lake',wide:'wide-id',tall:'tall-id'});
  const changed=box.doc(); changed.desktopBackdrop={id:'sea',at:Date.now()+10000}; box.text=JSON.stringify(changed);
  await a.flush(); assert.equal(box.doc().desktopBackdrop.id,'sea'); assert.equal(a.backdrop.id,'sea');
});
test('stale built-in selection retains uploaded custom references across a two-device CAS race', async () => {
  const box = pagesBox({ version: 1, skin: { id: 'nebula', at: 9 }, tweaks: {} });
  const a = device(box), stale = device(box);
  await a.sync.sync(); await stale.sync.sync();
  a.pickBackdrop({ id: 'custom', wide: 'wide-id', tall: 'tall-id' });
  await a.flush();
  // This device has never seen the upload; its first-read in-flight intent
  // rebases onto the observed revision without erasing the saved images.
  stale.pickBackdrop({ id: 'lake' });
  const original = box.req;
  let injected = false;
  const racing = device({ ...box, req: async (url, init) => {
    const reply = await original(url, init);
    if (!init?.method && !injected) {
      injected = true;
      const doc = box.doc(); doc.updated = 'concurrent-save';
      box.text = JSON.stringify(doc); // force a genuine 409 on first PUT
    }
    return reply;
  } });
  racing.pickBackdrop({ id: 'lake' });
  await racing.flush(); await a.sync.sync(); await stale.sync.sync();
  const want = { id: 'lake', wide: 'wide-id', tall: 'tall-id' };
  assert.deepEqual(a.backdrop, want);
  assert.deepEqual(stale.backdrop, want);
  assert.deepEqual(racing.backdrop, want);
  assert.deepEqual(box.doc().desktopBackdrop, { ...want, at: 11 });
  assert.deepEqual(box.doc().skin, { id: 'nebula', at: 9 });
  a.pickBackdrop({ ...a.backdrop, id: 'custom' }); await a.flush();
  assert.equal(box.doc().desktopBackdrop.wide, 'wide-id');
  assert.equal(box.doc().desktopBackdrop.tall, 'tall-id');
});
test('malformed custom references cannot inject arbitrary URL schemes or paths', () => {
  for(const wide of ['https://elsewhere/image','data:image/png,x','../secret','blob:abc']) {
    assert.equal(L.parse({version:1,tweaks:{},desktopBackdrop:{id:'custom',wide,at:8}}).desktopBackdrop,undefined);
  }
});

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
function device(box, { mix = {}, skin = null, views = [], meta = null, clock, known = null, shells = false } = {}) {
  const store = new Map(meta ? [['wos.look-sync.v1', JSON.stringify(meta)]] : []);
  const timers = [];
  const d = { mix: { ...mix }, skin, adopted: 0, views: {} };
  let sync;
  const exp = {
    get mix() { return clone(d.mix); },
    adopt(m, v) { d.adopted++; d.mix = { ...m }; if (v && typeof v === 'object') d.views = { ...v }; },
    get state() { return { busy: false, tweaks: views.map(id => ({ id, view: 'v' })) }; },
    tweakIds: async () => { if (!known) throw new Error('offline'); return known; },
  };
  if (shells) Object.defineProperty(exp, 'views', { get: () => clone(d.views) });
  const S = {
    get chosen() { return d.skin; }, get current() { return d.skin || 'nebula'; },
    get desktopBackdrop() { return d.backdrop || {id:'living'}; },
    adoptDesktopBackdrop(bg) { d.backdrop = clone(bg); sync.backdropChoice(bg); },
    has: id => ['nebula', 'obsidian', 'obsidian-light', 'landscapes'].includes(id),
    set(id) { d.skin = id; sync.skinChoice(id); }, // the real WosSkin.set raises wos:skin, which reaches skinChoice
  };
  sync = L.create({ req: box.req, store: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, exp, skin: S,
    now: clock || (() => Date.now()), later: (f, ms) => { const t = { f, ms }; timers.push(t); return t; }, cancel: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } });
  d.pickBackdrop = bg => { d.backdrop = clone(bg); sync.backdropChoice(bg); };
  d.sync = sync;
  d.saved = () => JSON.parse(store.get('wos.look-sync.v1') || 'null');
  d.flush = async () => { while (timers.length) { const t = timers.shift(); await t.f(); await tick(); } };
  d.timers = timers;
  // An owner's switch: experience.js writes the mix and raises wos:tweak-choice.
  d.toggle = (id, on) => { if (on) d.mix[id] = true; else delete d.mix[id]; sync.tweakChoice(id, on); };
  d.on = () => Object.keys(d.mix).filter(id => d.mix[id]).sort();
  // A per-type view choice: experience.js stores it and raises wos:view-choice.
  d.pickView = (shell, id) => { d.views[shell] = id; sync.viewChoice(shell, id); };
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
  assert.deepEqual(clone(mac.sync.state.pending), { version: 1, skin: null, tweaks: {} }, 'adopting the skin is not a new choice');
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
    { version: 1, skin: null, tweaks: { 'miguel/layout': { on: true, at: 3 } } });
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

// Per device type views (Miguel, 4 Nov 2026): look.json gains `views: { desktop, phone }`, merged per type.
const MIGUEL = { version: 1, skin: { id: 'landscapes', at: 1793788925203 }, tweaks: { 'miguel/apps-home': { on: false, at: 1793694648727 }, 'miguel/orb-shell': { on: false, at: 1793694691203 }, 'miguel/ai-apps': { on: true, at: 1793695091045 }, 'miguel/reply-summary': { on: true, at: 1793724651099 } }, updated: '2026-11-04T10:42:05.813Z' };

test('old look.json: parsed as before (no views key), worn without a write; its single view keeps the old meaning', async () => {
  const parsed = clone(L.parse(JSON.stringify(MIGUEL)));
  assert.deepEqual(Object.keys(parsed), ['version', 'skin', 'tweaks'], 'no views key appears for an old file');
  assert.equal(parsed.tweaks['miguel/ai-apps'].on, true);
  const box = pagesBox(MIGUEL), before = box.text;
  const views = ['miguel/orb-shell', 'miguel/apps-home', 'miguel/ai-apps'];
  const mac = device(box, { views, shells: true, meta: { version: null, synced: true } });
  await mac.sync.sync(); mac.sync.settle(); await mac.flush();
  assert.deepEqual(mac.on(), ['miguel/ai-apps', 'miguel/reply-summary'], 'the old view stays switched on in the mix');
  assert.deepEqual(mac.views, {}, 'no per-type choice yet: each shell reads the old meaning (experience.js)');
  assert.equal(box.puts, 0); assert.equal(box.text, before, 'the file stays byte for byte');
});

test('new look.json: an older shell parses it without breaking (unknown views dropped), a newer one keeps both types', () => {
  const doc = { ...MIGUEL, views: { desktop: { id: 'miguel/ai-apps', at: 7 }, phone: { id: '', at: 8 }, watch: { id: 'x/y', at: 1 } } };
  assert.deepEqual(clone(L.parse(JSON.stringify(doc))).views, { desktop: { id: 'miguel/ai-apps', at: 7 }, phone: { id: '', at: 8 } });
  assert.equal(L.parse(JSON.stringify({ ...doc, views: { desktop: { id: '../x', at: 1 }, phone: 'orb' } })).views, undefined, 'malformed entries dropped');
  // what an older shell's parse kept: version/skin/tweaks only, so its old meaning still reads the file.
  const old = { version: 1, skin: doc.skin, tweaks: doc.tweaks };
  assert.deepEqual(clone(L.parse(JSON.stringify(old))), clone(L.parse(JSON.stringify(MIGUEL))));
});

test('sync merges views per type: two desktops follow each other, two phones follow each other, simultaneous picks keep both', async () => {
  const box = pagesBox(MIGUEL);
  let t = 2e12; const clock = () => ++t;
  const opts = { shells: true, clock, views: ['miguel/orb-shell', 'miguel/apps-home', 'miguel/ai-apps'] };
  const mac = device(box, opts), pwa = device(box, opts), phone = device(box, opts), tablet = device(box, opts);
  for (const d of [mac, pwa, phone, tablet]) await d.sync.sync();
  // At the same moment: the phone picks Orb, the Mac picks Desks.
  phone.pickView('phone', 'miguel/orb-shell'); mac.pickView('desktop', '');
  box.race(2); await Promise.all([phone.flush(), mac.flush()]);
  assert.deepEqual(Object.fromEntries(Object.entries(box.doc().views).map(([k, v]) => [k, v.id])), { desktop: '', phone: 'miguel/orb-shell' }, 'both types kept');
  assert.equal(box.doc().tweaks['miguel/ai-apps'].on, true, 'the old entry is left for older shells');
  for (const d of [mac, pwa, phone, tablet]) await d.sync.sync();
  for (const d of [mac, pwa, phone, tablet]) assert.deepEqual(d.views, { desktop: '', phone: 'miguel/orb-shell' });
  // A later pick on one type wins over an older one of that type and leaves the other type alone.
  pwa.pickView('desktop', 'miguel/ai-apps'); await pwa.flush();
  tablet.pickView('phone', ''); await tablet.flush();
  for (const d of [mac, phone]) await d.sync.sync();
  assert.deepEqual(mac.views, { desktop: 'miguel/ai-apps', phone: '' }); assert.deepEqual(phone.views, mac.views);
  assert.deepEqual(clone(L.merge({ version: 1, skin: null, tweaks: {}, views: { desktop: { id: 'a/b', at: 5 } } }, { version: 1, skin: null, tweaks: {}, views: { desktop: { id: '', at: 4 }, phone: { id: 'c/d', at: 1 } } })).views,
    { desktop: { id: 'a/b', at: 5 }, phone: { id: 'c/d', at: 1 } }, 'per type, newest wins');
});


test('per-type choices observe future revisions, survive stale first sync and never use device time', async () => {
  const future = 9000000000000;
  const box = pagesBox({ version: 1, skin: null, tweaks: {}, views: { desktop: { id: 'miguel/ai-apps', at: future }, phone: { id: 'miguel/apps-home', at: future } } });
  const opts = { shells: true, clock: () => 1, views: ['miguel/orb-shell', 'miguel/apps-home', 'miguel/ai-apps'] };
  const stale = device(box, opts);
  stale.pickView('phone', 'miguel/orb-shell'); // made offline, before seeing the box
  await stale.flush();
  assert.equal(box.doc().views.phone.id, 'miguel/orb-shell');
  assert.ok(box.doc().views.phone.at > future);
  assert.equal(box.doc().views.desktop.id, 'miguel/ai-apps');
  stale.pickView('desktop', ''); await stale.flush();
  assert.ok(box.doc().views.desktop.at > box.doc().views.phone.at);
  const follower = device(box, opts); await follower.sync.sync();
  assert.deepEqual(follower.views, { desktop: '', phone: 'miguel/orb-shell' });
  const puts = box.puts, adopts = follower.adopted;
  for (let n = 0; n < 4; n++) { await follower.sync.sync(); follower.sync.settle(); }
  assert.equal(box.puts, puts); assert.equal(follower.adopted, adopts, 'settled device does not reapply');
});

test('cached per-device choices seed an absent file even with no skin or legacy mix', async () => {
  const box = pagesBox(), d = device(box, { shells: true });
  d.views = { desktop: 'miguel/ai-apps', phone: '' };
  await d.sync.sync();
  assert.deepEqual(box.doc().views, { desktop: { id: 'miguel/ai-apps', at: 0 }, phone: { id: '', at: 0 } });
  assert.deepEqual(d.views, { desktop: 'miguel/ai-apps', phone: '' });
});

test('browser gate look adapter uses the real Pages path, persists both devices and rejects stale versions', async () => {
  const { LOOK_PATH, lookFileReply } = lookFixture;
  assert.equal(LOOK_PATH, PATH);
  const shared = { version: 1, doc: { version: 1, skin: { id: 'nebula', at: 1 }, tweaks: {}, views: {
    desktop: { id: 'miguel/ai-apps', at: 2 }, phone: { id: 'miguel/orb-shell', at: 3 }
  } } };
  assert.equal(lookFileReply(shared, '/apps/pages/api/file', 'GET'), null, 'old fictional endpoint is not a look API');
  const box = { req: async (url, init = {}) => {
    const reply = lookFileReply(shared, url, init.method || 'GET', init.body ? JSON.parse(init.body) : null);
    assert.ok(reply, 'every production sync request hits the adapter');
    return { ok: reply.status < 300, status: reply.status, json: async () => clone(reply.body) };
  } };
  const opts = { shells: true, views: ['miguel/ai-apps', 'miguel/apps-home', 'miguel/orb-shell'] };
  const desktop = device(box, opts), phone = device(box, opts);
  await desktop.sync.sync(); await phone.sync.sync();
  assert.deepEqual(desktop.views, { desktop: 'miguel/ai-apps', phone: 'miguel/orb-shell' });
  assert.deepEqual(phone.views, desktop.views);
  const stale = lookFileReply(shared, PATH).body;
  desktop.pickView('desktop', 'miguel/apps-home'); await desktop.flush(); await phone.sync.sync();
  phone.pickView('phone', ''); await phone.flush(); await desktop.sync.sync();
  assert.deepEqual(desktop.views, { desktop: 'miguel/apps-home', phone: '' });
  assert.deepEqual(phone.views, desktop.views);
  assert.equal(shared.acceptedWrites.length, 2);
  assert.ok(shared.doc.views.desktop.at > 3); assert.ok(shared.doc.views.phone.at > shared.doc.views.desktop.at);
  const final = clone(shared.doc);
  const collision = lookFileReply(shared, PATH, 'PUT', { version: stale.version, text: stale.text });
  assert.equal(collision.status, 409); assert.deepEqual(JSON.parse(collision.body.current.text), final);
  assert.deepEqual(shared.doc, final, 'a stale writer cannot replace another device choice');
  assert.equal(lookFileReply(shared, PATH, 'DELETE').status, 405);
});

// Defer an actual GET/PUT without changing the production adapter or revision rules.
function holdNext(box, method) {
  const req = box.req; let release, began;
  const started = new Promise(r => { began = r; });
  const held = new Promise(r => { release = r; }); let once = true;
  box.req = async (url, init = {}) => {
    if (once && (init.method || 'GET') === method) { once = false; began(); await held; }
    return req(url, init);
  };
  return { started, release };
}
const viewOpts = { shells: true, views: ['miguel/ai-apps', 'miguel/apps-home', 'miguel/orb-shell'], meta: { synced: true, version: 'old' } };
const remoteViews = () => ({ version: 1, skin: null, tweaks: {}, views: { desktop: { id: 'miguel/ai-apps', at: 80 }, phone: { id: 'miguel/orb-shell', at: 100 } } });

test('already-synced owner choice during first GET is causally based on the observed file', async () => {
  const box = pagesBox(remoteViews()), hold = holdNext(box, 'GET'), d = device(box, viewOpts);
  const syncing = d.sync.sync(); await hold.started;
  d.pickView('phone', 'miguel/apps-home'); hold.release(); await syncing;
  assert.equal(box.doc().views.phone.id, 'miguel/apps-home'); assert.ok(box.doc().views.phone.at > 100);
  assert.equal(d.views.phone, 'miguel/apps-home'); assert.equal(d.views.desktop, 'miguel/ai-apps');
  assert.equal(Object.keys(d.sync.state.pending.views || {}).length, 0);
});
test('already-synced pending storage is based once, and last view switch during GET wins', async () => {
  const box = pagesBox(remoteViews()), hold = holdNext(box, 'GET');
  const d = device(box, { ...viewOpts, meta: { synced: true, version: 'old', pending: { views: { phone: { id: 'miguel/apps-home', at: 1 } } } } });
  const syncing = d.sync.sync(); await hold.started;
  d.pickView('phone', ''); d.pickView('phone', 'miguel/apps-home');
  const remote = box.doc(); remote.views.desktop = { id: 'miguel/orb-shell', at: 200 }; box.text = JSON.stringify(remote);
  hold.release(); await syncing;
  assert.equal(box.doc().views.phone.id, 'miguel/apps-home'); assert.ok(box.doc().views.phone.at > 200);
  assert.deepEqual(box.doc().views.desktop, remote.views.desktop, 'never clobber another shell while basing a local choice');
  const puts = box.puts; await d.sync.sync(); assert.equal(box.puts, puts, 'settled intent is not restamped every sync');
});
test('already-synced persisted view intent survives reload without a new event', async () => {
  const box = pagesBox(remoteViews());
  const d = device(box, { ...viewOpts, meta: { synced: true, version: 'old', pending: { views: { phone: { id: '', at: 1 } } } } });
  await d.sync.sync(); assert.equal(box.doc().views.phone.id, ''); assert.ok(box.doc().views.phone.at > 100);
});
test('view switch during successful PUT is not reverted by adopting the older acknowledgement', async () => {
  const box = pagesBox(remoteViews()), hold = holdNext(box, 'PUT'), d = device(box, viewOpts); await d.sync.sync();
  d.pickView('phone', 'miguel/apps-home');
  const syncing = d.sync.sync(); await hold.started; d.pickView('phone', '');
  hold.release(); await syncing;
  assert.equal(d.views.phone, '', 'a successful older save must not visibly undo a newer choice');
  assert.equal(d.sync.state.pending.views.phone.id, '', 'old sent() only clears its own revision');
  await d.flush(); assert.equal(box.doc().views.phone.id, ''); assert.equal(d.views.phone, '');
});
test('new view choice during conflicted PUT survives retry while other-shell concurrent edit is preserved', async () => {
  const box = pagesBox(remoteViews()), hold = holdNext(box, 'PUT'), d = device(box, viewOpts); await d.sync.sync();
  d.pickView('phone', 'miguel/apps-home');
  const syncing = d.sync.sync(); await hold.started;
  const remote = box.doc(); remote.views.desktop = { id: 'miguel/orb-shell', at: 200 }; remote.views.phone = { id: 'miguel/orb-shell', at: 201 }; box.text = JSON.stringify(remote);
  d.pickView('phone', ''); hold.release(); await syncing;
  assert.equal(box.doc().views.phone.id, ''); assert.ok(box.doc().views.phone.at > 201);
  assert.deepEqual(box.doc().views.desktop, remote.views.desktop); assert.equal(d.views.phone, '');
});
test('a conflicting newer server choice beats an already-sent intent, not an endless local restamp', async () => {
  const box = pagesBox(remoteViews()), hold = holdNext(box, 'PUT'), d = device(box, viewOpts); await d.sync.sync();
  d.pickView('phone', 'miguel/apps-home');
  const syncing = d.sync.sync(); await hold.started;
  const remote = box.doc(); remote.views.phone = { id: '', at: 200 }; box.text = JSON.stringify(remote);
  hold.release(); await syncing;
  assert.deepEqual(box.doc(), remote); assert.equal(d.views.phone, '');
  assert.equal(box.puts, 0); assert.equal(Object.keys(d.sync.state.pending.views || {}).length, 0);
});

// Sibling fields share the same causal-intent rules as views and built-in defaults.
const ordinary = 'miguel/swipe-strip';
const siblingDoc = () => ({ version: 1, skin: { id: 'obsidian', at: 1000 }, tweaks: { [ordinary]: { on: true, at: 1000 } }, views: { desktop: { id: '', at: 900 } } });
const siblingValue = (d, field) => field === 'skin' ? d.skin : !!d.mix[ordinary];
const siblingRemote = (doc, field) => field === 'skin' ? doc.skin.id : doc.tweaks[ordinary].on;
const chooseSibling = (d, field) => {
  if (field === 'skin') { d.skin = 'obsidian-light'; d.sync.skinChoice(d.skin); }
  else d.toggle(ordinary, false);
};
const siblingWant = field => field === 'skin' ? 'obsidian-light' : false;
// Hold the response AFTER the server processed the request, not merely the request.
function holdSiblingAck(box) {
  const req = box.req; let release, began, once = true;
  const started = new Promise(r => { began = r; }), held = new Promise(r => { release = r; });
  box.req = async (url, init = {}) => {
    const response = await req(url, init);
    if (once && init.method === 'PUT') { once = false; began(); await held; }
    return response;
  };
  return { started, release };
}
for (const field of ['skin', 'tweak']) {
  for (const synced of [false, true]) test(`sibling ${field}: choice during first GET stays selected (synced=${synced})`, async () => {
    const box = pagesBox(siblingDoc()), hold = holdNext(box, 'GET');
    const d = device(box, { skin: 'obsidian', mix: { [ordinary]: true }, shells: true, meta: { synced } });
    const syncing = d.sync.sync(); await hold.started;
    chooseSibling(d, field); assert.equal(siblingValue(d, field), siblingWant(field));
    hold.release(); await syncing;
    assert.equal(siblingValue(d, field), siblingWant(field), 'GET adoption must not revert the local choice');
    assert.equal(siblingRemote(box.doc(), field), siblingWant(field));
    const chosen = field === 'skin' ? box.doc().skin : box.doc().tweaks[ordinary];
    assert.ok(chosen.at > 1000, 'intent is based above the complete observed document');
    assert.deepEqual(box.doc().views, siblingDoc().views);
    const writes = box.puts; await d.sync.sync(); assert.equal(box.puts, writes, 'settled choice is quiet');
  });
  test(`sibling ${field}: successful PUT ACK cannot undo a newer unsent choice`, async () => {
    const box = pagesBox(siblingDoc()), hold = holdSiblingAck(box), d = device(box, { shells: true, meta: { synced: true } });
    await d.sync.sync(); d.pickView('desktop', 'miguel/apps-home');
    const syncing = d.sync.sync(); await hold.started;
    assert.equal(box.puts, 1, 'server has already accepted the older view PUT');
    chooseSibling(d, field); hold.release(); await syncing;
    assert.equal(siblingValue(d, field), siblingWant(field), 'older ACK must not paint over the choice');
    assert.equal(field === 'skin' ? d.sync.state.pending.skin.id : d.sync.state.pending.tweaks[ordinary].on, siblingWant(field), 'newer intent remains pending');
    await d.flush();
    assert.equal(siblingRemote(box.doc(), field), siblingWant(field));
    assert.equal(box.doc().views.desktop.id, 'miguel/apps-home');
    const follower = device(box, { shells: true }); await follower.sync.sync();
    assert.equal(siblingValue(follower, field), siblingWant(field), 'another device reads the saved choice');
  });
  for (const newIntent of [false, true]) test(`sibling ${field}: 409 bases only a new intent during PUT (new=${newIntent})`, async () => {
    const box = pagesBox(siblingDoc()), hold = holdNext(box, 'PUT'), d = device(box, { shells: true, meta: { synced: true } });
    await d.sync.sync(); chooseSibling(d, field);
    const syncing = d.sync.sync(); await hold.started;
    const remote = siblingDoc();
    remote.skin.at = 2000; remote.tweaks[ordinary].at = 2001;
    remote.views.desktop = { id: 'miguel/ai-apps', at: 2002 }; box.text = JSON.stringify(remote);
    if (newIntent) chooseSibling(d, field);
    hold.release(); await syncing;
    assert.equal(siblingValue(d, field), newIntent ? siblingWant(field) : siblingRemote(remote, field));
    assert.equal(siblingRemote(box.doc(), field), newIntent ? siblingWant(field) : siblingRemote(remote, field));
    const revision = field === 'skin' ? box.doc().skin.at : box.doc().tweaks[ordinary].at;
    if (newIntent) assert.ok(revision > 2002, 'new unsent intent observes the 409 document once');
    else assert.equal(revision, field === 'skin' ? 2000 : 2001, 'already-sent intent cannot defeat a genuinely newer writer');
    assert.deepEqual(box.doc().views, remote.views, 'independent remote view survives');
    const writes = box.puts; await d.sync.sync(); assert.equal(box.puts, writes);
  });
  test(`sibling ${field}: first-sync sent intent yields to a newer 409 writer`, async () => {
    const box = pagesBox(siblingDoc()), hold = holdNext(box, 'PUT'), d = device(box);
    chooseSibling(d, field);
    const syncing = d.sync.sync(); await hold.started;
    const remote = siblingDoc(); remote.skin.at = 2000; remote.tweaks[ordinary].at = 2001; box.text = JSON.stringify(remote);
    hold.release(); await syncing;
    assert.deepEqual(box.doc(), remote, 'first-sync retries must not renew an already-sent intent');
    assert.equal(siblingValue(d, field), siblingRemote(remote, field));
  });
  test(`sibling ${field}: restored pending choice is based once after reload`, async () => {
    const pending = { skin: field === 'skin' ? { id: 'obsidian-light', at: 1 } : null, tweaks: field === 'tweak' ? { [ordinary]: { on: false, at: 1 } } : {} };
    const box = pagesBox(siblingDoc()), d = device(box, { shells: true, meta: { synced: true, pending } });
    await d.sync.sync(); assert.equal(siblingValue(d, field), siblingWant(field));
    assert.equal(siblingRemote(box.doc(), field), siblingWant(field));
  });
  test(`sibling ${field}: an idle observed choice does not erase a newer remote edit`, async () => {
    const box = pagesBox(siblingDoc()), d = device(box, { meta: { synced: true } }); await d.sync.sync();
    chooseSibling(d, field);
    const remote = siblingDoc(); remote.skin.at = 2000; remote.tweaks[ordinary].at = 2001; box.text = JSON.stringify(remote);
    await d.sync.sync();
    assert.equal(siblingValue(d, field), siblingRemote(remote, field)); assert.deepEqual(box.doc(), remote);
  });
}

// Before per-shell views, experience.toggle() emitted ordinary tweak events. A view-on
// queued every view at ONE revision; those objects survive reload in wos.look-sync.v1.
const legacyViews = ['miguel/orb-shell', 'miguel/apps-home', 'miguel/ai-apps'];
const legacyGroup = (selected, at) => Object.fromEntries(legacyViews.map(id => [id, { on: id === selected, at }]));
const legacyDoc = (selected, at) => ({ version: 1, skin: null, tweaks: legacyGroup(selected, at) });
for (const synced of [false, true]) {
  for (const restored of [false, true]) test(`legacy view group: newer 409 writer keeps a complete selection (synced=${synced}, restored=${restored})`, async () => {
    const box = pagesBox(legacyDoc(legacyViews[1], 1000));
    const hold = holdNext(box, 'PUT');
    const meta = { synced, ...(restored ? { pending: { skin: null, tweaks: legacyGroup(legacyViews[0], 1) } } : {}) };
    // The current experience interface is per-shell even when storage was written by an old module.
    const d = device(box, { views: legacyViews, shells: true, meta });
    if (!restored) d.toggle(legacyViews[0], true);
    const syncing = d.sync.sync(); await hold.started;
    const remote = legacyDoc(legacyViews[2], 1002); box.text = JSON.stringify(remote);
    hold.release(); await syncing;
    assert.deepEqual(on(box.doc()), [legacyViews[2]], 'never mix a newer selection with a fabricated later local off');
    assert.deepEqual(box.doc(), remote, 'already-sent intent yields without another restamp or write');
    assert.deepEqual(d.on(), [legacyViews[2]]);
    assert.equal(box.puts, 0); assert.equal(d.sync.state.last, 'ok');
    assert.deepEqual(clone(d.sync.state.pending.tweaks), {});
    await d.sync.sync(); assert.deepEqual(box.doc(), remote, 'subsequent sync stays quiet');
    assert.deepEqual(d.saved().pending.tweaks, {}, 'settled group is not restored again on the next boot');
  });
  test(`legacy view group: restored equality and independent intent order survive rebasing (synced=${synced})`, async () => {
    const box = pagesBox(legacyDoc(legacyViews[1], 1000));
    // Deliberately not traversal order: skin, tweaks, views, defaults must not decide chronology.
    const pending = { skin: { id: 'obsidian-light', at: 5 }, tweaks: {
      [ordinary]: { on: true, at: 4 }, ...legacyGroup(legacyViews[0], 2)
    }, views: { desktop: { id: '', at: 1 } }, defaults: { 'wizard/example': { on: false, at: 3 } } };
    const d = device(box, { views: legacyViews, shells: true, meta: { synced, pending } });
    await d.sync.sync();
    const doc = box.doc(), group = legacyViews.map(id => doc.tweaks[id].at);
    assert.equal(new Set(group).size, 1, 'one legacy selection remains one revision');
    assert.ok(doc.views.desktop.at > 1000);
    assert.ok(doc.views.desktop.at < group[0]);
    assert.ok(group[0] < doc.defaults['wizard/example'].at);
    assert.ok(doc.defaults['wizard/example'].at < doc.tweaks[ordinary].at);
    assert.ok(doc.tweaks[ordinary].at < doc.skin.at, 'independent intents retain order, not one flattened revision');
    assert.deepEqual(on(doc), [legacyViews[0], ordinary].sort());
    const writes = box.puts; await d.sync.sync(); assert.equal(box.puts, writes);
  });
  test(`legacy view group: an idle based choice yields to a newer complete selection (synced=${synced})`, async () => {
    const box = pagesBox(legacyDoc(legacyViews[1], 1000));
    const d = device(box, { views: legacyViews, meta: { synced } }); await d.sync.sync();
    d.toggle(legacyViews[0], true);
    const remote = legacyDoc(legacyViews[2], 1002); box.text = JSON.stringify(remote);
    await d.sync.sync();
    assert.deepEqual(box.doc(), remote); assert.deepEqual(d.on(), [legacyViews[2]]);
    assert.equal(box.puts, 0);
  });
  test(`legacy view group: a new selection during 409 is based once as a group (synced=${synced})`, async () => {
    const box = pagesBox(legacyDoc(legacyViews[1], 1000)), hold = holdNext(box, 'PUT');
    const d = device(box, { views: legacyViews, meta: { synced } }); d.toggle(legacyViews[0], true);
    const syncing = d.sync.sync(); await hold.started;
    box.text = JSON.stringify(legacyDoc(legacyViews[2], 2000));
    d.toggle(legacyViews[1], true); hold.release(); await syncing;
    assert.deepEqual(on(box.doc()), [legacyViews[1]]);
    const revisions = legacyViews.map(id => box.doc().tweaks[id].at);
    assert.equal(new Set(revisions).size, 1, 'the new intent is also atomic across its off members');
    assert.ok(revisions[0] > 2000);
    const writes = box.puts; await d.sync.sync(); assert.equal(box.puts, writes);
  });
}
