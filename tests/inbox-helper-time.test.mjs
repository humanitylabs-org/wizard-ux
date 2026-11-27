// wizard-ux#1994: a thread whose newest turns were helper follow-through (machine events, no owner message since the
// helper started) can be `status: 'running'` + `waitingOn: 'helper'` with every request clock (assignedAt, requestAt,
// lastUserAt) null. Its Inbox row must still show a time and sort by it. Runs the real web/live-work.js part (cardAt,
// groupWork and its newestFirst), the real list model and the real core `ago` label.
// Run: node --test tests/inbox-helper-time.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const H = 3600e3, NOW = Date.now(), iso = t => new Date(t).toISOString();
function work() {
  const window = { WizConfig: { dayStart: n => n - 2 * 864e5, dayParts: t => { const d = new Date(t); return { dow: d.getUTCDay(), d: d.getUTCDate() }; } } };
  const c = modelContext({ window, console, Date, localStorage: { getItem: k => k === 'wos.chats.layout.v1' ? 'status' : null, setItem() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), setInterval: () => 0, setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, document: { addEventListener() {}, documentElement: { dataset: {} } } });
  window.addEventListener = () => {};
  vm.runInContext(read('web/core/core.js'), c);
  vm.runInContext(read('web/live-work.js'), c);
  return { ...window.WizCore.liveParts.work({ J: () => {}, req: async () => ({ json: async () => ({}) }) }), ago: window.WizCore.ago };
}
// The reported row, synthetic: the last turns were [ASYNC DELEGATION BATCH COMPLETE] and a recovered helper receipt.
const helperRow = (extra = {}) => ({ id: 'helper', title: 'Content · Latest podcast clips', status: 'running', waitingOn: 'helper',
  helperStatus: { phase: 'stalled', pending: 0, returned: 1 }, previewAt: iso(NOW - 0.2 * H), previewRole: 'assistant', activityAt: iso(NOW - 0.2 * H),
  lastUserAt: null, assignedAt: null, requestAt: null, updatedAt: iso(NOW - 7 * 24 * H), ...extra });
const older = (id, h) => ({ id, title: 'Older ' + id, status: null, previewAt: iso(NOW - h * H), previewRole: 'assistant', activityAt: iso(NOW - h * H), updatedAt: iso(NOW - h * H) });

for (const helperStatus of [{ phase: 'stalled', pending: 0, returned: 1 }, { phase: 'failed', failed: true, pending: 0 }]) {
  test(`helper follow-through row (${helperStatus.phase}, no request clock) has a time, a label, and sorts by it in Inbox`, () => {
    const w = work(), s = helperRow({ helperStatus });
    assert.equal(w.cardAt(s), s.previewAt, 'falls back to the latest activity');
    assert.notEqual(w.ago(w.cardAt(s), NOW), '', 'the row draws a time label');
    assert.equal(w.inWorking(s), false, 'this row is drawn in Inbox, not Working');
    const g = w.groupWork([older('o12', 12), s, older('o2', 2), older('o30', 30)], NOW);
    assert.deepEqual(Array.from(g.ready, r => r.id), ['helper', 'o2', 'o12', 'o30'], 'newest first, not below older rows');
  });
}
test('activityAt alone (no preview) is enough; rows with no clock at all still sort last', () => {
  const w = work(), s = helperRow({ previewAt: null, activityAt: iso(NOW - H) });
  assert.equal(w.cardAt(s), s.activityAt);
  const none = { id: 'none', title: 'A none', status: 'running', waitingOn: 'helper', helperStatus: { phase: 'failed', failed: true, pending: 0 } };
  assert.equal(w.cardAt(none), '');
  assert.deepEqual(Array.from(w.groupWork([none, older('o5', 5), s], NOW).ready, r => r.id), ['helper', 'o5', 'none']);
});
test('a working row with a request clock keeps it (Working labels and order unchanged)', () => {
  const w = work();
  assert.equal(w.cardAt(helperRow({ assignedAt: iso(NOW - 3 * H) })), iso(NOW - 3 * H));
  assert.equal(w.cardAt(helperRow({ lastUserAt: iso(NOW - 4 * H) })), iso(NOW - 4 * H));
  assert.equal(w.cardAt(helperRow({ previewRole: 'user' })), iso(NOW - 0.2 * H));
  assert.equal(w.cardAt({ status: 'failed', requestAt: iso(NOW - 5 * H), previewAt: iso(NOW - H) }), iso(NOW - 5 * H), 'a failed row keeps its request time');
  assert.equal(w.cardAt({ status: 'completed', previewAt: iso(NOW - H), assignedAt: iso(NOW - 9 * H) }), iso(NOW - H), 'a finished row is unchanged');
});
test('no row with previewAt or activityAt has an empty cardAt, whatever its status', () => {
  const w = work();
  for (const status of [null, 'idle', 'completed', 'submitting', 'queued', 'running', 'stopping', 'waiting_for_approval', 'unknown', 'failed', 'interrupted'])
    for (const k of ['previewAt', 'activityAt']) assert.notEqual(w.cardAt({ status, [k]: iso(NOW - H) }), '', `${status} with only ${k}`);
});
