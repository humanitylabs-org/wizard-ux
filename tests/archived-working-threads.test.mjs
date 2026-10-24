import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');

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
