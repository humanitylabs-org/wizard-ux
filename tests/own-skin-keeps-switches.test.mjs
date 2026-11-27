// wizard-ux#1529: wearing an own skin must not switch the owner's features off. A Files skin has no saved feature
// choices (`tweaks: {}`), so every switch it does not name follows the owner's own switches; a choice the skin did
// save still wins for that one switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const catalog = JSON.parse(read('web/tweaks/catalog.json'));
const builtins = catalog.defaults || [];
const MIX = { 'wizard/phone-recovery-mode': true, 'miguel/now-playing': true, 'wizard/failure-reason': true };

function box({ recipe }) {
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.channel.v1', 'latest'],
    ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix: MIX, machinesHomeMoved: true })]]);
  const updates = []; let active = [];
  const own = recipe ? { id: 'files:Test', name: 'Test', base: 'obsidian', tweaks: { ...recipe } } : null;
  const window = {
    WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' },
    WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } },
    WosMySkin: { get active() { return own; }, update: async v => { updates.push(v); Object.assign(own.tweaks, v.tweaks); } },
    addEventListener() {}, dispatchEvent() {},
  };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  return { E: window.WosExperience, updates, running: () => Array.from(active).filter(id => !builtins.includes(id)).sort() };
}

test('a worn Files skin with no saved choices keeps every feature the owner has on', async () => {
  const bare = box({ recipe: null }); await bare.E.refresh();
  const b = box({ recipe: {} }); await b.E.refresh();
  assert.deepEqual(b.running(), bare.running(), 'the same features run with and without the skin');
  for (const id of Object.keys(MIX)) {
    assert.ok(b.running().includes(id), `${id} still runs`);
    assert.equal(b.E.state.tweaks.find(t => t.id === id)?.on, true, `${id} shows on in Settings`);
  }
});

test('a choice the skin did save still decides that one switch', async () => {
  const b = box({ recipe: { 'miguel/now-playing': false } }); await b.E.refresh();
  assert.ok(!b.running().includes('miguel/now-playing'));
  assert.ok(b.running().includes('wizard/phone-recovery-mode'));
  assert.ok(b.running().includes('wizard/failure-reason'));
});
