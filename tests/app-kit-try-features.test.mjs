// The shared "Try new features" section (wizard-os#627, ux#1455) is served from the shell kit at
// /wizard-os-home/kit/wizard-try-features.js, byte-identical to wizard-os style/try-features.js. The canonical
// style policy mirror (tools/style/style-policy.json) hash-locks that copy, so any edit here fails the ratchet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const kit = readFileSync(new URL('web/kit/wizard-try-features.js', root));
const policy = JSON.parse(readFileSync(new URL('tools/style/style-policy.json', root), 'utf8'));

// static-rule: the kit mirror and the canonical style policy must agree byte for byte (files that must agree).
test('kit copy matches the canonical hash in the style policy', () => {
  const pin = policy.assets['wizard-try-features.js'];
  assert.ok(pin, 'policy names the kit copy');
  assert.equal(pin.source, 'style/try-features.js');
  assert.equal(createHash('sha256').update(kit).digest('hex'), pin.sha256);
  assert.equal(policy.assets['try-features.js'].sha256, pin.sha256, 'kit and source names carry the same hash');
});

test('kit copy defines WzTryFeatures and does nothing on its own', () => {
  const window = {};
  vm.runInNewContext(kit.toString('utf8'), { window, globalThis: window, document: undefined });
  const api = window.WzTryFeatures;
  assert.ok(api && typeof api.mount === 'function', 'exposes WzTryFeatures.mount');
});

// wizard-os#916: a re-read sent before a save (or while it is in flight) never paints the old state over the save.
test('an older re-read answering after a save does not show the switch reverted', async () => {
  const window = {};
  vm.runInNewContext(kit.toString('utf8'), { window, globalThis: window, document: undefined });
  const T = window.WzTryFeatures;
  let box = { contract: 'wizard.app-switches/1', switches: [{ id: 'drag-events', name: 'Drag events', on: false, vote: null }] };
  const res = data => ({ ok: true, status: 200, json: async () => data });
  const snap = () => res(JSON.parse(JSON.stringify(box)));
  const gets = [], posts = [];
  const fetch = (path, init = {}) => {
    if (init.method === 'POST') return new Promise(r => posts.push(() => { const b = JSON.parse(init.body); Object.assign(box.switches[0], 'on' in b ? { on: b.on } : { vote: b.vote }); r(snap()); }));
    const s = snap(); return new Promise(r => gets.push(() => r(s)));
  };
  const listeners = {};
  const doc = { head: { appendChild() {} }, visibilityState: 'visible', getElementById: () => null, createElement: () => ({}),
    addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); } };
  const el = { innerHTML: '', hidden: false, classList: { add() {} }, addEventListener() {}, querySelectorAll: () => [] };
  const checked = () => /data-try-id="drag-events"[\s\S]*?aria-checked="(true|false)"/.exec(el.innerHTML)[1];
  const m = T.mount(el, { fetch, document: doc }); gets.shift()(); await m.ready;
  assert.equal(checked(), 'false');

  const stale = m.reload();                          // sent while the box still says Off
  const save = m.send('drag-events', 'toggle');      // the flip
  listeners.visibilitychange.forEach(fn => fn());    // page visible again during the save
  assert.equal(gets.length, 1, 'no new read while the save is in flight');
  posts.shift()(); await save;
  assert.equal(checked(), 'true');
  gets.shift()(); await stale;                       // the older read answers last
  assert.equal(checked(), 'true', 'switch does not look reverted');
  assert.equal(m.listing.switches[0].on, true);

  box.switches[0].on = false;                        // flipped from the Tracker: a later read still shows it
  const later = m.reload(); gets.shift()(); await later;
  assert.equal(checked(), 'false');
});
