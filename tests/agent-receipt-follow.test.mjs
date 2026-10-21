import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('direct thread detail learns the server agent before the first scoped history read', async () => {
  const pins = new Map(), detail = new Map();
  const body = src.slice(src.indexOf('    async sessionInfo(id) {'), src.indexOf('    /* ---- thread actions ---- */'));
  const L = { agentSessions: {}, sessions: [], windows: {}, agentOf: id => pins.get(id) || '' };
  const c = { L, AGENT_OF: pins, DETAIL: detail, otherAgent: id => id && id !== 'hermes', normalize: raw => raw,
    aq: () => '', applyLocal: () => {}, req: async () => ({ json: async () => ({ session: { id: 'quick-thread', agent: 'quick', wizard_retry_input: 'hello' } }) }) };
  vm.runInNewContext(`L.sessionInfo = ({${body}}).sessionInfo`, c);
  await L.sessionInfo('quick-thread');
  assert.equal(pins.get('quick-thread'), 'quick');
  assert.equal(L.agentSessions.quick[0].id, 'quick-thread');
  assert.equal(L.sessions.length, 0);
  pins.set('quick-thread', 'philosopher');
  await assert.rejects(L.sessionInfo('quick-thread'), /Thread scope changed/);
});

test('accepted agent receipt is polled in its own scope and completion refreshes immediately', async () => {
  let onSent, refreshed = 0, emitted = 0, status = 'running';
  const timers = [], calls = [], pins = [];
  const OB = { _items: new Map(), load: async () => {}, onChange: () => {}, onSent: fn => { onSent = fn; } };
  const row = { id: 'thread', status: 'running', runId: 'run-quick' };
  const pending = new Map([['thread', { key: 'send-quick', runId: 'run-quick' }]]), released = new Set();
  const L = { session: () => row, emit: () => emitted++, pinAgent: (...a) => pins.push(a), refreshAgents: async () => refreshed++ };
  const c = { PEND: pending, RELEASED: released, unPend: () => {}, window: { WosOutbox: OB }, L, PEND_MAX: 120000, document: { hidden: false }, Date,
    syncPending: () => false, otherAgent: id => id && id !== 'hermes', setTimeout: fn => timers.push(fn),
    req: async url => { calls.push(url); return { json: async () => ({ run_id: 'run-quick', session_id: 'thread', status }) }; } };
  const body = src.slice(src.indexOf('  function attachOutbox() {'), src.indexOf("  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attachOutbox)"));
  vm.runInNewContext(body + '\nattachOutbox();', c);
  onSent({ id: 'send-quick', kind: 'new', agent: 'quick', sessionId: 'thread', runId: 'run-quick' });
  await settle();
  assert.deepEqual(calls, ['/wizard/hermes/v1/runs/run-quick?agent=quick']);
  assert.deepEqual(pins, [['thread', 'quick']]);
  assert.equal(refreshed, 0);
  status = 'completed'; await timers.shift()();
  assert.equal(refreshed, 1); assert.equal(emitted, 1);
  assert.equal(row.status, 'completed'); assert.equal(pending.size, 0); assert.ok(released.has('send-quick'));
  const count = calls.length;
  onSent({ kind: 'new', agent: '', sessionId: 'main', runId: 'main-run' }); await settle();
  assert.equal(calls.length, count, 'main run lifecycle is unchanged');
});
