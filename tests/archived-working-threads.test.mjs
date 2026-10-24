import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chatsSource = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');

function workGroups(sessions) {
  const firstStart = source.indexOf('  const DAY = 864e5;');
  const firstEnd = source.indexOf('  // Agent Service owns box-wide preferences.', firstStart);
  const secondStart = source.indexOf('  const sectionTime =', firstEnd);
  const secondEnd = source.indexOf('  async function fetchDispositions()', secondStart);
  assert.ok(firstStart > 0 && firstEnd > firstStart && secondStart > firstEnd && secondEnd > secondStart, 'work grouping blocks found');

  const localStorage = { getItem(key) { return key === 'wos.chats.archiveAfter.v1' ? '7' : null; } };
  const context = {
    Date,
    document: { documentElement: { dataset: { skin: 'obsidian' } } },
    localStorage,
    window: { WizConfig: { dayStart: now => now - (now % 864e5) } },
  };
  context.input = sessions;
  context.now = Date.UTC(2026, 9, 24, 12);
  vm.createContext(context);
  vm.runInContext(`${source.slice(firstStart, firstEnd)}\n${source.slice(secondStart, secondEnd)}\nthis.result = groupWork(input, now);`, context);
  return JSON.parse(JSON.stringify(context.result));
}

test('Done keeps archived stale-running threads out of Working for main and every routed runtime kind', () => {
  const kinds = ['main', 'host-profile', 'container', 'restricted'];
  const archived = kinds.map((kind, index) => ({
    id: `archived-${kind}`,
    title: `Finished ${kind} task`,
    agent: kind === 'main' ? '' : `qa-${kind}`,
    runtimeKind: kind,
    status: 'running',
    archived: true,
    assignedAt: `2026-10-24T10:0${index}:00Z`,
  }));
  const active = { id: 'active', title: 'Active task', status: 'running', archived: false, assignedAt: '2026-10-24T11:00:00Z' };
  const groups = workGroups([...archived, active]);

  assert.deepEqual(groups.working.map(row => row.id), ['active']);
  assert.deepEqual(groups.archive.map(row => row.runtimeKind).sort(), [...kinds].sort());
});

test('archived stale-running threads remain restorable and say Archived', () => {
  const actionsStart = chatsSource.indexOf('  function threadActions(s, turns) {');
  const actionsEnd = chatsSource.indexOf('\n  const ACT =', actionsStart);
  const stateStart = chatsSource.indexOf('  function threadState(s, agent) {');
  const stateEnd = chatsSource.indexOf('\n  function renderThread(', stateStart);
  assert.ok(actionsStart > 0 && actionsEnd > actionsStart && stateStart > 0 && stateEnd > stateStart, 'thread state helpers found');

  const context = {
    WORKING_ST: new Set(['running', 'stopping']),
    LIVE: { busy: () => true, workGroups: rows => ({ archive: rows.filter(row => row.aged) }) },
    window: { WosWork: { helperLabel: () => '' } },
    agentName: () => 'Wizard',
    ago: () => 'just now',
  };
  vm.createContext(context);
  vm.runInContext(`${chatsSource.slice(actionsStart, actionsEnd)}\n${chatsSource.slice(stateStart, stateEnd)}\nthis.actions = threadActions; this.state = threadState;`, context);

  const archived = { id: 'archived', archived: true, status: 'running' };
  assert.deepEqual(Array.from(context.actions(archived, null)), ['restore', 'snooze']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.state(archived, ''))), { working: false, sub: 'Archived' });
  assert.deepEqual(Array.from(context.actions({ id: 'active', status: 'running' }, null)), []);
  assert.deepEqual(Array.from(context.actions({ id: 'aged', aged: true, status: 'running' }, null)), ['restore', 'snooze']);
});
