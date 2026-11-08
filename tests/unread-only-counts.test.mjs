import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { listFixture } from './fixtures/chats-list-render.mjs';
import { modelContext } from './fixtures/chats-list-model.mjs';

// James, 8 Nov 2026: every number beside Chats / Ready counts UNREAD threads only. A finished thread that is already
// read adds nothing; the list itself still shows every thread. Working, Snoozed and Archive keep their place counts.
const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const chats = src('web/core/chats.js');
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
  const body = chats.slice(chats.indexOf('  function readyBody('), chats.indexOf('  /* Priority shows its groups'));
  assert.doesNotMatch(body, /\$\{g\.size\}/, 'subject header must not print the group size');
  assert.match(body, /unreadThreads\(l, /);
  const pri = chats.indexOf('  function priorityGroups('); assert.match(chats.slice(pri, pri + 700), /unreadThreads\(g\.rows, /);
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
  assert.match(cut(chats, 'data-spspace=', '</button>'), /<small>\$\{o\.unread \|\| ''\}<\/small>/, 'Space picker shows unread');
});

test('phone drawer: folded Ready tally is its unread count; Working/Snoozed keep theirs', () => {
  const layout = src('web/layouts/ai-apps/layout.js');
  const line = layout.slice(layout.indexOf('const tallyN ='), layout.indexOf('api.listen(h,', layout.indexOf('const tallyN =')));
  const c = { WizChatsListModel: modelContext({}).WizChatsListModel, out: [] };
  c.globalThis = c; vm.createContext(c);
  const run = (k, rows) => vm.runInContext(`(() => { const k = ${JSON.stringify(k)}, rows = ${JSON.stringify(rows)}, on = false, word0 = 'W', h = { append(n) { out.push(n); }, setAttribute(a, v) { out.push(v); } }, el = (t, cls, a) => a['data-n'];\n${line}\n})()`, c);
  c.out.length = 0; run('ready', [{ id: 1, unread: true }, { id: 2 }, { id: 3 }, { id: 4 }]);
  assert.deepEqual(c.out, ['1', 'W, 1 unread, folded']);
  c.out.length = 0; run('ready', [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(c.out, [], 'all read: no tally at all');
  c.out.length = 0; run('working', [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(c.out, ['2', 'W, 2, folded']);
});

test('Machines home / data.read.sessions: the Ready count is the unread pill, not the Ready inventory', () => {
  for (const f of ['web/app.js', 'web/desktop/desktop.js']) {
    const line = src(f).split('\n').find(l => /sessions: \(\) => \{ const G = /.test(l));
    assert.ok(line, f);
    assert.match(line, /ready: [\w.]*workspaceNav\.chatsCount\(LIVE\)/, f);
    assert.doesNotMatch(line, /\(G\.ready \|\| \[\]\)\.length/, f);
  }
});

test('the word beside a Chats number is "unread", never "ready"', () => {
  for (const f of ['web/layouts/orb/phone.js', 'web/layouts/apps/layout.js', 'web/layouts/apps/desktop.js']) assert.doesNotMatch(src(f), /\$\{n\} ready/, f);
  assert.match(src('web/layouts/orb/phone.js'), /\$\{n > 99 \? '99\+' : n\} unread/);
});
