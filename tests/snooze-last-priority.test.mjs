import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const block = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
function fixture(personal) {
  const c = vm.createContext({ snoozeLast: () => personal, isWorking: s => s.status === 'running', deferredOf: s => !!s.deferred && !s.archived && !(Date.parse(s.lastUserAt) > Date.parse(s.deferredAt)), attOf: s => s.attention, window: {}, agentName: () => 'Agent', ago: () => 'now' });
  vm.runInContext(block('  function stiKind(', '  const stiBadge') + block('  function threadState(', '  function renderThread(') + block('  const waitsOn =', '  // Newest keeps') + '\nthis.waitsOn = waitsOn;', c);
  return c;
}
for (const route of ['main', 'host-profile', 'container', 'restricted']) {
  for (const status of ['completed', 'waiting_for_approval', 'unknown', 'failed', 'interrupted']) test(`Snooze overrides effective indicator and waiting priority: ${route}/${status}`, () => {
    const c = fixture(true), s = { status, agent: route, deferred: true, deferredAt: '2026-10-26T12:00:00Z', attention: { state: 'needs_you' } };
    const before = JSON.stringify(s);
    assert.equal(c.stiKind(s), 'deferred'); assert.equal(c.threadState(s).sub, 'Snoozed'); assert.equal(c.waitsOn(s), false);
    assert.equal(JSON.stringify(s), before, 'original status remains restorable');
    s.deferred = false; assert.notEqual(c.stiKind(s), 'deferred');
    s.deferred = true; s.lastUserAt = '2026-10-26T12:01:00Z'; assert.notEqual(c.stiKind(s), 'deferred');
  });
}
test('stock approvals/errors retain their original visual priority', () => {
  const c = fixture(false);
  for (const [status, kind] of [['waiting_for_approval', 'approval'], ['unknown', 'approval'], ['failed', 'failed'], ['interrupted', 'failed']]) assert.equal(c.stiKind({ status, deferred: true }), kind);
});
test('running and archived sessions are not demoted by an old Snooze', () => {
  const c = fixture(true);
  assert.equal(c.stiKind({ status: 'running', deferred: true }), 'working');
  assert.equal(c.stiKind({ status: 'failed', deferred: true, archived: true }), 'failed');
});
