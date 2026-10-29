import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// James, 23 Oct 2026: Private Agent's Chats went blank ("Wizard is reachable but didn't take the message") while the
// main Chats keeps its threads under "Not up to date". One failed agent refresh must not wipe an agent's list.
const src = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('    async refreshAgents('), src.indexOf('    // The threads of one agent;'));

function store(fail) {
  const L = { agentSessions: {}, agentStatus: {}, windows: {}, seen: null, emit() {} };
  const A = { ready: true, others: () => [{ id: 'private' }] };
  const c = { L, AG: () => A, AGENT_OF: new Map(), AGENT_SEEN: { threads: {} }, AGENT_SEEN_KEY: 'k', Date, Object, Promise,
    keyOf: s => s.id, seenKeyOf: s => s.id, applyLocal() {}, addSynthetic() {}, merge: () => null, readLocal: () => null,
    later: a => a, writeLocal() {}, putSeen: async () => ({}), localStorage: { setItem() {} }, window: {},
    fetchSessions: async () => { if (fail.now) { const e = new Error('read failed'); e.status = fail.status; throw e; } return { sessions: [{ id: 't1' }] }; } };
  vm.runInNewContext(`L.refreshAgents = ({${body}}).refreshAgents; L.statusFor = a => L.agentStatus[a] || { ok: false, error: '' };`, c);
  return L;
}

test('a failed refresh keeps the agent threads already shown, marked Not up to date', async () => {
  const fail = { now: false }, L = store(fail);
  await L.refreshAgents({});
  const loadedAt = L.agentStatus.private.at;
  fail.now = true; await L.refreshAgents({});
  assert.equal(L.agentStatus.private.ok, true, 'list stays visible');
  assert.equal(L.agentStatus.private.error, 'offline', 'sync bar says Not up to date');
  assert.equal(L.agentStatus.private.at, loadedAt, 'last updated keeps the real last read');
  assert.deepEqual(L.agentSessions.private.map(s => s.id), ['t1']);
  fail.now = false; await L.refreshAgents({});
  assert.deepEqual(L.agentStatus.private.error, '');
});

test('an agent never read yet, or a lost access grant, shows the connection card', async () => {
  const fail = { now: true }, L = store(fail);
  await L.refreshAgents({});
  assert.equal(L.agentStatus.private.ok, false);
  fail.now = false; await L.refreshAgents({});
  fail.now = true; fail.status = 403; await L.refreshAgents({});
  assert.equal(L.agentStatus.private.ok, false);
  assert.equal(L.agentStatus.private.error, 'access');
});
