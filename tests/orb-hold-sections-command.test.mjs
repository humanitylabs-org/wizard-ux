// owner-correction: humanitylabs-org/wizard-ux#1958 · 2026-11-27 · "On mine, holding the orb still has that radial quick switcher, so let's remove that. It won't be necessary anymore."
// With the phone's four-section bar on (every phone since #1956), holding the orb is the plain hold-to-command: the
// real core/orb-switcher.js reports itself inactive and unavailable, and the real dock-orb press (app-orbswipe.js)
// starts a command take instead of opening the radial. Saved radial pins stay in storage untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { orbHold } from './fixtures/r8B-orbhold.mjs';

const SRC = readFileSync(new URL('../web/core/orb-switcher.js', import.meta.url), 'utf8');
const SAVED = { pins: ['notes', 'wizard-music'], voiceSlot: 'far', holdMs: 450, quickTakes: true };

function realSwitcher(barOn) {
  const storage = new Map([['wos.orbSwitcher.v1', JSON.stringify(SAVED)]]);
  const window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, WizCore: { phoneSections: { on: () => barOn.value } } };
  const context = { window, document: { querySelectorAll: () => [], body: { classList: { remove() {} } } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) }, CustomEvent: class {}, setTimeout, clearTimeout };
  const create = vm.runInNewContext(SRC + '\n;window.WosCreateOrbSwitcher;', context);
  const sw = create({ cancelGesture() {}, hover() {}, voice: {}, apps: () => [], openItems: () => [] });
  return { sw, storage, window };
}

test('holding the orb with the phone bar on starts a command, never the radial (wizard-ux#1958)', async () => {
  const bar = { value: true };
  const { sw, storage } = realSwitcher(bar);
  assert.equal(sw.active(), false, 'the radial is off while the bar is on');
  assert.equal(sw.available, false, 'so the Orb switcher row is not offered in phone Settings');
  const opened = []; const realOpen = sw.open; sw.open = o => { opened.push(o); return realOpen(o); };
  const h = await orbHold({ switcher: sw });
  h.down(); await h.advance(450);
  assert.deepEqual(opened, [], 'no radial opens');
  assert.deepEqual(h.takes, ['command'], 'the hold is the plain hold-to-command');
  assert.equal(h.appVars.G.mode, 'hold');
  assert.equal(h.V.state, 'command');
  assert.deepEqual(JSON.parse(storage.get('wos.orbSwitcher.v1')), SAVED, 'saved radial pins and options stay untouched');
  // Its "Short takes run as commands" option lives only in the hidden sheet, so it no longer applies: a tap is a message.
  assert.equal(sw.active() && sw.get().quickTakes, false);
});

test('a tap still talks with the bar on', async () => {
  const { sw } = realSwitcher({ value: true });
  const h = await orbHold({ switcher: sw });
  h.down(); await h.advance(60); h.up(); await h.settle();
  assert.deepEqual(h.takes, ['tap']);
});

test('without the bar (no section bar in this shell) the radial behaves as before', async () => {
  const { sw } = realSwitcher({ value: false });
  assert.equal(sw.active(), true); assert.equal(sw.available, true);
  sw.dispose(); assert.equal(sw.active(), false);
});
