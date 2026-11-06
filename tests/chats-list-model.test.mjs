import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { modelContext } from './fixtures/chats-list-model.mjs';
import '../web/core/chats-list-model.js';
const M = globalThis.WizChatsListModel;
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const at = n => `2026-11-05T${String(n).padStart(2, '0')}:00:00Z`;
const rows = [
  { id: 'needs', title: 'Alpha · needs', at: at(1), state: 'needs' },
  { id: 'new', title: 'Beta · new', at: at(9), state: 'done' },
  { id: 'approval', title: 'Alpha · approval', at: at(2), state: 'approval' },
  { id: 'failed', title: 'Beta · failed', at: at(8), state: 'failed' },
  { id: 'note', title: 'Notify', at: at(7), note: true, rank: 2 },
  { id: 'tie-b', title: 'Beta · B', at: at(6), state: 'fyi' },
  { id: 'tie-a', title: 'Beta · A', at: at(6), state: 'fyi' },
  { id: 'sleep', title: 'Alpha · sleep', at: at(10), state: 'deferred' },
  { id: 'read', title: 'Read', at: at(11), note: true, snoozed: true },
];
const ids = rs => Array.from(rs, r => r.id);
const expected = {
  newest: ['approval', 'new', 'failed', 'note', 'tie-a', 'tie-b', 'needs', 'sleep', 'read'],
  oldest: ['approval', 'needs', 'tie-a', 'tie-b', 'note', 'failed', 'new', 'sleep', 'read'],
  priority: ['approval', 'failed', 'needs', 'note', 'tie-a', 'tie-b', 'new', 'sleep', 'read'],
};
for (const order of Object.keys(expected)) test(`${order}: exact IDs, approval pin, failed, note, snoozed/read tail, alphabetical ties, no mutation`, () => {
  const before = JSON.stringify(rows);
  assert.deepEqual(ids(M.readySort(rows, order)), expected[order]);
  assert.equal(JSON.stringify(rows), before);
});
test('every group mode uses the same Sort inside groups; walk equals drawn IDs, including wrapping', () => {
  const groups = {
    newest: {
      none: expected.newest,
      status: ['needs', 'approval', 'failed', 'note', 'tie-a', 'tie-b', 'new', 'sleep', 'read'],
      project: ['approval', 'needs', 'sleep', 'new', 'failed', 'tie-a', 'tie-b', 'note', 'read'],
    },
    oldest: {
      none: expected.oldest,
      status: ['needs', 'approval', 'failed', 'tie-a', 'tie-b', 'note', 'new', 'sleep', 'read'],
      project: ['approval', 'needs', 'sleep', 'tie-a', 'tie-b', 'failed', 'new', 'note', 'read'],
    },
  };
  for (const order of ['newest', 'oldest']) for (const mode of ['none', 'status', 'project']) {
    const drawn = ids(M.readyFlat(rows, order, mode));
    assert.deepEqual(drawn, groups[order][mode], order + ':' + mode);
    assert.deepEqual(M.visibleIds(rows, order, mode), drawn);
    let cur = null; const walked = [];
    for (let i = 0; i < drawn.length; i++) { cur = M.readyStep(drawn, cur, 1).id; walked.push(cur); }
    assert.deepEqual(walked, drawn);
    assert.deepEqual(M.readyStep(drawn, cur, 1), { id: drawn[0], wrapped: true });
    assert.deepEqual(M.readyStep(drawn, drawn[0], -1), { id: drawn.at(-1), wrapped: true });
  }
});
test('equal title and timestamp preserve input order; missing times are deterministic', () => {
  for (const order of ['newest', 'oldest', 'priority']) assert.deepEqual(ids(M.readySort([{ id: 'z', title: 'Same' }, { id: 'a', title: 'Same' }], order)), ['z', 'a']);
  assert.deepEqual(ids(M.readySort([{ id: 'missing' }, { id: 'valid', at: at(1) }], 'newest')), ['valid', 'missing']);
});
test('both shell adapters delegate one projection, preserving errors/day groups, actions, pins and routed-scope input', () => {
  const session = (id, extra = {}) => ({ id, title: id, status: 'completed', previewAt: at(3), ...extra });
  const groups = { errors: [session('failed', { status: 'failed' })], ready: [session('approval', { status: 'waiting_for_approval' }), session('sleep', { deferred: true })], yesterday: [session('yesterday')], pastWeek: [session('week')], working: [session('working')], archive: [session('archive')] };
  const facts = { live: { isNew: s => s.id === 'yesterday', cardAt: s => s.previewAt, readyRank: s => M.sessionRank(s) }, chats: { stiKind: s => s.status === 'failed' ? 'failed' : s.status === 'waiting_for_approval' ? 'approval' : 'none', threadActions: () => ['snooze', 'done', 'stop_watch'] }, pins: new Set(['failed']) };
  const projected = M.sessionList(groups, facts);
  assert.deepEqual(ids(projected.ready), ['failed', 'approval', 'yesterday', 'week']);
  assert.deepEqual(ids(projected.snoozed), ['sleep']);
  assert.equal(projected.ready[0].rank, 1);
  assert.equal(projected.ready[0].pinned, true);
  assert.deepEqual(projected.ready[0].actions, ['pin', 'rename', 'unread', 'snooze', 'done']);
  assert.deepEqual(projected.ready[2].actions, ['pin', 'rename', 'snooze', 'done']);
  for (const file of ['web/app.js', 'web/desktop/desktop.js']) {
    const line = read(file).split('\n').find(l => l.includes('sessionList: () =>'));
    assert.ok(line.includes('WizChatsListModel.sessionList(LIVE?.ok ? LIVE.workGroups() : null'), file);
  }
});
test('core/classic desktop and stock phone use shared ordering/grouping while keeping original row markup', () => {
  const src = read('web/core/chats.js');
  const block = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
  const c = modelContext({ window: {}, READY_ORDERS: [], readyOrder: 'newest', snoozeLast: () => false, deferredOf: s => s.deferred,
    attOf: s => s.attention, stiKind: () => 'none', waitsOn: s => s.attention?.state === 'needs_you', subjOrder: () => [], esc: String,
    LIVE: { cardAt: s => s.at }, sesRank: s => M.sessionRank(s) });
  vm.runInContext(block('  function readyBody(', '  /* Android Back') + '\nthis.render = readyBody;', c);
  const sessions = rows.filter(r => !r.note).map(r => ({ ...r, status: r.state === 'approval' ? 'waiting_for_approval' : 'completed', deferred: r.state === 'deferred', attention: { state: ({ needs: 'needs_you', failed: 'needs_you' }[r.state] || r.state), subject: r.title.split(' · ')[0] } }));
  const row = s => `<row id="${s.id}"></row>`;
  const renderedIds = html => [...html.matchAll(/<row id="([^"]+)"/g)].map(m => m[1]);
  for (const order of ['newest', 'oldest', 'priority']) {
    c.readyOrder = order;
    const ordered = M.orderSessions(sessions, order, { at: s => s.at, rank: s => M.sessionRank(s) });
    const golden = {
      newest: ['approval', 'new', 'failed', 'tie-a', 'tie-b', 'needs', 'sleep'],
      oldest: ['approval', 'needs', 'tie-a', 'tie-b', 'failed', 'new', 'sleep'],
      priority: ['approval', 'failed', 'needs', 'tie-a', 'tie-b', 'new', 'sleep'],
    };
    assert.deepEqual(renderedIds(c.render(ordered, row)), golden[order]);
  }
  c.readyOrder = 'subject';
  const html = c.render(sessions, row);
  assert.deepEqual(renderedIds(html), ['failed', 'tie-a', 'tie-b', 'new', 'approval', 'needs', 'sleep']);
  assert.equal((html.match(/class="ch-subj"/g) || []).length, 2);
  for (const file of ['web/index.html', 'web/desktop.html']) { const html = read(file), model = html.indexOf('core/chats-list-model.js'), live = html.indexOf('src="live.js"'); assert.ok(model >= 0 && live > model, file + ': boot dependency exists before live'); }
});
test('notifications share time/priority/ties, never mutate inputs, and read notes stay last', () => {
  const sessions = [{ id: 'chat', title: 'Chat', at: at(4) }];
  const notes = [{ id: 'urgent-old', title: 'Urgent', time: Date.parse(at(1)) / 1000, priority: 4 }, { id: 'fresh', title: 'Fresh', time: Date.parse(at(8)) / 1000, priority: 1 }, { id: 'read', title: 'Read', time: Date.parse(at(9)) / 1000, read: true }];
  const facts = { at: s => s.at, rank: () => 5 };
  assert.deepEqual(ids(M.mixedRows(sessions, notes, 'newest', facts)), ['fresh', 'chat', 'urgent-old', 'read']);
  assert.deepEqual(ids(M.mixedRows(sessions, notes, 'oldest', facts)), ['urgent-old', 'chat', 'fresh', 'read']);
  assert.deepEqual(ids(M.mixedRows(sessions, notes, 'priority', facts)), ['urgent-old', 'fresh', 'chat', 'read']);
  assert.equal(notes[2].rank, undefined);
});

