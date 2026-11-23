import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { listFixture } from './fixtures/chats-list-render.mjs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { unreadWorld, runIn, UNREAD } from './fixtures/r8B-unread.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';

// James, 8 Nov 2026: every number beside Chats / Ready counts UNREAD threads only. A finished thread that is already
// read adds nothing; the list itself still shows every thread. Working, Snoozed and Archive keep their place counts.
const src = f => withShellParts(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const chats = withParts(src('web/core/chats.js'));
const cut = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));

const rows = [
  ...['a', 'b', 'c', 'd', 'e'].map(id => ({ id: 'ready-' + id, title: id, section: 'ready' })),
  ...['a', 'b', 'c'].map(id => ({ id: 'week-' + id, title: id, section: 'pastWeek' })),
  ...['a', 'b'].map(id => ({ id: 'work-' + id, title: id, section: 'working' })),
  ...['a', 'b', 'c', 'd'].map(id => ({ id: 'arch-' + id, title: id, section: 'archive' })),
];
const unread = new Set(['ready-a', 'ready-c']);
const headerOf = (html, k) => {
  const m = html.match(new RegExp(`data-sec="${k}"[^>]*>\\s*<button class="ch-sec-h"[^>]*><span>[^<]*</span><small>([^<]*)</small>`));
  return m ? m[1] : null;
};

