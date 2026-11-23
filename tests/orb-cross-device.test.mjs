import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { between } from './fixtures/source-slice.mjs';
const read = p => withShellParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));

// Core loads before app.js, not through a per-device saved tweak membership or lazy import.
function client(choice) {
  const storage = new Map([['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, mix: { 'wizard/orb-radial': choice } })], ['wos.orbSwitcher.v1', JSON.stringify({ pins: ['home'], holdMs: 450 })]]);
  const window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const context = { window, document: { querySelectorAll: () => [], body: { classList: { remove() {} } } }, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, CustomEvent: class {}, setTimeout, clearTimeout };
  vm.runInNewContext(read('web/core/orb-switcher.js'), context);
  return window.WosCreateOrbSwitcher({ apps: () => [], cancelGesture() {}, hover() {} });
}

test('independent clients with saved ON, OFF or missing radial membership all install a ready core handler', () => {
  const clients = [true, false, undefined].map(client);
  for (const c of clients) { assert.equal(c.active(), true); assert.equal(c.get().holdMs, 450); assert.deepEqual(Array.from(c.get().pins), ['home']); }
  clients[0].dispose(); assert.equal(clients[1].active(), true); assert.equal(clients[2].active(), true);
  clients.forEach(c => c.dispose());
});

test('no cached rejected lazy-import path or tweak teardown can strand the core handler', () => {
  assert.doesNotMatch(read('web/core/skin-host.js'), /orb-switcher\.js|api\.orb =|orbRetry/);
  assert.doesNotMatch(read('web/core/orb-switcher.js'), /import\(/);
  // The phone page loads the switcher as a plain script before app.js.
  const doc = createDocument(); doc.documentElement.innerHTML = read('web/index.html').replace(/^<!doctype html>/i, '');
  const order = doc.querySelectorAll('script[src]').map(x => x.getAttribute('src'));
  assert.ok(order.includes('core/orb-switcher.js') && order.indexOf('core/orb-switcher.js') < order.indexOf('app.js'));
  assert.equal(doc.querySelector('script[src="core/orb-switcher.js"]').getAttribute('type'), null, 'not a lazy module');
  // app.js (its orb-swipe part) installs the core handler itself, with every saved radial membership.
  const line = between(readFileSync(new URL('../web/app-orbswipe.js', import.meta.url), 'utf8'), '  window.WosCreateOrbSwitcher(orbSwitcherHost);', '\n');
  for (const choice of [true, false, undefined]) {
    const storage = new Map([['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, mix: { 'wizard/orb-radial': choice } })]]);
    const window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    const ctx = { window, document: { querySelectorAll: () => [], body: { classList: { remove() {} } } }, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, CustomEvent: class {}, setTimeout, clearTimeout,
      orbSwitcherHost: { apps: () => [], cancelGesture() {}, hover() {} } };
    vm.createContext(ctx);
    vm.runInContext(read('web/core/orb-switcher.js'), ctx);
    vm.runInContext(line, ctx);
    assert.equal(window.WosOrbSwitcher?.active(), true, `radial ${choice}: the core handler is installed and ready`);
    window.WosOrbSwitcher.dispose();
  }
});