test('raw live time key remains cardAt, not updatedAt, for Newest/Oldest/Priority compatibility helpers', () => {
  const src = read('web/live.js');
  const block = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
  const c = modelContext({ Date, document: { documentElement: { dataset: {} } }, localStorage: { getItem: () => null }, window: { WizConfig: { dayStart: n => n - n % 864e5 } } });
  vm.runInContext(block('  const DAY = 864e5;', '  // Agent Service owns box-wide preferences.') + block('  const sectionTime =', '  async function fetchDispositions()') + '\nthis.group = groupWork; this.priority = byPriority; this.oldest = byOldest;', c);
  const sessions = [{ id: 'preview-new', title: 'N', status: 'completed', previewAt: at(8), updatedAt: at(1) }, { id: 'updated-new', title: 'U', status: 'completed', previewAt: at(2), updatedAt: at(9) }];
  const ready = c.group(sessions, Date.parse(at(12))).ready;
  assert.deepEqual(ids(ready), ['preview-new', 'updated-new']);
  assert.deepEqual(ids(c.priority(ready)), ['preview-new', 'updated-new']);
  assert.deepEqual(ids(c.oldest(ready)), ['updated-new', 'preview-new']);
});
test('raw and projected tie keys agree even when display titles add a source or an untitled-chat fallback', () => {
  const sessions = [{ id: 'untitled', title: '', at: at(4) }, { id: 'alpha', title: 'Alpha', at: at(4) }];
  const notes = [{ id: 'note', title: 'Middle', time: Date.parse(at(4)) / 1000 }];
  const facts = { at: s => s.at, rank: () => 5 };
  const projected = [...sessions.map(s => ({ ...s, title: s.title || 'New chat', rank: 5 })), { ...M.notificationRow(notes[0]), title: 'Z source · Middle' }];
  for (const order of ['newest', 'oldest']) {
    assert.deepEqual(ids(M.mixedRows(sessions, notes, order, facts)), ['alpha', 'note', 'untitled']);
    assert.deepEqual(ids(M.readySort(projected, order)), ['alpha', 'note', 'untitled']);
  }
});

