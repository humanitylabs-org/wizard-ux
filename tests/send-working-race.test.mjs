import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
function setup() {
  const start = source.indexOf('  const PEND = new Map()');
  const end = source.indexOf('  const commandId =', start);
  let now = 1000000;
  const L = { sessions: [{ id: 's', status: 'completed', runId: 'old' }], agentSessions: {} };
  const OB = { _items: new Map() };
  const c = { L, OB, WORKING: new Set(['submitting', 'queued', 'running', 'stopping']), otherAgent: a => a !== 'hermes', AGENT_OF: new Map(), Date: class extends Date { static now() { return now; } } };
  vm.runInNewContext(source.slice(start, end) + '\nthis.api = {syncPending,applyPend,PEND,TAPS,RELEASED};', c);
  const it = { id: 'send', sessionId: 's', kind: 'reply', createdAt: now, state: 'sending', text: 'next' };
  const sync = () => c.api.syncPending(OB);
  const poll = (status, key = 'old', lastRunStatus = '', runId = '') => { L.sessions = [{ id: 's', status, lastRunKey: key, lastRunStatus, runId }]; c.api.applyPend(L.sessions[0]); return L.sessions[0]; };
  return { L, OB, it, sync, poll, api: c.api, advance: ms => { now += ms; } };
}
test('tap holds Ready before persistence; delayed outbox and old polls cannot undo it', () => {
  const t = setup(); t.api.TAPS.set('s', { at: t.it.createdAt, until: t.it.createdAt + 60000 });
  t.sync(); assert.equal(t.L.sessions[0].status, 'submitting');
  assert.equal(t.poll('completed').status, 'submitting');
  t.OB._items.set(t.it.id, t.it); t.sync();
  assert.equal(t.api.TAPS.size, 0); assert.equal(t.L.sessions[0].status, 'submitting');
});
test('admission receipt with old completed thread status is not completion', () => {
  const t = setup(); Object.assign(t.it, { state: 'sent', sentAt: t.it.createdAt, runId: 'new' }); t.OB._items.set('send', t.it); t.sync();
  assert.equal(t.poll('completed', 'send', 'queued').status, 'running');
});
test('active acknowledgement survives late stale list and subsequent outbox emission', () => {
  const t = setup(); Object.assign(t.it, { state: 'sent', sentAt: t.it.createdAt, runId: 'new' }); t.OB._items.set('send', t.it); t.sync();
  assert.equal(t.poll('running', 'send', 'running', 'new').pend, '');
  assert.equal(t.poll('completed').status, 'running'); t.sync();
  assert.equal(t.L.sessions[0].status, 'running'); assert.equal(t.L.sessions[0].pend, '');
  assert.equal(t.poll('completed', 'send', 'completed').status, 'completed');
  t.sync(); assert.equal(t.L.sessions[0].status, 'completed'); assert.equal(t.api.PEND.size, 0);
});
test('matching failure and approval release; older services without lastRunStatus remain supported', () => {
  for (const status of ['failed', 'interrupted', 'waiting_for_approval', 'completed']) {
    const t = setup(); t.OB._items.set('send', t.it); t.sync();
    assert.equal(t.poll(status, 'send').status, status); assert.equal(t.api.PEND.size, 0);
  }
});
test('failed local save restores Ready; retryable offline send stays Working', () => {
  const t = setup(); t.api.TAPS.set('s', { at: t.it.createdAt, until: t.it.createdAt + 60000 }); t.sync();
  t.api.TAPS.delete('s'); t.sync(); assert.equal(t.L.sessions[0].status, 'completed');
  t.it.state = 'waiting'; t.OB._items.set('send', t.it); t.sync(); assert.equal(t.L.sessions[0].status, 'submitting');
  t.it.state = 'failed'; t.sync(); assert.equal(t.L.sessions[0].status, 'completed');
});
test('bounded orphan hold expires rather than trapping a thread in Working', () => {
  const t = setup(); Object.assign(t.it, { state: 'sent', sentAt: t.it.createdAt, runId: 'new' }); t.OB._items.set('send', t.it); t.sync();
  t.advance(120001); assert.equal(t.poll('completed').status, 'completed');
});
test('a new chat gets a synthetic Working row until the server lists it', () => {
  const t = setup(); t.L.sessions = []; t.it.kind = 'new'; t.OB._items.set('send', t.it); t.sync();
  assert.equal(t.L.sessions[0].status, 'submitting'); assert.equal(t.L.sessions[0].synthetic, true);
});
