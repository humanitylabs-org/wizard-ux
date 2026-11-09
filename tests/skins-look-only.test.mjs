// One system for trying changes (wizard-ux#1190, Miguel 9 Nov 2026): feature switches replace tweaks, and a skin is a
// look only. First slice, behind the off-by-default switch wizard/skins-look-only: while it is on, an own skin's saved
// tweak choices stop deciding what runs; only the shared feature switches (Settings + the WizardOS Tracker) do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ID = 'wizard/skins-look-only';
const catalog = JSON.parse(read('web/tweaks/catalog.json'));
const builtins = catalog.defaults || [];
// The shared switches: only Send and go is on. The own skin brings Archive first and turns Send and go off.
const MIX = { 'miguel/send-and-go': true };
const RECIPE = { 'miguel/archive-top': true, 'miguel/send-and-go': false };

function box({ mix = MIX, channel = 'latest', recipe = RECIPE } = {}) {
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix, machinesHomeMoved: true })]]);
  if (channel) storage.set('wos.channel.v1', channel);
  const listeners = {}, events = [], updates = []; let active = [];
  const own = recipe ? { id: 'skin-1', name: 'Mine', base: 'obsidian', tweaks: { ...recipe } } : null;
  const window = {
    WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } },
    WosMySkin: { get active() { return own; }, update: async v => { updates.push(v); Object.assign(own.tweaks, v.tweaks); } },
    addEventListener: (k, f) => { (listeners[k] ||= []).push(f); },
    dispatchEvent: e => { if (e.type === 'wos:tweak-choice') events.push(JSON.parse(JSON.stringify(e.detail))); },
  };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  const saved = () => JSON.parse(storage.get('wos.skin-tweaks.v1'));
  return { E: window.WosExperience, events, updates, saved, own, running: () => Array.from(active).filter(id => !builtins.includes(id)).sort() };
}

test('the switch is a normal catalog tweak, off by default and never in a published profile', () => {
  assert.ok(catalog.tweaks.includes(ID));
  assert.ok(!builtins.includes(ID), 'not a built-in default');
  for (const who of catalog.profiles) assert.ok(!(JSON.parse(read(`web/tweaks/${who}/profile.json`)).tweaks || []).includes(ID), who);
  const m = JSON.parse(read(`web/tweaks/${ID}/manifest.json`));
  assert.equal(m.id, ID); assert.equal(m.author, 'wizard');
});

test('switch off (today): an own skin still decides which tweaks run', async () => {
  const b = box(); await b.E.refresh();
  assert.deepEqual(b.running(), ['miguel/archive-top']);
  assert.equal(b.E.state.tweaks.find(t => t.id === ID).on, false);
});

test('switch on: the own skin is look only, the shared feature switches decide, and its choices are kept', async () => {
  const b = box({ mix: { ...MIX, [ID]: true } }); await b.E.refresh();
  assert.deepEqual(b.running(), ['miguel/send-and-go', ID].sort());
  assert.deepEqual({ ...b.own.tweaks }, RECIPE, 'the skin recipe is untouched');
  // A flip now goes to the shared switches (and to look sync / the Tracker), never into the skin.
  await b.E.toggle('miguel/archive-top');
  assert.equal(b.updates.length, 0, 'no write into the skin recipe');
  assert.equal(b.saved().mix['miguel/archive-top'], true);
  assert.deepEqual(b.events.at(-1), { id: 'miguel/archive-top', on: true });
  assert.deepEqual(b.running(), ['miguel/archive-top', 'miguel/send-and-go', ID].sort());
});

test('turning the switch on and off with an own skin worn goes through the shared mix both ways', async () => {
  const b = box(); await b.E.refresh();
  await b.E.toggle(ID);
  assert.equal(b.updates.length, 0, 'the switch is never stored in a skin');
  assert.equal(b.saved().mix[ID], true);
  assert.deepEqual(b.events[0], { id: ID, on: true });
  // Slice 3: turning it on here carries the worn skin's choices into the shared switches once (skins-look-only-migration).
  assert.deepEqual(b.running(), ['miguel/archive-top', ID].sort());
  await b.E.toggle(ID);
  assert.equal(b.saved().mix[ID], undefined);
  assert.deepEqual(b.events.at(-1), { id: ID, on: false });
  assert.deepEqual(b.running(), ['miguel/archive-top'], 'the skin\'s own choices come back');
});

test('For everyone keeps it off like every feature switch', async () => {
  const b = box({ mix: { ...MIX, [ID]: true }, channel: 'stable' }); await b.E.refresh();
  assert.deepEqual(b.running(), []);
  const t = b.E.state.tweaks.find(x => x.id === ID);
  assert.equal(t.on, false); assert.equal(t.locked, true);
});

test('without an own skin nothing changes', async () => {
  for (const on of [false, true]) {
    const b = box({ recipe: null, mix: on ? { ...MIX, [ID]: true } : MIX }); await b.E.refresh();
    assert.deepEqual(b.running(), on ? ['miguel/send-and-go', ID].sort() : ['miguel/send-and-go']);
  }
});

test('look sync turning it on from another device adopts the shared built-in defaults in the same step', async () => {
  const b = box(); await b.E.refresh();
  const id = builtins[0]; assert.ok(id, 'catalog has a built-in default');
  await b.E.adopt({ 'miguel/send-and-go': true, [ID]: true }, undefined, { [id]: false });
  assert.ok(b.saved().defaultsOff.includes(id), 'the shared built-in off is taken now, not on the next poll');
  assert.ok(!b.running().includes(id) && !b.E.state.tweaks.find(t => t.id === id).on);
  // Still worn without the switch: the skin decides, so the shared defaults wait (unchanged behaviour).
  const c = box(); await c.E.refresh();
  await c.E.adopt({ 'miguel/send-and-go': true }, undefined, { [id]: false });
  assert.ok(!(c.saved().defaultsOff || []).includes(id));
});
