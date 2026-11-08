import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/thread-tracker.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../web/core/chats-list-model.js', import.meta.url), 'utf8');
for (const agent of ['']) test(`stopped tracker dots, strip and live subscriber: ${agent || 'main'}`, async () => {
  const row = { status: 'completed' }; let subscriber, paints = 0;
  const doc = { documentElement: { dataset: { tweaks: 'wizard/thread-tracker' } }, addEventListener() {}, querySelectorAll() { paints++; return []; } };
  const win = { addEventListener() {}, dispatchEvent() {}, WizLive: { session: () => row, sessionFor: () => row, onChange(fn) { subscriber = fn; } } };
  const ctx = vm.createContext({ window: win, document: doc, setInterval() {}, setTimeout() {}, CustomEvent: class {}, fetch: async () => ({ ok: true, json: async () => ({ items: [{ id: 'disk', title: 'Disk pressure', state: 'running', updated_at: 1 }] }) }) });
  vm.runInContext(model, ctx); win.WizChatsListModel = ctx.WizChatsListModel;
  vm.runInContext(source, ctx); const T = win.WosThreadTracker;
  await T.load('t', agent);
  assert.match(T.dots('t', agent), /title="1 stopped" aria-label="1 stopped"/);
  assert.match(T.dots('t', agent), /tt-dot stopped/); assert.doesNotMatch(T.dots('t', agent), /tt-dot run/);
  assert.match(T.stripHtml('t', agent), /1 open/); assert.match(T.stripHtml('t', agent), /Stopped · nothing running/); assert.doesNotMatch(T.stripHtml('t', agent), /tt-dot run/);
  assert.equal(typeof subscriber, 'function', 'use live repaint subscription, not another poll');
  row.status = 'running'; const before = paints; subscriber(); assert.ok(paints > before);
  assert.match(T.dots('t', agent), /1 running/); assert.match(T.stripHtml('t', agent), /tt-dot run/);
  doc.documentElement.dataset.tweaks = ''; assert.equal(T.dots('t', agent), '');
});
test('stopped dot is static hollow and token coloured', () => {
  const css = readFileSync(new URL('../web/core/thread-tracker.css', import.meta.url), 'utf8');
  assert.match(css, /\.tt-dot\.stopped\s*\{[^}]*background:\s*transparent;[^}]*border:[^}]*--wz-text-muted[^}]*animation:\s*none/s);
});
