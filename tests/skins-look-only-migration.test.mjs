// One system for trying changes (wizard-ux#1190), slice 3, behind the same off-by-default switch wizard/skins-look-only.
// A tester device with old tweaks saved (an own skin that chose tweaks, drop-list tweaks on) comes up matching the
// owner's shared feature switches: turning the switch on carries the worn skin's choices into the shared set once
// (look sync takes them to look.json, so every device and the Tracker match), and the drop-list tweaks are off.
// Real experience.js and real look-sync.js, two devices on one fake Pages file (AGENTS.md: synced state needs a
// stale-device and a simultaneous-edit test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const ID = 'wizard/skins-look-only';
const catalog = JSON.parse(read('web/tweaks/catalog.json'));
const builtin = catalog.defaults[0];
const DROP = ['wizard/two-orbs', 'wizard/app-borders', 'miguel/no-desk-close', 'wizard/pin-buttons', 'wizard/wizardos-name'];
const PATH = '/wizard/v1/pages/wizard-look/look.json';

function lookSync() { const window = {}; vm.runInNewContext(read('web/core/look-sync.js'), { window, JSON, Object, Date, Math, Number, Error, setTimeout, clearTimeout }); return window.WosLookSync; }
const L = lookSync();

// The Agent Service Pages file API: versioned, a stale save is a 409 carrying the newer text.
function pagesBox(doc = null) {
  const ver = t => createHash('sha1').update(t).digest('hex');
  const box = { text: doc ? JSON.stringify(doc) : null, held: 0, waiters: [] };
  box.doc = () => (box.text ? JSON.parse(box.text) : null);
  box.race = n => { box.held = n; };
  box.req = async (url, init = {}) => {
    assert.equal(url, PATH);
    if (box.held > 0) { box.held--; await new Promise(r => { box.waiters.push(r); if (box.held === 0) box.waiters.splice(0).forEach(f => f()); }); }
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
function device(box, { mix = {}, recipe = null, channel = 'latest', defaultsOff = [] } = {}) {
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.channel.v1', channel],
    ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix, defaultsOff, defaultsMigrated: true, machinesHomeMoved: true })]]);
  const events = [], updates = [], timers = []; let active = [], sync = null;
  const own = recipe ? { id: 'skin-1', name: 'Mine', base: 'obsidian', tweaks: { ...recipe } } : null;
  const window = {
    WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, layout: 'classic', setLayout() {}, loadTweaks: async ids => { active = ids; } },
    WosMySkin: { get active() { return own; }, update: async v => { updates.push(clone(v)); Object.assign(own.tweaks, v.tweaks); } },
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
  const running = () => Array.from(active).filter(id => !catalog.defaults.includes(id)).sort();
  return { E, sync, flush, events, updates, own, saved, running, builtinOn: () => Array.from(active).includes(builtin) };
}
const sharedOn = doc => Object.keys(doc?.tweaks || {}).filter(id => doc.tweaks[id].on).sort();
const mixOn = mix => Object.keys(mix).filter(id => mix[id] === true).sort();

// The tester's old state: shared switches with Send and go plus two drop-list tweaks on; the own skin worn here turns
// Archive first and Reply summary on, Send and go and the built-in default off, and picks a shell view and a drop item.
const OLD_MIX = { 'miguel/send-and-go': true, 'wizard/pin-buttons': true, 'wizard/two-orbs': true };
const OLD_RECIPE = { 'miguel/archive-top': true, 'miguel/reply-summary': true, 'miguel/send-and-go': false, [builtin]: false, 'miguel/orb-shell': true, 'miguel/no-desk-close': true };

test('the drop list (catalog lookOnlyOff) names real catalog tweaks, none a built-in default or the switch itself', () => {
  assert.deepEqual(catalog.lookOnlyOff, DROP);
  for (const id of DROP) { assert.ok(catalog.tweaks.includes(id), id); assert.ok(!catalog.defaults.includes(id), id); }
  assert.ok(!DROP.includes(ID));
});

test('switch off (today): nothing changes, the skin still decides and drop-list tweaks still run', async () => {
  const d = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE }); await d.E.refresh();
  assert.deepEqual(d.running(), ['miguel/archive-top', 'miguel/no-desk-close', 'miguel/orb-shell', 'miguel/reply-summary']);
  assert.ok(d.E.state.tweaks.some(t => t.id === 'wizard/pin-buttons'), 'drop items still offered');
  assert.equal(d.saved().recipeCarried, undefined);
});

