// One system for trying changes (wizard-ux#1190): a skin is a look only, on for everyone (the old switch
// wizard/skins-look-only is gone). An own skin's saved tweak choices never decide what runs; only the shared feature
// switches (Settings + the WizardOS Tracker, look.json) do. A device whose worn own skin used to decide is migrated once,
// quietly: what the skin chose becomes the shared switches, so the device keeps running what it ran.
// Real experience.js and real look-sync.js, devices on one fake Pages file (AGENTS.md: synced state needs a
// stale-device and a simultaneous-edit test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { builtinDefaults } from './fixtures/core-features.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const OLD = 'wizard/skins-look-only';
const catalog = JSON.parse(read('web/tweaks/catalog.json'));
const builtin = catalog.defaults[0];
const PATH = '/wizard/v1/pages/wizard-look/look.json';

function lookSync() { const window = {}; vm.runInNewContext(read('web/core/look-sync.js'), { window, JSON, Object, Date, Math, Number, Error, setTimeout, clearTimeout }); return window.WosLookSync; }
const L = lookSync();

// The Agent Service Pages file API: versioned, a stale save is a 409 carrying the newer text.
function pagesBox(doc = null) {
  const ver = t => createHash('sha1').update(t).digest('hex');
  const box = { text: doc ? JSON.stringify(doc) : null };
  box.doc = () => (box.text ? JSON.parse(box.text) : null);
  box.req = async (url, init = {}) => {
    assert.equal(url, PATH);
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => clone(body) });
    const version = box.text == null ? null : ver(box.text);
    if ((init.method || 'GET') === 'GET') return box.text == null ? reply(404, { error: 'file_not_found' }) : reply(200, { exists: true, text: box.text, version });
    const body = JSON.parse(init.body);
    if ((body.version ?? null) !== version) return reply(409, { error: 'stale_version', current: { text: box.text || '', version, exists: box.text != null } });
    box.text = body.text; return reply(200, { version: ver(box.text) });
  };
  return box;
}

// One device: its own storage, the real experience.js, an own skin (or none), and the real look sync on `box`.
function device(box, { mix = {}, recipe = null, channel = 'latest', defaultsOff = [], extra = {}, wornAtStart = true } = {}) {
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.channel.v1', channel],
    ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix, defaultsOff, defaultsMigrated: true, machinesHomeMoved: true, ...extra })]]);
  const events = [], updates = [], timers = []; let active = [], sync = null;
  const own = recipe ? { id: 'skin-1', name: 'Mine', base: 'obsidian', tweaks: { ...recipe } } : null; let worn = wornAtStart;
  const window = {
    WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, layout: 'classic', setLayout() {}, loadTweaks: async ids => { active = ids; } },
    WosMySkin: { get active() { return worn ? own : null; }, update: async v => { updates.push(clone(v)); Object.assign(own.tweaks, v.tweaks); } },
    addEventListener() {},
    // What look-sync.js listens to in the shell: an owner's switch becomes a shared choice.
    dispatchEvent: e => { if (e.type !== 'wos:tweak-choice') return; events.push(clone(e.detail)); if (!sync) return; e.detail.scope === 'default' ? sync.defaultChoice(e.detail.id, e.detail.on) : sync.tweakChoice(e.detail.id, e.detail.on); },
  };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  const E = window.WosExperience;
  if (box) sync = L.create({ req: box.req, store: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }, exp: E,
    skin: { chosen: null, current: 'obsidian', desktopBackdrop: { id: 'living' }, has: () => true, set() {} },
    later: (f, ms) => { const t = { f, ms }; timers.push(t); return t; }, cancel: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); } });
  const flush = async () => { while (timers.length) { await timers.shift().f(); await tick(); } };
  const saved = () => JSON.parse(storage.get('wos.skin-tweaks.v1'));
  const running = () => Array.from(active).filter(id => !builtinDefaults(catalog).includes(id)).sort();
  return { E, sync, flush, events, updates, own, saved, running, wear: () => { worn = true; }, builtinOn: () => Array.from(active).includes(builtin) };
}
const sharedOn = doc => Object.keys(doc?.tweaks || {}).filter(id => doc.tweaks[id].on).sort();
const mixOn = mix => Object.keys(mix).filter(id => mix[id] === true).sort();

// The tester's old state: shared switches with Send and go plus two more on; the own skin worn here turned Archive first
// and Reply summary on, Send and go and the built-in default off. Before, the skin decided what it saved a choice for
// and the owner's other switches ran too (#1529).
const OLD_MIX = { 'miguel/send-and-go': true, 'wizard/failure-reason': true, 'wizard/link-token-repair': true };
const OLD_RECIPE = { 'miguel/archive-top': true, 'miguel/reply-summary': true, 'miguel/send-and-go': false, [builtin]: false };
const RAN_BEFORE = ['miguel/archive-top', 'miguel/reply-summary', 'wizard/failure-reason', 'wizard/link-token-repair'];

test('the old switch is gone: not in the catalog, not offered, and its stored value is cleared', async () => {
  assert.ok(!catalog.tweaks.includes(OLD) && !catalog.defaults.includes(OLD));
  assert.equal(catalog.lookOnlyOff, undefined, 'the drop list went with the switch');
  const d = device(null, { mix: { ...OLD_MIX, [OLD]: true } }); await d.E.refresh();
  assert.ok(!d.E.state.tweaks.some(t => t.id === OLD));
  assert.ok(!d.running().includes(OLD));
  assert.equal(Object.hasOwn(d.saved().mix, OLD), false, 'cleared from this device');
  assert.equal(d.saved().recipeCarried, true, 'a device that had it on already carried its skin then');
  assert.deepEqual(d.running(), mixOn(OLD_MIX));
  assert.equal('lookOnly' in d.E, false);
});

