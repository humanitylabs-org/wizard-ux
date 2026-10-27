import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const block = (s, from, to) => { const a = s.indexOf(from), b = s.indexOf(to, a); assert.ok(a >= 0 && b > a); return s.slice(a, b); };
function fixture(last) {
  const c = vm.createContext({ Date, document: { documentElement: { dataset: {} } }, localStorage: { getItem: () => null }, window: { WizConfig: { dayStart: n => n - n % 864e5 }, WosSkinHost: { snoozeOrder: last ? 'last' : 'default' } } });
  vm.runInContext(block(live, '  const DAY = 864e5;', '  // Agent Service owns box-wide preferences.') + block(live, '  const sectionTime =', '  async function fetchDispositions()') + '\nthis.group = groupWork; this.priority = byPriority; this.oldest = byOldest;', c);
  return c;
}
const ids = a => Array.from(a, s => s.id);
const now = Date.UTC(2026, 9, 25, 12);
const row = (id, extra = {}) => ({ id, title: id, status: 'completed', previewAt: '2026-10-25T10:00:00Z', ...extra });
const snoozed = (id, extra = {}) => row(id, { deferred: true, deferredAt: '2026-10-25T11:00:00Z', ...extra });
for (const route of ['main', 'host-profile', 'container', 'restricted']) test(`snoozeOrder last: Snooze stays below every awake Ready row: ${route}`, () => {
  const f = fixture(true), rows = [snoozed('sleep-approval', { status: 'waiting_for_approval', agent: route }), snoozed('sleep-old', { previewAt: '2020-01-01T10:00:00Z' }), row('awake'), snoozed('sleep-error', { status: 'failed' })];
  const g = f.group(rows, now);
  assert.equal(g.deferred.length, 0); assert.equal(g.archive.length, 0); assert.equal(g.errors.length, 0);
  for (const list of [g.ready, f.priority(g.ready), f.oldest(g.ready)]) { assert.equal(list.length, 4); assert.equal(list[0].id, 'awake'); }
});
test('working, archived, hidden, restored and replied threads retain their lifecycle', () => {
  const f = fixture(true), g = f.group([snoozed('run', { status: 'running' }), snoozed('archive', { archived: true }), snoozed('hidden', { hidden: true }), snoozed('reply', { lastUserAt: '2026-10-25T11:30:00Z' }), row('restore', { deferred: false, restoredAt: '2026-10-25T11:45:00Z' })], now);
  assert.deepEqual(ids(g.working), ['run']); assert.deepEqual(ids(g.archive), ['archive']);
  assert.deepEqual(ids(g.ready).sort(), ['reply', 'restore']);
});
test('stock (no tweak, or no skin host) Snooze still leaves Ready; approvals stay pinned first', () => {
  for (const f of [fixture(false), (() => { const c = fixture(false); c.window.WosSkinHost = undefined; return c; })()]) {
    const g = f.group([row('awake'), snoozed('sleep'), snoozed('sleep-approval', { status: 'waiting_for_approval' })], now);
    assert.deepEqual(ids(g.ready), ['sleep-approval', 'awake']); assert.deepEqual(ids(g.deferred), ['sleep']);
    assert.equal(f.priority(g.ready)[0].id, 'sleep-approval'); assert.equal(f.oldest(g.ready)[0].id, 'sleep-approval');
  }
});
test('subject grouping renders the entire snoozed tail after all awake subjects', () => {
  const c = vm.createContext({ snoozeLast: () => true, deferredOf: s => !!s.deferred, readyOrder: 'subject', READY_ORDERS: [], attOf: s => s.attention, waitsOn: () => false, subjectSort: (a, f) => a.sort(f), esc: s => s });
  vm.runInContext(block(chats, '  function readyBody(', '  /* Android Back on the list'), c);
  const html = c.readyBody([snoozed('s'), row('a', { attention: { subject: 'A' } }), row('b', { attention: { subject: 'B' } })], s => `<row>${s.id}</row>`);
  assert.ok(html.indexOf('<row>s</row>') > html.indexOf('<row>b</row>'));
  assert.equal((html.match(/ch-rdy-bar/g) || []).length, 1);
});
test('stock subject grouping is unchanged: same HTML as readyBody without the snoozeOrder line', () => {
  const src = block(chats, '  function readyBody(', '  /* Android Back on the list');
  const stockSrc = src.split('\n').filter(l => !l.includes('snoozeLast()')).join('\n');
  assert.notEqual(stockSrc, src);
  const run = code => { const c = vm.createContext({ snoozeLast: () => false, deferredOf: s => !!s.deferred, readyOrder: 'subject', READY_ORDERS: [], attOf: s => s.attention, waitsOn: () => false, subjectSort: (a, f) => a.sort(f), esc: s => s }); vm.runInContext(code, c);
    return c.readyBody([snoozed('s'), row('a', { attention: { subject: 'A' } }), row('b', { attention: { subject: 'B' } })], s => `<row>${s.id}</row>`); };
  assert.equal(run(src), run(stockSrc));
});
test('shared attention groups (Inbox, moons, Home): a snoozed approval is not Needs you only with snoozeOrder last', () => {
  const src = block(live, '    groups(agent = \'\') {', '    async refresh() {').replace(/,\s*$/, '');
  const run = last => {
    const c = vm.createContext({ Date, snoozeLast: () => last, isDeferred: s => !!s.deferred && !s.archived, WORKING: new Set(['running']), WEEK: 7 * 864e5, seenKeyOf: s => s.id, assistantAt: s => s.at, hasNew: () => true });
    vm.runInContext(`this.L = { sessionsFor: () => this.rows, deferred: {}, seenOf: () => ({}), ${src.trim()} };`, Object.assign(c, { rows: [
      { id: 'appr', status: 'waiting_for_approval', deferred: true, at: new Date().toISOString() },
      { id: 'run', status: 'running', deferred: true, at: new Date().toISOString() },
      { id: 'live', status: 'waiting_for_approval', at: new Date().toISOString() },
    ] }));
    const g = c.L.groups(); return { needs: ids(g.needs).sort(), working: ids(g.working) };
  };
  assert.deepEqual(run(false), { needs: ['appr', 'live'], working: ['run'] });
  assert.deepEqual(run(true), { needs: ['live'], working: ['run'] });
});