test('turning it on: an old tester device comes up matching the shared switches, the skin recipe kept', async () => {
  const d = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE }); await d.E.refresh();
  await d.E.toggle(ID);
  const mix = d.saved().mix;
  // What runs is exactly the shared switches (minus the drop list), nothing more from the skin.
  assert.deepEqual(d.running(), mixOn(mix).filter(id => !DROP.includes(id)));
  assert.deepEqual(d.running(), ['miguel/archive-top', 'miguel/reply-summary', ID].sort());
  assert.equal(d.builtinOn(), false, 'the skin\'s built-in off is now the shared built-in off');
  assert.ok(d.saved().defaultsOff.includes(builtin));
  // Every carried choice went out as an owner switch (look sync shares them), and nothing was written into the skin.
  assert.deepEqual(d.events.map(e => e.id).sort(), [ID, builtin, 'miguel/archive-top', 'miguel/reply-summary', 'miguel/send-and-go'].sort());
  assert.deepEqual(d.events.find(e => e.id === builtin), { id: builtin, on: false, scope: 'default' });
  assert.equal(d.updates.length, 0); assert.deepEqual({ ...d.own.tweaks }, OLD_RECIPE);
  // Views and drop-list items are not carried; drop-list tweaks are off and not offered, their saved choice kept.
  assert.ok(!d.events.some(e => e.id === 'miguel/orb-shell' || DROP.includes(e.id)));
  for (const id of DROP) { assert.ok(!d.running().includes(id), id); assert.ok(!d.E.state.tweaks.some(t => t.id === id), id); }
  assert.equal(mix['wizard/pin-buttons'], true, 'nothing deleted');
  assert.equal(d.saved().recipeCarried, true);
  assert.ok(!d.running().includes('miguel/orb-shell'), 'the skin\'s view is not worn either');
  // Off again: the skin decides again, its drop-list pick and view included.
  await d.E.toggle(ID);
  assert.ok(d.running().includes('miguel/no-desk-close') && d.running().includes('miguel/orb-shell'));
});

test('once per device: off and on again never re-applies the old recipe over a newer shared choice', async () => {
  const d = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE }); await d.E.refresh();
  await d.E.toggle(ID);
  await d.E.toggle('miguel/archive-top'); // a newer shared choice (Settings or the Tracker)
  await d.E.toggle(ID); await d.E.toggle(ID);
  assert.ok(!d.running().includes('miguel/archive-top'));
  assert.equal(d.saved().mix['miguel/archive-top'], undefined);
});

test('a device without an own skin, and For everyone, carry nothing', async () => {
  const d = device(null, { mix: OLD_MIX }); await d.E.refresh();
  await d.E.toggle(ID);
  assert.deepEqual(d.events, [{ id: ID, on: true }]);
  assert.deepEqual(d.running(), ['miguel/send-and-go', ID].sort());
  const s = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE, channel: 'stable' }); await s.E.refresh();
  await assert.rejects(s.E.toggle(ID), /For testers/);
  assert.deepEqual(s.events, []); assert.equal(s.saved().recipeCarried, undefined);
});

test('another device adopting the switch from look sync carries nothing of its own skin (one owner action, one migration)', async () => {
  const d = device(null, { mix: OLD_MIX, recipe: OLD_RECIPE }); await d.E.refresh();
  await d.E.adopt({ 'miguel/send-and-go': true, [ID]: true });
  assert.deepEqual(d.events, []);
  assert.deepEqual(d.running(), ['miguel/send-and-go', ID].sort());
});

test('two devices: the device that turns it on carries its skin; a stale second device ends up on the same switches', async () => {
  let t = 0;
  const box = pagesBox({ version: 1, skin: null, tweaks: Object.fromEntries(Object.keys(OLD_MIX).map(id => [id, { on: true, at: ++t }])) });
  const phone = device(box, { mix: OLD_MIX, recipe: OLD_RECIPE }), mac = device(box, { mix: OLD_MIX });
  const stale = device(box, { mix: OLD_MIX, recipe: { 'miguel/calm-offline': true } });
  for (const d of [phone, mac, stale]) { await d.E.refresh(); await d.sync.sync(); await tick(); }
  // Simultaneous: the phone turns the switch on while the Mac switches Group by day on; both read before either writes.
  await phone.E.toggle(ID); await mac.E.toggle('miguel/group-by-day');
  box.race(2); await Promise.all([phone.flush(), mac.flush()]);
  const shared = sharedOn(box.doc());
  assert.deepEqual(shared, [ID, 'miguel/archive-top', 'miguel/reply-summary', 'wizard/pin-buttons', 'wizard/two-orbs', 'miguel/group-by-day'].sort(), 'both edits kept');
  assert.equal(box.doc().defaults?.[builtin]?.on, false);
  // Every device catches up, the stale one too: same switches; its own skin (which chose Calm offline) is set aside, nothing carried.
  for (const d of [stale, mac, phone]) { await d.sync.sync(); await tick(); await d.E.whenReady(); }
  const expected = shared.filter(id => !DROP.includes(id));
  for (const [n, d] of Object.entries({ phone, mac, stale })) { assert.deepEqual(d.running(), expected, n); assert.equal(d.builtinOn(), false, n); }
  assert.deepEqual(stale.events, [], 'the stale device carried nothing');
  assert.deepEqual(sharedOn(box.doc()), shared, 'catching up writes nothing new');
});