for (const status of [false, true]) {
  test(`Chats list headers (${status ? 'status' : 'day'} layout): Ready counts its 2 unread, not its 5 threads`, () => {
    const html = listFixture({ status, inputRows: rows, unread: s => unread.has(s.id) }).render('');
    assert.equal(headerOf(html, 'ready'), '2', 'Ready header');
    assert.equal(headerOf(html, 'working'), '2', 'Working keeps its place count');
    assert.equal(headerOf(html, 'archive'), '4', 'Archive keeps its place count');
    assert.equal((html.match(/data-chopen="ready-/g) || []).length, 5, 'every Ready thread is still listed');
    assert.doesNotMatch(html, /\d+ new</, 'no second "new" tally beside the header number');
  });
}

test('Chats list headers: a Ready section with nothing unread shows no number, and its threads stay listed', () => {
  const html = listFixture({ inputRows: rows, unread: () => false }).render('');
  assert.equal(headerOf(html, 'ready'), '');
  assert.equal(headerOf(html, 'pastWeek'), '');
  assert.equal((html.match(/data-chopen="ready-/g) || []).length, 5);
});

test('Ready sub-group numbers (subject and priority) count unread only', () => {
  const model = modelContext({}).WizChatsListModel;
  const isNew = s => unread.has(s.id), five = rows.filter(r => r.section === 'ready');
  assert.equal(model.unreadThreads(five, isNew, []), 2);
  assert.equal(model.unreadThreads(five, isNew, [{ read: false }, { read: true }]), 3, 'unread notifications count, read ones do not');
  assert.equal(model.unreadThreads([five[0], five[0]], isNew), 1, 'a thread counts once');
  // The real Ready body (chats-readylist.js readyBody, chats-notes.js priorityGroups) grouped by subject and by
  // priority: each group's number is its unread threads, never its size.
  const grouped = rows.filter(r => r.section === 'ready').map((r, i) => ({ ...r, subj: i < 3 ? 'Trips' : 'Bills', rank: i < 3 ? 1 : 2 }));
  const numbers = order => {
    const r = runRecording(block(chats, '  function readyBody(') + '\n' + block(chats, '  function priorityGroups(') + '\nthis.readyBody = readyBody;', {
      window: { WizChatsListModel: model }, readyOrder: order, chatVars: { readyOrder: order }, LIVE: { isNew }, attOf: s => ({ subject: s.subj }), sesRank: s => s.rank,
      waitsOn: () => false, subjOrder: () => [], snoozeLast: () => false, deferredOf: () => false, esc: String, PRI_LABEL: { 1: 'High', 2: 'Normal' }, withNotes: () => '', orderBar: () => '' });
    const doc = createDocument(); doc.body.innerHTML = r.readyBody(grouped, () => '', null, 'ready');
    return doc.querySelectorAll('.ch-subj').map(g => [g.querySelector('span').textContent, g.querySelector('small').textContent]);
  };
  assert.deepEqual(numbers('subject'), [['Trips', '2'], ['Bills', '']], 'subject headers: 2 unread of 3; none unread of 2: no number');
  assert.deepEqual(numbers('priority'), [['High', '2'], ['Normal', '']], 'priority headers: the same');
});

test('Focus sheet and Space picker: All, Spaces and agents show unread, not how many threads they hold', () => {
  const env = { spaceAgent: s => s?.agent || 'hermes', focusAgents: () => [{ id: 'hermes' }], visibleSpaces: () => [{ id: 'a', name: 'Launch', threads: [] }], spaces: () => [{ id: 'a', name: 'Launch', threads: [] }],
    focusOf: () => null, focusedAgent: () => '', esc: s => String(s ?? ''), AGS: () => ({ colour: () => '', sigil: () => '', isPrivate: () => false }), agentRec: id => ({ id }),
    LIVE: { unified: () => Array.from({ length: 9 }, (_, i) => ({ id: 't' + i })), spaceSessions: () => ({ rows: Array.from({ length: 6 }, (_, i) => ({ id: 's' + i })) }),
      workGroups: () => ({ archive: [] }), isNew: () => false, visibleUnread: rs => rs.slice(0, 2) },
    matchesFocus: () => true, rememberedFocus: () => null };
  vm.createContext(env);
  vm.runInContext(cut(chats, '  function focusOptions()', '  function focusSection(') + cut(chats, '  function focusUseful()', '  // One local picker'), env);
  const opts = env.focusOptions();
  assert.deepEqual(JSON.parse(JSON.stringify(opts.map(o => [o.kind, o.count, o.unread]))), [['all', 9, 2], ['agent', 9, 2], ['space', 6, 2]]);
  const sheet = opts.map(o => env.focusOption({}, o)).join('');
  assert.deepEqual([...sheet.matchAll(/<small>([^<]*)<\/small>/g)].map(m => m[1]), ['2', '2', '2'], 'sheet shows unread');
  assert.doesNotMatch(sheet, /<small>(9|6)<\/small>/);
  // The real Space picker (chats-spaces.js renderSpacePicker) on those same options, drawn into a mini-dom page.
  const doc = createDocument();
  runRecording(block(chats, '  function renderSpacePicker(') + '\nrenderSpacePicker();', { document: doc, spacePicker: { wid: 'w1', agent: 'hermes', sid: '' }, W: { w1: { id: 'w1' } },
    focusOptions: () => opts, focusOf: () => null, focusAgents: () => [{ id: 'hermes' }], agentRec: id => ({ id, label: 'Wizard' }), spaces: () => [{ id: 'a', name: 'Launch', agent: 'hermes' }],
    spaceAgent: s => s?.agent || 'hermes', SPACE: { ch: false, one: 'Space' }, esc: s => String(s ?? ''), AGS: () => null, innerHeight: 800, innerWidth: 400, requestAnimationFrame() {} });
  const row = doc.querySelector('[data-spspace="a"]'); assert.ok(row, 'the Space is listed');
  assert.equal(row.querySelector('small').textContent, '2', 'Space picker shows unread, not its 6 threads');
});

test('phone drawer: folded Ready tally is its unread count; Working/Snoozed keep theirs', () => {
  const layout = src('web/layouts/ai-apps/layout.js');
  const line = layout.slice(layout.indexOf('const tallyN ='), layout.indexOf('api.listen(h,', layout.indexOf('const tallyN =')));
  const c = { WizChatsListModel: modelContext({}).WizChatsListModel, out: [] };
  c.globalThis = c; vm.createContext(c);
  const run = (k, rows) => { c.tallyKey = k; c.tallyRows = rows; return vm.runInContext(`(() => { const k = tallyKey, rows = tallyRows, on = false, word0 = 'W', h = { append(n) { out.push(n); }, setAttribute(a, v) { out.push(v); } }, el = (t, cls, a) => a['data-n'];\n${line}\n})()`, c); };
  c.out.length = 0; run('ready', [{ id: 1, unread: true }, { id: 2 }, { id: 3 }, { id: 4 }]);
  assert.deepEqual(c.out, ['1', 'W, 1 unread, folded']);
  c.out.length = 0; run('ready', [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(c.out, [], 'all read: no tally at all');
  c.out.length = 0; run('working', [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(c.out, ['2', 'W, 2, folded']);
});

// Runs each shell's real data.read.sessions adapter entry (app-agentorb.js / desktop-boot.js) against the real
// workspace-navigation projection, on a world whose Ready inventory (5) differs from its unread tally (3).
test('Machines home / data.read.sessions: the Ready count is the unread pill, not the Ready inventory', () => {
  for (const f of ['web/app-agentorb.js', 'web/desktop/desktop-boot.js']) {
    const line = readFileSync(new URL('../' + f, import.meta.url), 'utf8').split('\n').find(l => /^\s*sessions: \(\) => \{ const G = /.test(l));
    const w = unreadWorld(), c = runIn(w, `globalThis.adapter = {\n${line}\n};`);
    assert.deepEqual({ ...c.adapter.sessions() }, { working: 1, ready: UNREAD }, f);
    const off = runIn(unreadWorld(), `globalThis.adapter = {\n${line}\n};`, { LIVE: { ok: false } });
    assert.equal(off.adapter.sessions(), null, `${f}: nothing while Wizard is not connected`);
  }
});
