// AI Look up agent-chat parity (AGENTS.md): the scope a selection is looked up in (agent, thread, privacy) is resolved by the
// REAL lookupScope/winAgent/agentRec code from web/core/chats.js for main, host-profile, container and restricted windows,
// and a private agent / private thread / Incognito / default private agent / vanished window never reaches the cloud model.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = js.indexOf(a), j = js.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return js.slice(i, j); };
const code = [js.split('\n').find(l => l.startsWith('  function winAgent(w)')),
  js.split('\n').find(l => l.startsWith('  const AGS = ')), js.split('\n').find(l => l.startsWith('  const agentName = ')), js.split('\n').find(l => l.startsWith('  const winTitle = ')),
  cut('  function lookupScope(id) {', '  function agentRec(id) {'), cut('  function agentRec(id) {', '\n  }\n') + '\n  }'].join('\n');

const kinds = ['main', 'host-profile', 'container', 'restricted'];
function world({ incognito = [], privateSessions = [], privateAgents = [], defaultPrivate = false } = {}) {
  const agents = { hermes: { id: 'hermes', label: 'Archimedes', privacy: defaultPrivate ? 'private' : 'standard' } };
  for (const k of kinds.slice(1)) agents[`qa-${k}`] = { id: `qa-${k}`, label: `QA ${k}`, privacy: privateAgents.includes(`qa-${k}`) ? 'private' : 'standard' };
  const W = {}; for (const k of kinds) W[`w-${k}`] = { id: `w-${k}`, app: 'chats', thread: `s-${k}`, agent: k === 'main' ? '' : `qa-${k}`, runtimeKind: k };
  const A = { get: id => agents[id], defaultId: () => 'hermes', isOther: id => !!id && id !== 'hermes', isPrivate: a => a?.privacy === 'private' };
  const ctx = { W, window: { WosAgents: A, WizConfig: { agent: () => 'Archimedes' } }, owner: id => id, focusOf: () => null, focusedAgent: () => '', isHosted: () => true,
    LIVE: { session: sid => ({ title: `Title ${sid}` }), agentOf: sid => W[Object.keys(W).find(id => W[id].thread === sid)]?.agent || '', isPrivate: sid => privateSessions.includes(sid) },
    INC: { active: id => incognito.includes(id) }, H: { title: () => 'T' } };
  vm.createContext(ctx); vm.runInContext(`${code}\nthis.lookupScope = lookupScope;`, ctx);
  return ctx.lookupScope;
}

test('each runtime kind resolves its own agent and thread; standard threads are allowed', () => {
  const scope = world();
  for (const k of kinds) {
    const s = scope(`w-${k}`);
    assert.equal(s.session, `s-${k}`, k); assert.equal(s.agent, k === 'main' ? '' : `qa-${k}`, k); assert.equal(s.private, false, k);
    assert.match(s.frame, k === 'main' ? /^Archimedes · Title s-main$/ : new RegExp(`^QA ${k} · `), k); assert.ok(s.frame.length <= 80);
  }
});
test('private agent, private thread, Incognito, a private default agent and a vanished window are all refused / unresolved', () => {
  for (const k of kinds.slice(1)) assert.equal(world({ privateAgents: [`qa-${k}`] })(`w-${k}`).private, true, `private ${k} agent`);
  for (const k of kinds) assert.equal(world({ privateSessions: [`s-${k}`] })(`w-${k}`).private, true, `private ${k} thread`);
  for (const k of kinds) assert.equal(world({ incognito: [`w-${k}`] })(`w-${k}`).private, true, `incognito ${k}`);
  assert.equal(world({ defaultPrivate: true })('w-main').private, true, 'main chat of a private default agent');
  assert.equal(world()('w-gone'), null, 'vanished window → null, which the menu treats as "no Look up"');
});