test('folded notifications have the same Priority in real core fold and host, even with omitted/mixed priorities', () => {
  const src = read('web/core/chats.js'), c = modelContext({ window: {} });
  vm.runInContext(src.slice(src.indexOf('  const noteSrc ='), src.indexOf('  const sesRank =')) + '\nthis.fold = fold;', c);
  const cases = [
    [{ id: 'n', title: 'Newest' }, { id: 'o', priority: 3 }],
    [{ id: 'n', title: 'Newest', priority: 1 }, { id: 'o', priority: 3 }],
    [{ id: 'n', title: 'Newest', priority: 1 }, { id: 'o', priority: 2 }],
  ];
  cases.forEach((items, index) => {
    const core = c.fold(items)[0];
    assert.equal(M.notificationRow(items[0], items).rank, M.notificationRow(core).rank);
    assert.equal(M.notificationRow(core).rank, [2, 2, 3][index]);
  });
  assert.equal(M.notificationRow({}).rank, 3, 'single missing-priority note stays FYI');
  const grouped = { id: 'fold', group: 'external', title: 'Fold', priority: 1, time: 1, items: [{ priority: 1 }, { priority: 3 }] };
  const fyi = { id: 'fyi', priority: 2, time: 9 };
  assert.deepEqual(ids(M.mixedRows([], [fyi, grouped], 'priority', {})), ['fold', 'fyi'], 'map callback must not pass index as the items parameter');
});
