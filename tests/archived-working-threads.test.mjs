import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chatsSource = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const desktopSource = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const kinds = ['main', 'host-profile', 'container', 'restricted'];

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
  assert.match(desktopSource, /LIVE\.isNew\(s\) \? ' · unread' : !s\.archived && WORKING_ST\.has\(s\.status\) \? ' · working'/);
});

test('archived stale-running threads remain recoverable without steering stale runs', () => {
  const workingStart = chatsSource.indexOf("  const WORKING_ST = new Set(['submitting', 'queued', 'running', 'stopping']);");
  const workingEnd = chatsSource.indexOf('\n  // Same sections', workingStart);
  // threadActions reads the watcher predicate declared just above it.
  const actionsStart = chatsSource.indexOf('  const followUpActive = s =>');
  const actionsEnd = chatsSource.indexOf('\n  const ACT =', actionsStart);
  const stateStart = chatsSource.indexOf('  function threadState(s, agent) {');
  const stateEnd = chatsSource.indexOf('\n  function renderThread(', stateStart);
  assert.ok(workingStart > 0 && workingEnd > workingStart && actionsStart > 0 && actionsEnd > actionsStart && stateStart > 0 && stateEnd > stateStart, 'thread state helpers found');

  const context = {
    LIVE: { busy: id => id === 'busy', workGroups: rows => ({ archive: rows.filter(row => row.aged) }) },
    window: { WosWork: { helperLabel: () => '' } },
    agentName: () => 'Wizard',
    ago: () => 'just now',
  };
  vm.createContext(context);
  vm.runInContext(`${chatsSource.slice(workingStart, workingEnd)}\n${chatsSource.slice(actionsStart, actionsEnd)}\n${chatsSource.slice(stateStart, stateEnd)}\nthis.actions = threadActions; this.state = threadState; this.working = isWorking;`, context);

  for (const runtimeKind of kinds) {
    const archived = { id: `archived-${runtimeKind}`, archived: true, status: 'running', runId: `stale-${runtimeKind}`, runtimeKind };
    assert.deepEqual(Array.from(context.actions(archived, null)), ['restore', 'snooze']);
    assert.deepEqual(JSON.parse(JSON.stringify(context.state(archived, runtimeKind))), { working: false, sub: 'Archived' });
    assert.equal(context.working(archived), false, `${runtimeKind} must not steer its stale run`);
  }
  assert.deepEqual(Array.from(context.actions({ id: 'active', status: 'running' }, null)), []);
  assert.equal(context.working({ id: 'active', status: 'running' }), true);
  assert.deepEqual(Array.from(context.actions({ id: 'busy', archived: true, status: 'running' }, null)), [], 'optimistic archive writes stay disabled');
  assert.deepEqual(Array.from(context.actions({ id: 'aged', aged: true, status: 'running' }, null)), ['restore', 'snooze']);
  // A quiet watcher check runs while its thread stays archived: Stop watching is then the only action.
  const watched = { active: true, count: 1 };
  assert.deepEqual(Array.from(context.actions({ id: 'watch-run', archived: true, status: 'running', followUp: watched }, null)), ['stop_watch']);
  assert.deepEqual(Array.from(context.actions({ id: 'watch-idle', archived: true, status: 'completed', followUp: watched }, null)), ['restore', 'snooze', 'stop_watch']);
});
