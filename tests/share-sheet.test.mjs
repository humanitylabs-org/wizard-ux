import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../web/core/share-sheet.js', import.meta.url), 'utf8');
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
function load({ apps = { messenger: { kind: 'wizard', name: 'Messenger' } }, open = () => true } = {}) {
  const events = [];
  let ops = null;
  const window = { WizCore: { apps: () => ({ APP: apps }) }, WizOpenApp: open, dispatchEvent: e => events.push(e), WizAppServices: { claimShare: o => (ops ? false : (ops = o, true)) } };
  const ctx = { window, localStorage: store(), sessionStorage: store(), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, document: {}, requestAnimationFrame: f => f(), setTimeout };
  vm.runInNewContext(src, ctx);
  return { S: Object.assign({}, window.WosShareSheet, ops), G: window.WosShareSheet, events, claim: window.WizAppServices.claimShare };
}

test('Messenger is offered before it was ever opened; with no receiver installed Share goes straight out', async () => {
  assert.equal(load().S.wants('text'), true);
  const { S } = load({ apps: { calendar: { kind: 'wizard', name: 'Calendar' } } });
  assert.equal(S.wants('text'), false);
  assert.equal(await S.show({ text: 'hi' }, async () => 'shared'), 'shared');
  assert.equal(S.isOpen(), false);
});

test('registry: only declared kinds, only installed Wizard apps, targets cleaned and capped', () => {
  const { S } = load();
  assert.equal(S.register('messenger', { accepts: ['text', 'file', 'evil'], targets: [{ id: 'p1', name: 'Miguel\u0007', detail: 'Telegram' }, { id: 'p1', name: 'dup' }, { id: '', name: 'x' }, { id: 'p2', name: '' }] }), true);
  const r = S._state().receivers.messenger;
  assert.deepEqual([...r.accepts], ['text']);
  assert.deepEqual([...r.targets.map(t => t.id + ':' + t.name)], ['p1:Miguel']);
  assert.equal(S.wants('text'), true);
  assert.equal(S.wants('url'), false);
  S.register('ghost', { accepts: ['text'] }); // not installed: never offered
  S.register('messenger', { accepts: [] }); // unregister falls back to the reviewed default
  assert.equal(S.wants('text'), true);
  assert.ok(S.setTargets('ghost', Array.from({ length: 40 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))));
  assert.equal(S._state().receivers.ghost.targets.length, 24);
});

test('pending items belong to one app, survive until acked once', () => {
  const { S } = load();
  S.register('messenger', { accepts: ['text'] });
  assert.equal(S.pending('messenger').length, 0);
  assert.equal(S.ack('messenger', 'nope'), false);
});

test('isolation: receiver ops are handed to app services once and never exposed on the global', () => {
  const { G, claim } = load();
  for (const k of ['register', 'setTargets', 'pending', 'ack']) assert.equal(G[k], undefined, k);
  assert.equal(claim({ pending: () => ['stolen'] }), false); // a later claimant (e.g. a frame) is refused
  assert.equal(Object.isFrozen(G), true);
});

test('deliver keeps the item in memory for that app only, acked once', () => {
  const { S, events } = load();
  S.register('messenger', { accepts: ['text'], targets: [{ id: 'p1', name: 'Miguel' }] });
  assert.equal(S.pending('messenger').length, 0);
});