test('an old device whose own skin decided comes up running the same features, now from the shared switches', async () => {
  const d = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE }); await d.E.refresh();
  assert.deepEqual(d.running(), RAN_BEFORE, 'exactly what it ran');
  assert.equal(d.builtinOn(), false, 'the skin\'s built-in off is now the shared built-in off');
  const mix = d.saved().mix;
  assert.deepEqual(d.running(), mixOn(mix), 'what runs is the shared switches');
  assert.ok(d.saved().defaultsOff.includes(builtin));
  // Every carried choice went out as an owner switch (look sync shares them), and nothing was written into the skin.
  assert.deepEqual(d.events.map(e => e.id).sort(), [builtin, 'miguel/archive-top', 'miguel/reply-summary', 'miguel/send-and-go'].sort());
  assert.deepEqual(d.events.find(e => e.id === builtin), { id: builtin, on: false, scope: 'default' });
  assert.equal(d.updates.length, 0); assert.deepEqual({ ...d.own.tweaks }, OLD_RECIPE, 'the skin recipe is left as it was');
  assert.equal(d.saved().recipeCarried, true);
});

test('a flip goes to the shared switches, never into the worn skin', async () => {
  const d = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE }); await d.E.refresh();
  await d.E.toggle('miguel/snooze-someday');
  assert.equal(d.updates.length, 0, 'no write into the skin recipe');
  assert.equal(d.saved().mix['miguel/snooze-someday'], true);
  assert.deepEqual(d.events.at(-1), { id: 'miguel/snooze-someday', on: true });
  assert.ok(d.running().includes('miguel/snooze-someday'));
});

test('once per device: a newer shared choice is never undone by the old recipe', async () => {
  const d = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE }); await d.E.refresh();
  await d.E.toggle('miguel/archive-top'); // a newer shared choice (Settings or the Tracker)
  await d.E.refresh(); await d.E.refresh();
  assert.ok(!d.running().includes('miguel/archive-top'));
  assert.equal(d.saved().mix['miguel/archive-top'], undefined);
});

test('no own skin, or one with no choices, carries nothing and changes nothing', async () => {
  for (const recipe of [null, {}]) {
    const d = device(null, { mix: OLD_MIX, recipe }); await d.E.refresh();
    assert.deepEqual(d.events, []);
    assert.deepEqual(d.running(), mixOn(OLD_MIX));
  }
});

test('wearing an old own skin later changes no feature: only the skin worn at the first load is carried', async () => {
  const d = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE, wornAtStart: false }); await d.E.refresh();
  assert.equal(d.saved().recipeCarried, true, 'marked at the first load, own skin worn or not');
  assert.deepEqual(d.running(), mixOn(OLD_MIX));
  d.wear(); await d.E.refresh();
  assert.deepEqual(d.events, [], 'nothing shared');
  assert.deepEqual(d.running(), mixOn(OLD_MIX), 'the same features run');
  assert.equal(d.builtinOn(), true);
});

test('For everyone: nothing experimental runs, whatever the skin chose', async () => {
  const s = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE, channel: 'stable' }); await s.E.refresh();
  assert.deepEqual(s.running(), []);
  assert.ok(s.E.state.tweaks.filter(t => !t.builtin && !t.view).every(t => t.on === false && t.locked));
});

test('look sync: a shared look.json still carrying the old switch adopts the rest and ignores it', async () => {
  const d = device(null, { mix: OLD_MIX }); await d.E.refresh();
  const id = builtin;
  await d.E.adopt({ 'miguel/send-and-go': true, [OLD]: true }, undefined, { [id]: false });
  assert.equal(Object.hasOwn(d.saved().mix, OLD), false);
  assert.deepEqual(d.running(), ['miguel/send-and-go']);
  assert.ok(d.saved().defaultsOff.includes(id), 'shared built-in defaults are taken now, own skin or not');
  const w = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE }); await w.E.refresh();
  await w.E.adopt({ 'miguel/send-and-go': true }, undefined, { [id]: true });
  assert.ok(!(w.saved().defaultsOff || []).includes(id), 'a worn own skin no longer holds the shared defaults back');
});

test('two devices: the one with the old skin carries it, the other catches up to the same switches', async () => {
  let t = 0;
  const box = pagesBox({ version: 1, skin: null, tweaks: Object.fromEntries(Object.keys(OLD_MIX).map(id => [id, { on: true, at: ++t }])) });
  const mac = device(box, { mix: OLD_MIX });
  await mac.E.refresh(); await mac.sync.sync(); await tick();
  const phone = device(box, { mix: OLD_MIX, recipe: OLD_RECIPE });
  await phone.E.refresh(); await tick();
  // Simultaneous: the phone's carry and the Mac switching Snooze someday on; both read before either writes.
  await mac.E.toggle('miguel/snooze-someday');
  await Promise.all([phone.flush(), mac.flush()]);
  await phone.sync.sync(); await mac.sync.sync(); await tick();
  await Promise.all([phone.flush(), mac.flush()]);
  const shared = sharedOn(box.doc());
  assert.deepEqual(shared, [...RAN_BEFORE, 'miguel/snooze-someday'].sort(), 'both edits kept');
  assert.equal(box.doc().defaults?.[builtin]?.on, false);
  for (const d of [mac, phone]) { await d.sync.sync(); await tick(); await d.E.whenReady(); }
  for (const [n, d] of Object.entries({ phone, mac })) { assert.deepEqual(d.running(), shared, n); assert.equal(d.builtinOn(), false, n); }
  assert.deepEqual(sharedOn(box.doc()), shared, 'catching up writes nothing new');
});
