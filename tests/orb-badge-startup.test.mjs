import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const source = f => fs.readFileSync(process.env.QA_TREE ? path.join(process.env.QA_TREE, f) : new URL('../' + f, import.meta.url), 'utf8');

test('Orb cold badge subscription returns its snapshot without invoking the watcher; startup and later paints remain intact', () => {
  const host = source('web/core/skin-host.js'), orb = source('web/layouts/orb/layout.js');
  const method = host.slice(host.indexOf('        badges(watch) {'), host.indexOf('\n      }),', host.indexOf('        badges(watch) {')));
  assert.ok(method.startsWith('        badges(watch) {'));
  const subscription = orb.split('\n').find(l => l.includes('let badgeMap = api.apps.badges('));
  const state = orb.split('\n').find(l => l.includes("let folded = api.storage.get('folded')"));
  const ready = orb.slice(orb.indexOf('  function paintReady()'), orb.indexOf('  function fold('));
  const paint = orb.slice(orb.indexOf('  function paint() {'), orb.indexOf('  api.mount(grips);'));
  assert.match(orb.slice(orb.indexOf('  api.mount(grips);')), /\n  paint\(\);/);
  const listeners = new Map(), counts = { wizard: 2 }, calls = [], badge = {}, strip = { setAttribute(k, v) { this[k] = v; } };
  const c = { Object, isDoc: true, live: () => true, guard: (_a, _kind, fn) => fn, a: { offs: new Set() },
    WizCore: { workspaceNav: { counts } }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    badge, strip, flash: 0, sats: [], home: true, paintVisible() {}, paintPanel() {}, paintApps: () => calls.push('apps'), paintBadge() {} };
  c.window = c; vm.createContext(c);
  const badges = vm.runInContext('({' + method + '}).badges', c);
  c.api = { apps: { badges, badgeText: () => String(counts.wizard || '') }, storage: { get: () => false } };
  c.getCalls = () => calls.length;
  // Keep the real order: subscription precedes unreadCount initialization. An eager callback would throw here.
  vm.runInContext(`(() => { ${subscription}
    globalThis.coldCalls = getCalls();
    ${state}
    ${ready}
    ${paint}
    paint();
  })()`, c);
  assert.equal(c.coldCalls, 0, 'badges() must not invoke paintApps/paintReady during subscription');
  assert.deepEqual(calls, ['apps'], 'existing explicit startup paintApps is retained');
  assert.equal(badge.textContent, '2'); assert.equal(strip['aria-label'], 'Show conversations · 2 unread');
  counts.wizard = 3; listeners.get('wizard:app-counts')();
  assert.deepEqual(calls, ['apps', 'apps']); assert.equal(badge.textContent, '3'); assert.equal(c.flash, .6);
  counts.wizard = 0; listeners.get('wizard:app-counts')();
  assert.equal(badge.hidden, true); assert.equal(strip['aria-label'], 'Show conversations');
  for (const off of [...c.a.offs]) off();
  assert.equal(listeners.size, 0);
});
