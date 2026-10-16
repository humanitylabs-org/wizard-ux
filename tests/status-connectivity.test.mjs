import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/core/status.js', import.meta.url), 'utf8');
function setup(online = true) {
  const events = {}, timers = new Map(), nodes = new Map();
  let tid = 0;
  const element = () => ({ classList: { toggle() {} }, dataset: {}, addEventListener() {}, appendChild(el) { nodes.set(el.id, el); } });
  const body = element();
  const L = { ok: false, at: 0, error: '', sessions: [], refreshes: 0, listeners: [], refresh() { this.refreshes++; }, onChange(fn) { this.listeners.push(fn); }, emit() { this.listeners.forEach(fn => fn()); } };
  const ctx = { navigator: { onLine: online }, document: { body, documentElement: element(), getElementById(id) { return nodes.get(id); }, createElement: element }, addEventListener(name, fn) { (events[name] ||= []).push(fn); }, setTimeout(fn) { timers.set(++tid, fn); return tid; }, clearTimeout(id) { timers.delete(id); }, setInterval() {}, console };
  ctx.window = ctx; ctx.WizLive = L;
  vm.runInNewContext(source, ctx); ctx.WizCore.status.attach({});
  return { ctx, L, state: () => ctx.WizCore.status.state.net, event(name) { events[name].forEach(fn => fn()); }, success() { L.at++; L.ok = true; L.error = ''; L.emit(); }, settle() { for (const fn of timers.values()) fn(); timers.clear(); } };
}

test('fresh Wizard reads override a false offline flag at boot and remain online', () => {
  const h = setup(false); assert.equal(h.state(), 'offline');
  h.success(); assert.equal(h.state(), 'restored');
  h.settle(); h.L.emit(); assert.equal(h.state(), 'online');
  assert.equal(h.ctx.navigator.onLine, false);
});
test('offline event probes Wizard; cached and optimistic events cannot clear it', () => {
  const h = setup(); h.success();
  h.ctx.navigator.onLine = false; h.event('offline');
  assert.equal(h.L.refreshes, 1); assert.equal(h.state(), 'offline');
  h.L.emit(); assert.equal(h.state(), 'offline');
  h.success(); assert.equal(h.state(), 'restored');
  h.settle(); assert.equal(h.state(), 'online');
  h.event('offline'); h.L.emit(); assert.equal(h.state(), 'offline');
});
test('real network failure stays offline, recovery requires a fresh successful read', () => {
  const h = setup(); h.success(); h.ctx.navigator.onLine = false; h.event('offline');
  h.L.error = 'offline'; h.L.emit(); assert.equal(h.state(), 'offline');
  h.ctx.navigator.onLine = true; h.event('online'); assert.equal(h.state(), 'reconnecting');
  h.success(); assert.equal(h.state(), 'restored'); h.settle(); assert.equal(h.state(), 'online');
});
test('server failure while browser is online still shows reconnecting', () => {
  const h = setup(); h.success(); h.L.error = 'offline'; h.L.emit();
  assert.equal(h.state(), 'reconnecting'); h.success(); assert.equal(h.state(), 'restored');
});
test('stale successful read never overrides a subsequent failed read', () => {
  const h = setup(false); h.success(); h.settle();
  h.L.error = 'offline'; h.L.emit(); assert.equal(h.state(), 'offline');
});
